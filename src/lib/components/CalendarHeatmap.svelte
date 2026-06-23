<script lang="ts">
	// Hand-rolled GitHub-contributions calendar heatmap: one cell per calendar day in the
	// banked range, columns = ISO weeks (Mon-Sun rows), cost-shaded on a colorblind-safe
	// accent-mix ramp (d3 scaleQuantize), with the per-day coverage state decorated ON TOP
	// of the cost shade (design D2/D3/D4). Matches the house a11y pattern (TrendChart):
	// an aria-hidden SVG-equivalent visual grid plus a real <button> per day (roving
	// tabindex, WAI grid keyboard nav) and a .visually-hidden data <table> fallback.
	import type { DayCell } from '$lib/core/view-model';
	import type { DayCoverage } from '$lib/types';
	import { money, fmtDay } from '$lib/format';
	import { coverageWord } from '$lib/core/coverage-marks';
	import {
		COST_RAMP,
		cellShade as shadeFor,
		columnCount,
		indexAt,
		makeCostScale,
		placeCells,
		type PlacedCell
	} from '$lib/core/heatmap-layout';

	let {
		cells,
		focusedDay,
		coverage = () => 'frozen',
		onPick
	}: {
		cells: DayCell[];
		focusedDay: string | null;
		/** per-day coverage state; defaults to all-frozen so the grid builds standalone (D4) */
		coverage?: (day: string) => DayCoverage;
		onPick: (day: string) => void;
	} = $props();

	// Lay the days out into week columns + cost-quantize — pure helpers in heatmap-layout.ts
	// (unit-tested in node; D2/D3). Days stay in calendar order so the button index matches
	// the visually-hidden table + arrow stepping.
	let placed = $derived(placeCells(cells));
	let colCount = $derived(columnCount(placed));
	let colorScale = $derived(makeCostScale(cells));

	function cellShade(p: PlacedCell): string {
		return shadeFor(p.cell, coverage(p.cell.day), colorScale);
	}

	function ariaLabel(p: PlacedCell): string {
		const c = p.cell;
		const cov = coverage(c.day);
		return `${fmtDay(c.day)}: ${money(c.cost)}, ${coverageWord(cov)}. Pin this day.`;
	}

	// --- roving-tabindex keyboard nav over a labelled-button collection ---
	// House a11y pattern (TrendChart): a flat set of per-day labelled <button>s + a
	// .visually-hidden data table — NOT an ARIA role="grid" (a grid with bare-button
	// children is an invalid tree). Exactly one button is in the tab order (rovingIdx);
	// arrows move DOM focus AND the tab stop so Tab-out/Tab-back returns where you left off.
	let buttons = $state<HTMLButtonElement[]>([]);
	// Initial tab stop: the focused day if present, else the last (most recent) day. After
	// that, arrow nav drives it. Re-seeded whenever the data range or the pin changes.
	let rovingIdx = $state(0);
	$effect(() => {
		const seed =
			focusedDay != null
				? (placed.find((p) => p.cell.day === focusedDay)?.idx ?? placed.length - 1)
				: placed.length - 1;
		rovingIdx = Math.max(0, seed);
	});

	function focusIdx(idx: number) {
		const clamped = Math.max(0, Math.min(placed.length - 1, idx));
		rovingIdx = clamped;
		buttons[clamped]?.focus();
	}

	const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];

	function onKey(e: KeyboardEvent, p: PlacedCell) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onPick(p.cell.day);
			return;
		}
		if (!NAV_KEYS.includes(e.key)) return;
		// Grid owns every arrow/Home/End: preventDefault unconditionally so an edge key (top/
		// bottom row, range bound) is a clean no-op, never a page scroll. Left/Right step ±1
		// calendar day; Up/Down move ±1 weekday WITHIN the same week column (no wrap — D2).
		e.preventDefault();
		let next: number | null = null;
		if (e.key === 'ArrowRight') next = p.idx + 1;
		else if (e.key === 'ArrowLeft') next = p.idx - 1;
		else if (e.key === 'ArrowDown') next = indexAt(placed, p.col, p.row + 1);
		else if (e.key === 'ArrowUp') next = indexAt(placed, p.col, p.row - 1);
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = placed.length - 1;
		if (next !== null && next >= 0 && next < placed.length) {
			focusIdx(next);
		}
	}

	const CELL = 14; // px per cell
	const GAP = 3;
</script>

<div class="heatmap" aria-label="Daily spend calendar">
	<div class="hm-head">
		<span class="hm-title">Daily spend · click a day to pin the dashboard</span>
		<div class="hm-legend" aria-hidden="true">
			<span class="lg-label">less</span>
			{#each COST_RAMP as c (c)}
				<span class="lg-swatch" style={`background:${c}`}></span>
			{/each}
			<span class="lg-label">more</span>
			<span class="lg-sep"></span>
			<span class="lg-swatch cov-zero" title="no usage"></span><span class="lg-label">$0</span>
			<span class="lg-swatch cov-missing" title="no data"></span><span class="lg-label">gap</span>
			<span class="lg-swatch cov-partial" title="partial"></span><span class="lg-label">partial</span>
		</div>
	</div>

	{#if placed.length === 0}
		<p class="hm-empty">No banked days yet.</p>
	{:else}
		<div class="hm-scroll">
			<div
				class="grid"
				role="group"
				data-heatmap-grid
				aria-label="Daily spend, one cell per day. Use arrow keys to move between days, Enter to pin."
				style={`--cell:${CELL}px;--gap:${GAP}px;grid-template-columns:repeat(${colCount}, var(--cell));grid-template-rows:repeat(7, var(--cell));`}
			>
				{#each placed as p (p.cell.day)}
					{@const cov = coverage(p.cell.day)}
					<button
						bind:this={buttons[p.idx]}
						type="button"
						class="cell cov-{cov}"
						class:focused={focusedDay === p.cell.day}
						style={`grid-column:${p.col + 1};grid-row:${p.row + 1};--shade:${cellShade(p)};`}
						tabindex={p.idx === rovingIdx ? 0 : -1}
						aria-label={ariaLabel(p)}
						aria-pressed={focusedDay === p.cell.day}
						onclick={() => {
							rovingIdx = p.idx;
							onPick(p.cell.day);
						}}
						onkeydown={(e) => onKey(e, p)}
					></button>
				{/each}
			</div>
		</div>
	{/if}

	<table class="visually-hidden">
		<caption>Daily spend with data coverage</caption>
		<thead>
			<tr><th>Day</th><th>Spend (USD)</th><th>Coverage</th></tr>
		</thead>
		<tbody>
			{#each cells as c (c.day)}
				<tr>
					<td>{fmtDay(c.day)}</td>
					<td>{money(c.cost)}</td>
					<td>{coverageWord(coverage(c.day))}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<!-- weekday legend kept out of the grid flow for AT; the grid itself is labelled per-cell -->
	<span class="visually-hidden">Rows are weekdays Monday to Sunday; columns are weeks.</span>
</div>

<style>
	.heatmap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.hm-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.hm-title {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	.hm-legend {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.68rem;
		color: var(--fg-dim);
	}
	.lg-label {
		margin: 0 2px;
	}
	.lg-sep {
		width: 1px;
		height: 12px;
		background: var(--border);
		margin: 0 4px;
	}
	.lg-swatch {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		display: inline-block;
		border: 1px solid var(--border);
	}
	.hm-scroll {
		overflow-x: auto;
		padding-bottom: 2px;
	}
	.grid {
		display: grid;
		gap: var(--gap);
		grid-auto-flow: column;
		width: max-content;
	}
	.cell {
		width: var(--cell);
		height: var(--cell);
		padding: 0;
		margin: 0;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--shade);
		cursor: pointer;
		transition:
			transform 0.1s,
			box-shadow 0.1s;
	}
	.cell:hover {
		transform: scale(1.18);
	}
	.cell:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.cell.focused {
		box-shadow: 0 0 0 2px var(--accent);
		border-color: var(--accent);
	}
	/* Coverage decoration: each state a distinct, non-color-only marker (design D4). */
	.cell.cov-zero {
		background: var(--surface-2);
	}
	.cell.cov-missing {
		background:
			repeating-linear-gradient(
				45deg,
				transparent,
				transparent 2px,
				color-mix(in srgb, var(--fg-dim) 40%, transparent) 2px,
				color-mix(in srgb, var(--fg-dim) 40%, transparent) 3px
			),
			var(--surface-1);
		border-style: dashed;
	}
	.cell.cov-partial {
		/* dashed warning border signalling "incomplete, may grow" */
		border-style: dashed;
		border-color: var(--warn);
	}
	/* legend swatch variants reuse the cell decoration look */
	.lg-swatch.cov-zero {
		background: var(--surface-2);
	}
	.lg-swatch.cov-missing {
		background:
			repeating-linear-gradient(
				45deg,
				transparent,
				transparent 2px,
				color-mix(in srgb, var(--fg-dim) 40%, transparent) 2px,
				color-mix(in srgb, var(--fg-dim) 40%, transparent) 3px
			),
			var(--surface-1);
		border-style: dashed;
	}
	.lg-swatch.cov-partial {
		border-style: dashed;
		border-color: var(--warn);
		background: color-mix(in srgb, var(--accent) 34%, var(--surface-1));
	}
	.hm-empty {
		color: var(--fg-dim);
		font-size: 0.82rem;
		margin: 0.5rem 0;
	}
</style>
