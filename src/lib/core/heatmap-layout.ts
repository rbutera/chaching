// Pure, framework-free layout + decoration helpers for CalendarHeatmap.svelte. Extracted
// here (not inline in the component) so the grid placement, cost->shade-step quantize, and
// coverage class selection are unit-testable in a plain node env and reusable by a future
// Ink TUI heatmap — the same "math is pure + shared" invariant the rest of the view-model
// holds. The Svelte component is a thin renderer over these.

import { scaleQuantize } from 'd3-scale';
import type { DayCoverage } from '../types';
import type { DayCell } from './view-model';
import { addDaysISO } from './view-model';

/** Mon=0..Sun=6 weekday index of a YYYY-MM-DD day (UTC). */
export function weekdayMon0(day: string): number {
	const d = new Date(day + 'T00:00:00Z').getUTCDay(); // Sun=0..Sat=6
	return (d + 6) % 7;
}

/** A cell placed on the contributions grid: col = ISO-week column, row = weekday, idx = order. */
export interface PlacedCell {
	cell: DayCell;
	col: number;
	row: number;
	/** linear index into the day-ordered button list (roving tabindex / arrow nav) */
	idx: number;
}

/**
 * Lay the cells out GitHub-contributions style: column 0 begins on the Monday on/before the
 * first day, each Monday opens a new column, rows are Mon..Sun. Days stay in calendar order
 * so the linear index matches the visually-hidden table + arrow stepping.
 */
export function placeCells(cells: DayCell[]): PlacedCell[] {
	if (cells.length === 0) return [];
	const week0Mon = addDaysISO(cells[0].day, -weekdayMon0(cells[0].day));
	const week0MonTs = new Date(week0Mon + 'T00:00:00Z').getTime();
	const msPerDay = 86400000;
	return cells.map((cell, idx) => {
		const ts = new Date(cell.day + 'T00:00:00Z').getTime();
		const col = Math.floor((ts - week0MonTs) / msPerDay / 7);
		return { cell, col, row: weekdayMon0(cell.day), idx };
	});
}

/** Column count for the placed grid. */
export function columnCount(placed: PlacedCell[]): number {
	return placed.length ? Math.max(...placed.map((p) => p.col)) + 1 : 0;
}

/**
 * The linear index of the cell at (col, row), or null if no day sits there (a blank corner
 * of the first/last week column). Used for true 2-D grid keyboard nav: Left/Right step ±1
 * calendar day (the linear neighbour), Up/Down move ±1 weekday WITHIN the same week column
 * (so vertical nav never wraps into an adjacent week — design D2 / WAI grid). Returns null at
 * a grid edge so the caller can no-op instead of jumping diagonally.
 */
export function indexAt(placed: PlacedCell[], col: number, row: number): number | null {
	if (row < 0 || row > 6 || col < 0) return null;
	const hit = placed.find((p) => p.col === col && p.row === row);
	return hit ? hit.idx : null;
}

// Colorblind-safe accent-mix ramp (design D3): the accent mixed into surface at rising
// strength. 5 present steps; the empty/zero step is a distinct surface color (not in the ramp).
export const COST_RAMP = [
	'color-mix(in srgb, var(--accent) 16%, var(--surface-1))',
	'color-mix(in srgb, var(--accent) 34%, var(--surface-1))',
	'color-mix(in srgb, var(--accent) 52%, var(--surface-1))',
	'color-mix(in srgb, var(--accent) 72%, var(--surface-1))',
	'color-mix(in srgb, var(--accent) 92%, var(--surface-1))'
] as const;

/** The maximum cost across the cells (the quantize domain top); 0 when all-empty. */
export function maxCost(cells: DayCell[]): number {
	return cells.reduce((m, c) => (c.cost > m ? c.cost : m), 0);
}

/** A cost->ramp-step quantizer. Domain top is max cost (or 1 when all-zero, so it never NaNs). */
export function makeCostScale(cells: DayCell[]) {
	const max = maxCost(cells);
	return scaleQuantize<string>()
		.domain([0, max > 0 ? max : 1])
		.range([...COST_RAMP]);
}

/** The zero/no-usage shade (a present-but-$0 day), distinct from a blank/missing cell. */
export const ZERO_SHADE = 'var(--surface-2)';
/** A missing (gap) day renders no cost fill — the dashed/hatched coverage class carries it. */
export const MISSING_SHADE = 'transparent';

/**
 * The background fill for a cell: a missing day is transparent (its coverage class hatches it),
 * a present $0 day gets the distinct zero shade, otherwise the cost ramp step. Coverage decorates
 * ON TOP via the `cov-*` class; this is just the cost layer (design D4).
 */
export function cellShade(
	cell: DayCell,
	cov: DayCoverage,
	scale: ReturnType<typeof makeCostScale>
): string {
	if (cov === 'missing') return MISSING_SHADE;
	if (cell.cost <= 0) return ZERO_SHADE;
	return scale(cell.cost);
}

/** The CSS class suffix for a coverage state (the `cov-<state>` decoration class). */
export function coverageClass(cov: DayCoverage): string {
	return `cov-${cov}`;
}
