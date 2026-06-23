import { describe, expect, it } from 'vitest';
import type { DayCoverage } from '../types';
import type { CoverageSummary } from './aggregate';
import {
	ariaProvenance,
	barFill,
	coverageGlyph,
	coverageSub,
	coverageWord,
	tooltipSuffix
} from './coverage-marks';

function sum(worst: DayCoverage, states: CoverageSummary['states'] = { [worst]: 1 }): CoverageSummary {
	return { worst, states };
}

describe('coverage marks', () => {
	it('barFill maps worst state to a non-colour structural treatment', () => {
		expect(barFill(sum('frozen'))).toBe('normal');
		expect(barFill(sum('partial'))).toBe('hatched');
		expect(barFill(sum('zero'))).toBe('zero');
		expect(barFill(sum('missing'))).toBe('dash');
	});

	it('missing is structurally distinct from a frozen $0 (dash vs zero bar)', () => {
		expect(barFill(sum('missing'))).not.toBe(barFill(sum('zero')));
	});

	it('partial copy distinguishes today (live tail) from a past gated-partial day', () => {
		// today: "so far today"; a PAST partial day must NOT claim "today" (design D1).
		expect(tooltipSuffix(sum('partial'), true)).toBe('so far today');
		expect(tooltipSuffix(sum('partial'), false)).not.toContain('today');
		expect(tooltipSuffix(sum('partial'), false)).toContain('partial');
		expect(ariaProvenance(sum('partial'), true)).toContain('so far today');
		expect(ariaProvenance(sum('partial'), false)).not.toContain('today');
	});

	it('frozen $0 day tooltip says "(no usage)", a frozen-with-spend day is unannotated', () => {
		expect(tooltipSuffix(sum('zero'))).toContain('no usage');
		expect(tooltipSuffix(sum('frozen'))).toBe('');
	});

	it('missing day tooltip says no data, distinct from $0', () => {
		expect(tooltipSuffix(sum('missing'))).toContain('no data');
		expect(tooltipSuffix(sum('missing'))).not.toEqual(tooltipSuffix(sum('zero')));
	});

	it('aria provenance is always non-empty and conveys the state by word', () => {
		for (const s of ['frozen', 'partial', 'zero', 'missing'] as DayCoverage[]) {
			expect(ariaProvenance(sum(s)).length).toBeGreaterThan(0);
		}
		expect(ariaProvenance(sum('partial'))).toContain('partial');
		expect(ariaProvenance(sum('missing'))).toContain('no data');
	});

	it('coverageWord + glyph: a word always exists (NO_COLOR-safe), glyph is decorative', () => {
		for (const s of ['frozen', 'partial', 'zero', 'missing'] as DayCoverage[]) {
			expect(coverageWord(s).length).toBeGreaterThan(0);
			expect(coverageGlyph(s).length).toBeGreaterThan(0);
		}
		// distinct words per state so provenance survives without colour.
		const words = new Set(['frozen', 'partial', 'zero', 'missing'].map((s) => coverageWord(s as DayCoverage)));
		expect(words.size).toBe(4);
	});

	it('coverageSub: partial -> includes-today; gap-only -> gaps; all-frozen -> null', () => {
		expect(coverageSub({ worst: 'partial', states: { frozen: 6, partial: 1 } }, true)).toBe('includes today (partial)');
		// a partial window whose partial day is NOT today reads honestly (no "today" claim).
		expect(coverageSub({ worst: 'partial', states: { frozen: 6, partial: 1 } }, false)).toBe('includes a partial day');
		expect(coverageSub({ worst: 'missing', states: { frozen: 5, missing: 2 } })).toBe('gaps in range');
		expect(coverageSub({ worst: 'frozen', states: { frozen: 7 } })).toBeNull();
		// partial wins over a coincident gap.
		expect(coverageSub({ worst: 'missing', states: { partial: 1, missing: 2 } }, true)).toBe('includes today (partial)');
	});
});
