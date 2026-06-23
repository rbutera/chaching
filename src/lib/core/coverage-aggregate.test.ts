import { describe, expect, it } from 'vitest';
import type { CoverageMap, DayModelAgg, RollupSnapshot, TokenCounts } from '../types';
import { aggregateByPeriod, sumGrain, summarizeCoverage, dayCoverageState } from './aggregate';
import { defaultViewState, heroTotals, scopedTotals, trend, enumerateDays } from './view-model';

function toks(input = 0): TokenCounts {
	return { input, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function dm(day: string, cost: number, provider = 'claude', model = 'claude-opus-4-8'): DayModelAgg {
	return { day, provider, model, tokens: toks(cost * 1000), requests: 1, cost, costUnknownRequests: 0 };
}

function snapFrom(grain: DayModelAgg[], coverage: CoverageMap, over: Partial<RollupSnapshot> = {}): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	return {
		generatedAt: 0,
		earliestDay: days[0] ?? null,
		latestDay: days[days.length - 1] ?? null,
		totals: {
			tokens: toks(0),
			requests: grain.reduce((a, g) => a + g.requests, 0),
			cost: grain.reduce((a, g) => a + g.cost, 0),
			costUnknownRequests: 0
		},
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage,
		...over
	};
}

describe('summarizeCoverage', () => {
	it('counts each state and picks the worst (missing > partial > zero > frozen)', () => {
		const map: CoverageMap = { '2026-06-18': 'frozen', '2026-06-19': 'zero', '2026-06-20': 'partial' };
		const days = ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21']; // 21 absent -> missing
		const s = summarizeCoverage(days, map);
		expect(s.states).toEqual({ frozen: 1, zero: 1, partial: 1, missing: 1 });
		expect(s.worst).toBe('missing');
	});

	it('an all-frozen window is authoritative (worst === frozen)', () => {
		const map: CoverageMap = { '2026-06-18': 'frozen', '2026-06-19': 'frozen' };
		const s = summarizeCoverage(['2026-06-18', '2026-06-19'], map);
		expect(s.worst).toBe('frozen');
	});

	it('a window with today (partial) but no gap reports worst === partial', () => {
		const map: CoverageMap = { '2026-06-18': 'frozen', '2026-06-19': 'partial' };
		const s = summarizeCoverage(['2026-06-18', '2026-06-19'], map);
		expect(s.worst).toBe('partial');
	});

	it('absent-from-map day defaults to missing', () => {
		expect(dayCoverageState('2026-06-30', {})).toBe('missing');
		expect(dayCoverageState('2026-06-30', { '2026-06-30': 'frozen' })).toBe('frozen');
	});
});

describe('aggregateByPeriod coverage fold', () => {
	it('bucket spanning frozen + partial-today days counts both, worst === partial (day grain)', () => {
		const grain = [dm('2026-06-22', 5), dm('2026-06-23', 2)];
		const map: CoverageMap = { '2026-06-22': 'frozen', '2026-06-23': 'partial' };
		const days = ['2026-06-22', '2026-06-23'];
		const buckets = aggregateByPeriod(grain, 'day', null, null, { map, days });
		const b22 = buckets.find((b) => b.key === '2026-06-22')!;
		const b23 = buckets.find((b) => b.key === '2026-06-23')!;
		expect(b22.coverage.worst).toBe('frozen');
		expect(b23.coverage.worst).toBe('partial');
	});

	it('week bucket spanning frozen + partial reports states for both and worst === partial', () => {
		// two days in the same ISO week.
		const grain = [dm('2026-06-22', 5), dm('2026-06-23', 2)];
		const map: CoverageMap = { '2026-06-22': 'frozen', '2026-06-23': 'partial' };
		const days = ['2026-06-22', '2026-06-23'];
		const buckets = aggregateByPeriod(grain, 'week', null, null, { map, days });
		expect(buckets).toHaveLength(1);
		expect(buckets[0].coverage.states).toEqual({ frozen: 1, partial: 1 });
		expect(buckets[0].coverage.worst).toBe('partial');
	});

	it('materializes a coverage-only bucket for a missing/zero day with no spend rows', () => {
		const grain = [dm('2026-06-22', 5)];
		const map: CoverageMap = { '2026-06-22': 'frozen' }; // 23 is a gap
		const days = ['2026-06-22', '2026-06-23'];
		const buckets = aggregateByPeriod(grain, 'day', null, null, { map, days });
		const gap = buckets.find((b) => b.key === '2026-06-23')!;
		expect(gap).toBeTruthy();
		expect(gap.cost).toBe(0);
		expect(gap.coverage.worst).toBe('missing');
	});

	it('coverage is filter-invariant: identical across provider filter sets', () => {
		const grain = [dm('2026-06-22', 5, 'claude'), dm('2026-06-22', 3, 'codex')];
		const map: CoverageMap = { '2026-06-22': 'frozen' };
		const days = ['2026-06-22'];
		const all = aggregateByPeriod(grain, 'day', null, null, { map, days });
		const claudeOnly = aggregateByPeriod(grain, 'day', null, new Set(['claude']), { map, days });
		expect(all[0].coverage).toEqual(claudeOnly[0].coverage);
		// only spend scopes:
		expect(all[0].cost).toBe(8);
		expect(claudeOnly[0].cost).toBe(5);
	});
});

describe('sumGrain coverage fold', () => {
	it('window with a retention gap reports states.missing > 0 and worst === missing', () => {
		const grain = [dm('2026-06-20', 5), dm('2026-06-22', 3)];
		const map: CoverageMap = { '2026-06-20': 'frozen', '2026-06-22': 'frozen' };
		const days = enumerateDays('2026-06-20', '2026-06-22'); // 21 is the gap
		const t = sumGrain(grain, { from: '2026-06-20', to: '2026-06-22', coverage: { map, days } });
		expect((t.coverage.states.missing ?? 0)).toBeGreaterThan(0);
		expect(t.coverage.worst).toBe('missing');
	});

	it('all-frozen window is authoritative', () => {
		const grain = [dm('2026-06-20', 5), dm('2026-06-21', 3)];
		const map: CoverageMap = { '2026-06-20': 'frozen', '2026-06-21': 'frozen' };
		const days = enumerateDays('2026-06-20', '2026-06-21');
		const t = sumGrain(grain, { from: '2026-06-20', to: '2026-06-21', coverage: { map, days } });
		expect(t.coverage.worst).toBe('frozen');
	});
});

describe('view-model coverage integration', () => {
	it('Σ per-day states == window day count (every in-window day classified once)', () => {
		// A 7-day window, mix of frozen + a gap + partial today.
		const grain = [dm('2026-06-17', 4), dm('2026-06-23', 2)];
		const coverage: CoverageMap = {
			'2026-06-17': 'frozen',
			'2026-06-18': 'frozen',
			'2026-06-19': 'zero',
			'2026-06-23': 'partial'
		};
		const snap = snapFrom(grain, coverage);
		const t = scopedTotals(snap, defaultViewState('week'));
		const sum = Object.values(t.coverage.states).reduce((a, n) => a + (n ?? 0), 0);
		// week window is 7 inclusive days ending on latestDay (2026-06-23).
		expect(sum).toBe(7);
	});

	it('honest baseline: prior window all frozen/zero AND prior cost > 0 -> true', () => {
		// latest 2026-06-23; week prior window = 06-09..06-15. Make all those frozen w/ cost.
		const grain: DayModelAgg[] = [];
		const coverage: CoverageMap = {};
		for (let d = 9; d <= 23; d++) {
			const day = `2026-06-${String(d).padStart(2, '0')}`;
			grain.push(dm(day, 3));
			coverage[day] = d === 23 ? 'partial' : 'frozen';
		}
		const snap = snapFrom(grain, coverage);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.priorHasBaseline).toBe(true);
	});

	it('honest baseline: a partial/missing day in the prior window -> false (suppress)', () => {
		const grain: DayModelAgg[] = [];
		const coverage: CoverageMap = {};
		for (let d = 9; d <= 23; d++) {
			const day = `2026-06-${String(d).padStart(2, '0')}`;
			grain.push(dm(day, 3));
			coverage[day] = d === 23 ? 'partial' : 'frozen';
		}
		// poison one prior-window day (06-12) to partial.
		coverage['2026-06-12'] = 'partial';
		const snap = snapFrom(grain, coverage);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.priorHasBaseline).toBe(false);
	});

	it('trend day buckets carry per-day coverage incl. missing for gap days', () => {
		const grain = [dm('2026-06-23', 2)];
		const coverage: CoverageMap = { '2026-06-23': 'partial' }; // the rest of the week is a gap
		const snap = snapFrom(grain, coverage);
		const buckets = trend(snap, defaultViewState('week'));
		const today = buckets.find((b) => b.key === '2026-06-23')!;
		const gap = buckets.find((b) => b.key === '2026-06-22')!;
		expect(today.coverage.worst).toBe('partial');
		expect(gap.coverage.worst).toBe('missing');
	});

	it('period change recomputes coverage-derived worst', () => {
		const grain: DayModelAgg[] = [];
		const coverage: CoverageMap = {};
		for (let d = 9; d <= 23; d++) {
			const day = `2026-06-${String(d).padStart(2, '0')}`;
			grain.push(dm(day, 3));
			coverage[day] = d === 23 ? 'partial' : 'frozen';
		}
		const snap = snapFrom(grain, coverage);
		// 'day' window = just today (partial). 'week' includes today too -> partial.
		const dayT = scopedTotals(snap, defaultViewState('day'));
		expect(dayT.coverage.worst).toBe('partial');
		// a window of only frozen days: scope to a prior frozen-only span via 'month' still
		// includes today; assert today-containing windows are >= partial.
		const weekT = scopedTotals(snap, defaultViewState('week'));
		expect(weekT.coverage.worst).toBe('partial');
	});
});
