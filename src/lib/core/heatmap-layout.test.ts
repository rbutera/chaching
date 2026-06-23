import { describe, expect, it } from 'vitest';
import type { DayCell } from './view-model';
import type { DayCoverage } from '../types';
import {
	cellShade,
	columnCount,
	coverageClass,
	indexAt,
	makeCostScale,
	maxCost,
	placeCells,
	weekdayMon0,
	ZERO_SHADE,
	MISSING_SHADE,
	COST_RAMP
} from './heatmap-layout';

function cell(day: string, cost: number, coverage: DayCoverage = 'frozen', hasData = cost > 0): DayCell {
	return { day, cost, requests: hasData ? 1 : 0, hasData, coverage };
}

/** A contiguous run of cells from `from` for `n` days, costs supplied positionally. */
function run(from: string, costs: number[]): DayCell[] {
	const out: DayCell[] = [];
	let d = from;
	for (const c of costs) {
		out.push(cell(d, c));
		const dt = new Date(d + 'T00:00:00Z');
		dt.setUTCDate(dt.getUTCDate() + 1);
		d = dt.toISOString().slice(0, 10);
	}
	return out;
}

describe('heatmap-layout — grid placement', () => {
	it('places one cell per day in calendar order with a stable linear index', () => {
		// 2026-06-15 is a Monday.
		const cells = run('2026-06-15', [1, 2, 3, 4, 5, 6, 7, 8]); // Mon..next Mon
		const placed = placeCells(cells);
		expect(placed).toHaveLength(8);
		expect(placed.map((p) => p.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(placed.map((p) => p.cell.day)).toEqual(cells.map((c) => c.day));
	});

	it('rows are Mon..Sun (Mon=0) and a new column opens each Monday', () => {
		const cells = run('2026-06-15', [1, 1, 1, 1, 1, 1, 1, 1]); // Mon 15th .. Mon 22nd
		const placed = placeCells(cells);
		// Mon 15 -> row 0 col 0; Sun 21 -> row 6 col 0; Mon 22 -> row 0 col 1
		expect(placed[0]).toMatchObject({ row: 0, col: 0 }); // Mon 15
		expect(placed[6]).toMatchObject({ row: 6, col: 0 }); // Sun 21
		expect(placed[7]).toMatchObject({ row: 0, col: 1 }); // Mon 22
		expect(columnCount(placed)).toBe(2);
	});

	it('column 0 starts on the Monday on/before the first day (mid-week start)', () => {
		// 2026-06-17 is a Wednesday -> row 2, still col 0.
		const placed = placeCells(run('2026-06-17', [1, 1])); // Wed, Thu
		expect(placed[0]).toMatchObject({ row: 2, col: 0 });
		expect(placed[1]).toMatchObject({ row: 3, col: 0 });
		expect(weekdayMon0('2026-06-17')).toBe(2);
	});

	it('empty input -> no placement, zero columns', () => {
		expect(placeCells([])).toEqual([]);
		expect(columnCount([])).toBe(0);
	});
});

describe('heatmap-layout — indexAt (2-D grid keyboard nav)', () => {
	// 2026-06-15 = Monday; 9 days = Mon..next Tue (col 0 full + col 1 rows 0-1).
	const placed = placeCells(run('2026-06-15', [1, 1, 1, 1, 1, 1, 1, 1, 1]));

	it('Up/Down move within the same week column (no wrap across weeks)', () => {
		const wed = placed[2]; // col 0, row 2
		// down one weekday -> Thu (idx 3), up one -> Tue (idx 1), both same column
		expect(indexAt(placed, wed.col, wed.row + 1)).toBe(3);
		expect(indexAt(placed, wed.col, wed.row - 1)).toBe(1);
	});

	it('returns null at the top/bottom edge of a column (no diagonal jump)', () => {
		const mon = placed[0]; // col 0 row 0 — nothing above
		expect(indexAt(placed, mon.col, mon.row - 1)).toBeNull();
		const sun = placed[6]; // col 0 row 6 — nothing below
		expect(indexAt(placed, sun.col, sun.row + 1)).toBeNull();
	});

	it('returns null for a blank corner where no day sits', () => {
		// col 1 only has rows 0,1 (Mon 22, Tue 23); row 5 of col 1 is blank
		expect(indexAt(placed, 1, 5)).toBeNull();
	});

	it('out-of-bounds row is null', () => {
		expect(indexAt(placed, 0, 7)).toBeNull();
		expect(indexAt(placed, 0, -1)).toBeNull();
	});
});

describe('heatmap-layout — cost quantize', () => {
	it('orders shade steps by cost (higher cost -> stronger step)', () => {
		const cells = run('2026-06-15', [1, 5, 20]);
		const scale = makeCostScale(cells);
		const lo = scale(1);
		const mid = scale(5);
		const hi = scale(20);
		// the ramp is ordered weakest..strongest; index in the ramp must be non-decreasing with cost
		const iLo = COST_RAMP.indexOf(lo as (typeof COST_RAMP)[number]);
		const iMid = COST_RAMP.indexOf(mid as (typeof COST_RAMP)[number]);
		const iHi = COST_RAMP.indexOf(hi as (typeof COST_RAMP)[number]);
		expect(iLo).toBeGreaterThanOrEqual(0);
		expect(iLo).toBeLessThanOrEqual(iMid);
		expect(iMid).toBeLessThanOrEqual(iHi);
		expect(iHi).toBe(COST_RAMP.length - 1); // the max-cost day hits the top step
	});

	it('does not NaN when every day is $0 (domain top falls back to 1)', () => {
		const cells = run('2026-06-15', [0, 0, 0]);
		expect(maxCost(cells)).toBe(0);
		const scale = makeCostScale(cells);
		expect(() => scale(0)).not.toThrow();
		expect(typeof scale(0)).toBe('string');
	});
});

describe('heatmap-layout — coverage decoration', () => {
	it('a $0 present day gets the zero shade, not blank', () => {
		const scale = makeCostScale([cell('2026-06-15', 0, 'zero')]);
		expect(cellShade(cell('2026-06-15', 0, 'zero'), 'zero', scale)).toBe(ZERO_SHADE);
		expect(cellShade(cell('2026-06-15', 0, 'zero'), 'zero', scale)).not.toBe(MISSING_SHADE);
	});

	it('a missing gap day is transparent (its hatch class carries the mark)', () => {
		const scale = makeCostScale([cell('2026-06-16', 0, 'missing', false)]);
		expect(cellShade(cell('2026-06-16', 0, 'missing', false), 'missing', scale)).toBe(MISSING_SHADE);
	});

	it('a frozen spend day gets a ramp step', () => {
		const cells = run('2026-06-15', [10]);
		const scale = makeCostScale(cells);
		const shade = cellShade(cells[0], 'frozen', scale);
		expect(COST_RAMP).toContain(shade);
	});

	it('each coverage state maps to a distinct cov-* class', () => {
		const classes = (['frozen', 'partial', 'missing', 'zero'] as DayCoverage[]).map(coverageClass);
		expect(classes).toEqual(['cov-frozen', 'cov-partial', 'cov-missing', 'cov-zero']);
		expect(new Set(classes).size).toBe(4); // all distinct
	});
});
