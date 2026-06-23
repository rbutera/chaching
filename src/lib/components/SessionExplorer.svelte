<script lang="ts">
	// Session explorer (chaching-session-browser): a sortable / project-searchable /
	// row-virtualized table across ALL banked sessions (frozen ∪ live). Promotes the
	// cramped SessionList into a first-class, cross-day browser. Sort/filter/column state
	// lives in the TanStack table instance (table-core, driven by the Svelte 5 adapter);
	// the data getter re-reads the snapshot so a live delta re-derives rows WITHOUT
	// resetting sort/search/scope. Virtualization keeps render cost O(visible rows).
	//
	// Design D1/D1a: @tanstack/svelte-table@9 (Svelte-5-native runes adapter) for the table
	// model; @tanstack/svelte-virtual for the virtual window. These are runtime deps that
	// ship in the WEB bundle only — never reachable from the CLI (tsup) entry.
	import type { SessionSummary } from '$lib/types';
	import {
		createTable,
		tableFeatures,
		rowSortingFeature,
		createSortedRowModel,
		sortFns,
		type ColumnDef,
		type SortingState,
		type Table
	} from '@tanstack/svelte-table';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { money, compactTokens, modelColor, modelLabel, fmtTimeRange, shortProject } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';
	import { isLive } from '$lib/core/view-model';
	import { untrack } from 'svelte';

	let {
		sessions,
		onOpen,
		now = Date.now()
	}: {
		/** The sessions to show (already filtered by the caller's selector — all-banked by default). */
		sessions: SessionSummary[];
		onOpen: (s: SessionSummary) => void;
		/** Injectable "now" for deterministic live/frozen tests. */
		now?: number;
	} = $props();

	// ---- derived row shape (pure, memo-free; cheap over thousands) ----
	interface Row {
		session: SessionSummary;
		project: string;
		models: string[];
		requests: number;
		cost: number;
		duration: number; // lastTs - firstTs (ms)
		tokens: number;
		costUnknown: boolean;
		live: boolean;
	}

	function toRow(s: SessionSummary): Row {
		return {
			session: s,
			project: shortProject(s.project),
			models: s.models,
			requests: s.requests,
			cost: s.cost,
			duration: s.lastTs - s.firstTs,
			tokens: totalTokens(s.tokens),
			costUnknown: s.costUnknownRequests > 0,
			live: isLive(s, now)
		};
	}

	let rows = $derived(sessions.map(toRow));

	// ---- project search (controlled; lives in the component, survives data deltas) ----
	let search = $state('');
	let filtered = $derived(
		search.trim()
			? rows.filter((r) => r.project.toLowerCase().includes(search.trim().toLowerCase()))
			: rows
	);

	// ---- sortable columns (sort state lives in the table instance) ----
	const features = tableFeatures({
		rowSortingFeature,
		sortedRowModel: createSortedRowModel(),
		sortFns
	});

	const columns: ColumnDef<typeof features, Row, unknown>[] = [
		{ id: 'project', accessorKey: 'project', enableSorting: false },
		{ id: 'cost', accessorKey: 'cost', sortDescFirst: true },
		// recency = last activity; sort the underlying lastTs so ties + sub-second resolve right
		{ id: 'recency', accessorFn: (r) => r.session.lastTs, sortDescFirst: true },
		{ id: 'tokens', accessorKey: 'tokens', sortDescFirst: true }
	];

	// default sort = recency, newest first
	let sorting = $state<SortingState>([{ id: 'recency', desc: true }]);

	const table: Table<typeof features, Row> = createTable<typeof features, Row>({
		features,
		columns,
		get data() {
			return filtered;
		},
		state: {
			get sorting() {
				return sorting;
			}
		},
		onSortingChange: (updater) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		}
	});

	let sortedRows = $derived(table.getRowModel().rows);

	// ---- sortable-header descriptors (real <button>s + aria-sort) ----
	type SortKey = 'cost' | 'recency' | 'tokens';
	const sortable: { id: SortKey; label: string }[] = [
		{ id: 'recency', label: 'Last active' },
		{ id: 'cost', label: 'Cost' },
		{ id: 'tokens', label: 'Tokens' }
	];

	function ariaSort(id: SortKey): 'ascending' | 'descending' | 'none' {
		const s = sorting.find((x) => x.id === id);
		if (!s) return 'none';
		return s.desc ? 'descending' : 'ascending';
	}

	function toggleSort(id: SortKey) {
		const col = table.getColumn(id);
		col?.toggleSorting();
	}

	// ---- row virtualization ----
	// The virtualizer store is created ONCE so its measured scroll-element
	// subscription survives sort/search/delta re-renders (the data re-derives, the
	// virtualizer is not torn down). `count` is read live inside the option getters,
	// and an $effect pushes count changes via setOptions + measure so the window
	// follows a growing/shrinking row set.
	let scrollEl = $state<HTMLDivElement>();
	const ROW_H = 56;

	// Initial count is read untracked (the reactive count lives in the $effect below,
	// which pushes every change via setOptions). Reading sortedRows.length directly
	// here would only capture the mount-time value and warns under svelte-check.
	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: untrack(() => sortedRows.length),
		getScrollElement: () => scrollEl ?? null,
		estimateSize: () => ROW_H,
		overscan: 8
	});

	// Re-measure when the row count or the scroll element changes. We read the
	// virtualizer instance with `untrack` so this effect depends ONLY on count + el,
	// never on the store itself — otherwise setOptions→store.set would re-trigger the
	// effect and loop. setOptions merges over existing options (scroll subscription
	// preserved); measure() reflows the window for the new count.
	$effect(() => {
		const count = sortedRows.length;
		const el = scrollEl;
		untrack(() => {
			$virtualizer.setOptions({ count, getScrollElement: () => el ?? null });
			$virtualizer.measure();
		});
	});

	let virtualItems = $derived($virtualizer.getVirtualItems());
	let totalSize = $derived($virtualizer.getTotalSize());

	// ---- roving-tabindex keyboard nav across the virtual boundary ----
	// We track the ACTIVE row index (into sortedRows) rather than relying on DOM tabindex,
	// so focus survives re-virtualization: on key, we move the index, scroll it into view,
	// then focus its element once the virtualizer has rendered it.
	let activeIndex = $state(0);
	$effect(() => {
		// keep the active index in range as the row set changes (sort/search/delta)
		if (activeIndex > sortedRows.length - 1) activeIndex = Math.max(0, sortedRows.length - 1);
	});

	function focusRow(i: number) {
		const el = scrollEl?.querySelector<HTMLElement>(`[data-row-index="${i}"]`);
		el?.focus();
	}

	function moveActive(delta: number) {
		const next = Math.min(Math.max(activeIndex + delta, 0), sortedRows.length - 1);
		if (next === activeIndex && scrollEl?.querySelector(`[data-row-index="${next}"]`)) {
			focusRow(next);
			return;
		}
		activeIndex = next;
		$virtualizer.scrollToIndex(next, { align: 'auto' });
		// the row may not be in the DOM yet (just scrolled into view) — focus after paint
		requestAnimationFrame(() => focusRow(next));
	}

	function onRowKey(e: KeyboardEvent, rowIndex: number, s: SessionSummary) {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				moveActive(1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				moveActive(-1);
				break;
			case 'Home':
				e.preventDefault();
				moveActive(-sortedRows.length);
				break;
			case 'End':
				e.preventDefault();
				moveActive(sortedRows.length);
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				onOpen(s);
				break;
		}
	}
</script>

<div class="explorer">
	<div class="head">
		<h2 class="title">Sessions</h2>
		<div class="searchwrap">
			<input
				type="search"
				class="search"
				placeholder="Search project…"
				aria-label="Search sessions by project"
				bind:value={search}
			/>
		</div>
	</div>

	<div class="sortbar" role="row" aria-label="Sort sessions">
		{#each sortable as col (col.id)}
			<!-- aria-sort lives on the columnheader (where the role supports it), the control is a real button -->
			<div class="sortcell" role="columnheader" aria-sort={ariaSort(col.id)}>
				<button
					class="sortbtn"
					class:active={ariaSort(col.id) !== 'none'}
					onclick={() => toggleSort(col.id)}
				>
					{col.label}
					<span class="caret" aria-hidden="true"
						>{ariaSort(col.id) === 'descending' ? '↓' : ariaSort(col.id) === 'ascending' ? '↑' : ''}</span
					>
				</button>
			</div>
		{/each}
	</div>

	{#if sortedRows.length === 0}
		<p class="empty">{search.trim() ? 'No sessions match that project.' : 'No sessions in scope.'}</p>
	{:else}
		<div
			class="scroll"
			bind:this={scrollEl}
			role="grid"
			aria-rowcount={sortedRows.length}
			aria-label="Sessions"
		>
			<div class="sizer" style={`height:${totalSize}px`}>
				{#each virtualItems as vi (vi.key)}
					{@const row = sortedRows[vi.index]}
					{@const r = row.original}
					<div
						class="row"
						role="row"
						tabindex={vi.index === activeIndex ? 0 : -1}
						data-row-index={vi.index}
						aria-rowindex={vi.index + 1}
						style={`transform:translateY(${vi.start}px);height:${ROW_H}px`}
						onclick={() => onOpen(r.session)}
						onkeydown={(e) => onRowKey(e, vi.index, r.session)}
						onfocus={() => (activeIndex = vi.index)}
					>
						<span class="dots" aria-hidden="true">
							{#each r.models.slice(0, 3) as m (m)}
								<span class="dot" style={`background:${modelColor(m)}`}></span>
							{/each}
						</span>
						<span class="proj" role="gridcell">
							<span class="proj-name">{r.project}</span>
							<span class="sub">
								{modelLabel(r.models[0] ?? '')}{r.models.length > 1
									? ` +${r.models.length - 1}`
									: ''}
								{#if r.live}<span class="badge live">live</span>{/if}
								{#if r.costUnknown}<span class="badge unknown" title="Some requests have no known price"
										>cost partial</span
									>{/if}
							</span>
						</span>
						<span class="when" role="gridcell">{fmtTimeRange(r.session.firstTs, r.session.lastTs)}</span>
						<span class="figs" role="gridcell">
							<span class="cost num">{money(r.cost)}</span>
							<span class="tok num">{compactTokens(r.tokens)} tok · {r.requests} req</span>
						</span>
					</div>
				{/each}
			</div>
		</div>
		<p class="count">{sortedRows.length} session{sortedRows.length === 1 ? '' : 's'}{search.trim() ? ' (filtered)' : ''}</p>
	{/if}
</div>

<style>
	.explorer {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.title {
		font-size: 0.8rem;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
		font-weight: 600;
	}
	.searchwrap {
		flex: 1 1 180px;
		max-width: 280px;
	}
	.search {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--fg);
		padding: 0.4rem 0.8rem;
		font-size: 0.82rem;
		min-height: 36px;
	}
	.search:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.sortbar {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.sortcell {
		display: contents;
	}
	.sortbtn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--fg-muted);
		padding: 0.3rem 0.7rem;
		font-size: 0.74rem;
		min-height: 32px;
	}
	.sortbtn.active {
		color: var(--fg);
		border-color: var(--border-strong);
		background: var(--surface-3);
	}
	.sortbtn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.caret {
		font-family: var(--font-num);
		min-width: 0.7em;
	}
	.scroll {
		position: relative;
		max-height: 460px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-1);
	}
	.sizer {
		position: relative;
		width: 100%;
	}
	.row {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		display: grid;
		grid-template-columns: auto minmax(0, 1.4fr) minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
		text-align: left;
		padding: 0.5rem 0.8rem;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		box-sizing: border-box;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.dots {
		display: flex;
		gap: 3px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.proj {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.proj-name {
		font-size: 0.88rem;
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 0.72rem;
		color: var(--fg-dim);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 0.62rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}
	.badge.live {
		background: color-mix(in srgb, var(--good) 22%, var(--surface-2));
		color: var(--good);
	}
	.badge.unknown {
		background: color-mix(in srgb, var(--warn) 20%, var(--surface-2));
		color: var(--warn);
	}
	.when {
		font-size: 0.74rem;
		color: var(--fg-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.figs {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		white-space: nowrap;
	}
	.cost {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.tok {
		font-size: 0.7rem;
		color: var(--fg-dim);
	}
	.empty {
		color: var(--fg-dim);
		font-size: 0.85rem;
		padding: 1.5rem 1rem;
		text-align: center;
	}
	.count {
		margin: 0;
		font-size: 0.72rem;
		color: var(--fg-dim);
		text-align: right;
	}
	@media (max-width: 560px) {
		.row {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}
		.when {
			display: none;
		}
	}
</style>
