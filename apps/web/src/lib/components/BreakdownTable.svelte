<script lang="ts" module>
	export interface BreakdownRow {
		id: string;
		name: string;
		detail?: string;
		cost: number;
		tokens: number;
		count: number;
		color?: string;
		costUnknownRequests?: number;
	}
</script>

<script lang="ts">
	import { createTable, tableFeatures, rowSortingFeature, createSortedRowModel, sortFns, type ColumnDef, type SortingState } from '@tanstack/svelte-table';
	import MoneyOdometer from './ds/MoneyOdometer.svelte';
	import { compactTokens, int } from '@chaching/shared/format';
	let { rows, label, countLabel, selected, onToggle, reducedMotion = false }: {
		rows: BreakdownRow[];
		label: string;
		countLabel: string;
		selected?: ReadonlySet<string>;
		onToggle?: (id: string) => void;
		reducedMotion?: boolean;
	} = $props();
	let search = $state('');
	let page = $state(0);
	let sorting = $state<SortingState>([{ id: 'cost', desc: true }]);
	let filtered = $derived(rows.filter(row => (row.name + ' ' + (row.detail ?? '')).toLowerCase().includes(search.trim().toLowerCase())));
	let total = $derived(rows.reduce((sum, row) => sum + row.cost, 0));
	const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns });
	const columns: ColumnDef<typeof features, BreakdownRow, unknown>[] = [
		{ id: 'name', accessorKey: 'name', sortDescFirst: false },
		{ id: 'cost', accessorKey: 'cost', sortDescFirst: true },
		{ id: 'tokens', accessorKey: 'tokens', sortDescFirst: true },
		{ id: 'count', accessorKey: 'count', sortDescFirst: true }
	];
	const table = createTable({
		features, columns,
		get data() { return filtered; },
		state: { get sorting() { return sorting; } },
		onSortingChange(updater) { sorting = typeof updater === 'function' ? updater(sorting) : updater; page = 0; }
	}, () => undefined);
	let sorted = $derived(table.getRowModel().rows);
	let lastPage = $derived(Math.max(0, Math.ceil(sorted.length / 8) - 1));
	let currentPage = $derived(Math.min(page, lastPage));
	let visible = $derived(sorted.slice(currentPage * 8, (currentPage + 1) * 8));
</script>

<div class="breakdown" class:still={reducedMotion}>
	<input type="search" aria-label={'Search ' + label.toLowerCase()} placeholder={'Search ' + label.toLowerCase()} bind:value={search} oninput={() => page = 0}/>
	<table aria-label={label}>
		<thead><tr>{#each table.getAllColumns() as column (column.id)}
			<th scope="col" aria-sort={column.getIsSorted() === 'asc' ? 'ascending' : column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
				<button onclick={() => column.toggleSorting()}>{column.id === 'name' ? 'Name' : column.id === 'cost' ? 'Spend' : column.id === 'tokens' ? 'Tokens' : countLabel}<span aria-hidden="true">{column.getIsSorted() === 'asc' ? ' ↑' : column.getIsSorted() === 'desc' ? ' ↓' : ''}</span></button>
			</th>
		{/each}</tr></thead>
		<tbody>{#each visible as item (item.original.id)}
			{@const row = item.original}
			{@const share = total > 0 ? row.cost / total : 0}
			<tr>
				<td class="name" title={row.detail ?? row.name}>
					{#if onToggle}<button class="filter" aria-pressed={selected?.has(row.id) ?? false} onclick={() => onToggle?.(row.id)}>{row.name}</button>{:else}<span>{row.name}</span>{/if}
					<div class="track" aria-hidden="true"><span style:width={share * 100 + '%'} style:background={row.color ?? 'var(--accent)'}></span></div>
				</td>
				<td>{#if row.cost === 0 && row.costUnknownRequests}<span>Unknown</span>{:else}<MoneyOdometer amount={row.cost} size="sm" tone="default" {reducedMotion}/>{/if}{#if row.costUnknownRequests}<small title={row.costUnknownRequests + ' requests without a known price'}>Partial</small>{:else}<small title="Share of known spend">{Math.round(share * 100)}%</small>{/if}</td>
				<td>{compactTokens(row.tokens)}</td>
				<td>{int(row.count)}</td>
			</tr>
		{:else}<tr><td colspan="4" class="empty">No matches in this scope.</td></tr>{/each}</tbody>
	</table>
	<div class="paging"><span>{sorted.length} {label.toLowerCase()}</span>{#if lastPage > 0}<div><button aria-label={'Previous ' + label.toLowerCase() + ' page'} disabled={currentPage === 0} onclick={() => page = currentPage - 1}>‹</button><span>{currentPage + 1} / {lastPage + 1}</span><button aria-label={'Next ' + label.toLowerCase() + ' page'} disabled={currentPage === lastPage} onclick={() => page = currentPage + 1}>›</button></div>{/if}</div>
</div>

<style>
	.breakdown{min-width:0;font-size:13px}
	input{width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font:inherit;padding:8px 10px;margin-bottom:10px}
	table{width:100%;border-collapse:collapse;table-layout:fixed}
	th,td{text-align:right;padding:9px 6px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}
	th{font-weight:500;color:var(--text-muted);font-size:11px}
	th:first-child,td:first-child{text-align:left;width:42%;padding-left:0}
	th:last-child,td:last-child{padding-right:0}
	button{font:inherit;border:0;background:none;color:inherit;padding:4px 0;cursor:pointer;max-width:100%}
	button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
	.name>span,.filter{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
	.filter[aria-pressed=true]{color:var(--accent)}
	small{display:block;color:var(--text-muted);font-size:10px;margin-top:2px}
	.track{height:3px;background:var(--surface-3);margin-top:6px;border-radius:2px;overflow:hidden}
	.track span{display:block;height:100%;transition:width 400ms ease}
	.still .track span{transition:none}
	.paging,.paging>div{display:flex;align-items:center;justify-content:space-between;gap:10px}
	.paging{margin-top:8px;color:var(--text-muted);font-size:11px}
	.paging button{width:28px;height:28px}
	button:disabled{opacity:.3;cursor:default}
	.empty{text-align:center}
	@media(prefers-reduced-motion:reduce){.track span{transition:none}}
	@media(max-width:500px){.breakdown{font-size:11px}th,td{padding:8px 3px}th:first-child,td:first-child{width:36%}.breakdown :global(.money){font-size:12px}}
</style>
