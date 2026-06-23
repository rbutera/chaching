import { describe, expect, it } from 'vitest';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '../types';
import type { PeriodBucket } from './aggregate';
import { pctDelta } from '../format';
import {
	addDaysISO,
	allSessions,
	bucketDayRange,
	byDay,
	clampDay,
	defaultViewState,
	dayOf,
	focusedModels,
	focusedSessions,
	focusedTotals,
	heroTotals,
	inWindow,
	isLive,
	models,
	periodWindow,
	providers,
	scopedSessions,
	scopedTotals,
	todayUTC,
	trend,
	type ViewState
} from './view-model';
import { sumGrain } from './aggregate';
import type { SessionSummary } from '../types';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

function dm(day: string, provider: string, model: string, cost: number, requests = 1): DayModelAgg {
	return { day, provider, model, tokens: toks(cost * 1000), requests, cost, costUnknownRequests: 0 };
}

/**
 * Build a snapshot from a flat grain; latest/earliest derived from days present.
 * Synthesizes a realistic coverage map (the freeze model these fixtures stand in for):
 * the latest day is the live tail (`partial`); every earlier day with spend is `frozen`,
 * a $0 earlier day is `zero`. This makes the honest-baseline tests read the same typed
 * coverage source the runtime uses (post-glow-up #2), instead of an empty map.
 */
function snapFrom(grain: DayModelAgg[]): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const totalCost = grain.reduce((a, g) => a + g.cost, 0);
	const totalReq = grain.reduce((a, g) => a + g.requests, 0);
	const latest = days[days.length - 1] ?? null;
	const spendByDay = new Map<string, number>();
	for (const g of grain) spendByDay.set(g.day, (spendByDay.get(g.day) ?? 0) + g.cost);
	const coverage: Record<string, 'frozen' | 'partial' | 'zero'> = {};
	for (const day of new Set(days)) {
		if (day === latest) coverage[day] = 'partial';
		else coverage[day] = (spendByDay.get(day) ?? 0) > 0 ? 'frozen' : 'zero';
	}
	return {
		generatedAt: 0,
		earliestDay: days[0] ?? null,
		latestDay: latest,
		totals: { tokens: toks(0), requests: totalReq, cost: totalCost, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage
	};
}

function withFilter(base: ViewState, providerFilter: string[]): ViewState {
	return { ...base, providerFilter: new Set(providerFilter) };
}

describe('shared view-model — provider filter', () => {
	// A small fixed window ending on the latest day so day/week/month all include it.
	const grain = [
		dm('2026-06-19', 'codex', 'claude-opus-4-8', 10),
		dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 4),
		dm('2026-06-18', 'codex', 'claude-opus-4-8', 6),
		dm('2026-06-18', 'opencode', 'claude-sonnet-4-5', 2)
	];
	const snap = snapFrom(grain);

	it('scopes summary totals to the selected providers', () => {
		const all = scopedTotals(snap, defaultViewState('week'));
		const codexOnly = scopedTotals(snap, withFilter(defaultViewState('week'), ['codex']));
		const both = scopedTotals(snap, withFilter(defaultViewState('week'), ['codex', 'opencode']));

		expect(codexOnly.cost).toBe(16); // 10 + 6
		// distinct when both providers have spend (derived-data map assertion)
		expect(codexOnly.cost).not.toBe(both.cost);
		// the {codex,opencode} filter equals the unscoped total here
		expect(both.cost).toBeCloseTo(all.cost, 10);
	});

	it('Σ per-provider scoped totals == unscoped total', () => {
		const base = defaultViewState('week');
		const unscoped = scopedTotals(snap, base);
		const perProvider = snap.providers
			.map((p) => scopedTotals(snap, withFilter(base, [p])).cost)
			.reduce((a, c) => a + c, 0);
		expect(perProvider).toBeCloseTo(unscoped.cost, 10);
	});

	it('scopes the model breakdown to the selected providers', () => {
		const codexModels = models(snap, withFilter(defaultViewState('week'), ['codex']));
		expect(codexModels.map((m) => m.model)).toEqual(['claude-opus-4-8']);
		const allModels = models(snap, defaultViewState('week'));
		expect(allModels.length).toBe(2);
	});

	it('scopes the trend series to the selected providers', () => {
		const allTrend = trend(snap, defaultViewState('day'));
		const codexTrend = trend(snap, withFilter(defaultViewState('day'), ['codex']));
		// same bucket count (both providers active on both days), different cost
		const allLatest = allTrend.find((b) => b.key === '2026-06-19')!;
		const codexLatest = codexTrend.find((b) => b.key === '2026-06-19')!;
		expect(allLatest.cost).toBe(14);
		expect(codexLatest.cost).toBe(10);
	});

	it('scopes the hero totals to the selected providers', () => {
		const all = heroTotals(snap, defaultViewState('day'));
		const codex = heroTotals(snap, withFilter(defaultViewState('day'), ['codex']));
		expect(all.current.cost).toBe(14);
		expect(codex.current.cost).toBe(10);
	});
});

describe('shared view-model — period derivations', () => {
	// A 40-day descending stream of $1/day so windows have distinct sums.
	const grain: DayModelAgg[] = [];
	for (let i = 0; i < 40; i++) {
		const d = new Date(Date.UTC(2026, 5, 19));
		d.setUTCDate(d.getUTCDate() - i);
		grain.push(dm(d.toISOString().slice(0, 10), 'codex', 'claude-opus-4-8', 1));
	}
	const snap = snapFrom(grain);

	it('period window sums differ across day/week/month', () => {
		const day = scopedTotals(snap, defaultViewState('day')).cost;
		const week = scopedTotals(snap, defaultViewState('week')).cost;
		const month = scopedTotals(snap, defaultViewState('month')).cost;
		expect(day).toBe(1); // latest day only
		expect(week).toBe(7); // last 7 days
		expect(month).toBe(30); // last 30 days
		expect(day).toBeLessThan(week);
		expect(week).toBeLessThan(month);
	});

	it('trend is one day-bucket per day in the period window', () => {
		// the trend is always day-grain, scoped to the period window: day=1 bar,
		// week=7 bars, month=30 bars (one per day with data in the window).
		const dayBuckets = trend(snap, defaultViewState('day')).length;
		const weekBuckets = trend(snap, defaultViewState('week')).length;
		const monthBuckets = trend(snap, defaultViewState('month')).length;
		expect(dayBuckets).toBe(1);
		expect(weekBuckets).toBe(7);
		expect(monthBuckets).toBe(30);
		// every bucket key is a YYYY-MM-DD day (never a week/month key)
		for (const b of trend(snap, defaultViewState('month'))) {
			expect(b.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it('sum across trend buckets equals the scoped period total', () => {
		// the bar chart covers exactly the period window, so its bars sum to the
		// summary-card total for that same window.
		const check = (s: ViewState) => {
			const barSum = trend(snap, s).reduce((a, b) => a + b.cost, 0);
			expect(barSum).toBeCloseTo(scopedTotals(snap, s).cost, 10);
		};
		check(defaultViewState('day'));
		check(defaultViewState('week'));
		check(defaultViewState('month'));
	});

	it('periodWindow boundaries differ across periods', () => {
		const d = periodWindow(snap, defaultViewState('day'));
		const w = periodWindow(snap, defaultViewState('week'));
		const m = periodWindow(snap, defaultViewState('month'));
		expect(d.to).toBe('2026-06-19');
		expect(d.from).toBe('2026-06-19');
		expect(w.from).toBe('2026-06-13');
		expect(m.from).toBe('2026-05-21');
	});
});

describe('shared view-model — honest delta baseline rule', () => {
	// The rule (v1.4.1): show the delta ONLY when a genuine equal-length prior
	// window of real data exists — the ENTIRE prior window lies within the days we
	// have data for [earliestDay, latestDay] AND the prior total is non-zero.
	// Otherwise priorHasBaseline=false and the UI suppresses the percentage.

	it('full baseline: prior window fully inside data and non-zero → delta shows', () => {
		// 21 contiguous days of $1/day ending 06-19. Week view: window 06-13..06-19
		// (prior 06-06..06-12) sits wholly inside the data, prior sums to $7.
		const grain: DayModelAgg[] = [];
		for (let i = 0; i < 21; i++) {
			const d = new Date(Date.UTC(2026, 5, 19));
			d.setUTCDate(d.getUTCDate() - i);
			grain.push(dm(d.toISOString().slice(0, 10), 'codex', 'claude-opus-4-8', 1));
		}
		const snap = snapFrom(grain);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.priorHasBaseline).toBe(true);
		expect(hero.current.cost).toBe(7);
		expect(hero.prior.cost).toBe(7);
	});

	it('empty/partial prior window (predates earliest) → suppressed', () => {
		// Only the single latest day has data; a Week view's prior window
		// (06-06..06-12) is entirely before earliestDay → no baseline.
		const snap = snapFrom([dm('2026-06-19', 'codex', 'claude-opus-4-8', 10)]);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.priorHasBaseline).toBe(false);
	});

	it('prior window that only PARTIALLY overlaps the data span → suppressed', () => {
		// Data starts mid prior-window: earliest 06-10, prior window 06-06..06-12.
		// priorFrom (06-06) < earliest (06-10) → the prior window runs off the front
		// of the data, so it is not a full equal-length baseline. Suppress.
		const snap = snapFrom([
			dm('2026-06-19', 'codex', 'claude-opus-4-8', 10),
			dm('2026-06-10', 'codex', 'claude-opus-4-8', 4) // inside prior window but earliest
		]);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.priorHasBaseline).toBe(false);
	});

	it('zero prior (real $0 record, full window inside data) → suppressed, no divide-by-zero', () => {
		// Prior window fully inside the data but the prior total is $0 → the
		// percentage would be meaningless / divide-by-zero, so we suppress.
		const grain: DayModelAgg[] = [
			dm('2026-06-19', 'codex', 'claude-opus-4-8', 10) // current week
		];
		// fill the prior window (06-06..06-12) with real $0 records and the gap
		// days (06-13..06-18) too so earliestDay <= priorFrom.
		for (let day = '2026-06-06'; day <= '2026-06-18'; day = addDaysISO(day, 1)) {
			grain.push(dm(day, 'codex', 'claude-opus-4-8', 0));
		}
		const snap = snapFrom(grain);
		const hero = heroTotals(snap, defaultViewState('week'));
		expect(hero.prior.cost).toBe(0);
		expect(hero.priorHasBaseline).toBe(false);
		// the formatter must also not emit a percentage / Infinity for a $0 prior
		const delta = pctDelta(hero.current.cost, hero.prior.cost, hero.priorHasBaseline);
		expect(delta).toBeNull();
	});

	it('all-time window → no meaningful prior → suppressed', () => {
		const grain: DayModelAgg[] = [];
		for (let i = 0; i < 21; i++) {
			const d = new Date(Date.UTC(2026, 5, 19));
			d.setUTCDate(d.getUTCDate() - i);
			grain.push(dm(d.toISOString().slice(0, 10), 'codex', 'claude-opus-4-8', 1));
		}
		const snap = snapFrom(grain);
		const hero = heroTotals(snap, defaultViewState('all'));
		expect(hero.current.cost).toBe(21); // the whole banked range
		expect(hero.priorHasBaseline).toBe(false);
	});
});

describe('shared view-model — All / Quarter windows + long-span trend grain', () => {
	// 60 contiguous days of $1/day ending 06-19 (banked history > 45 days).
	const grain: DayModelAgg[] = [];
	for (let i = 0; i < 60; i++) {
		const d = new Date(Date.UTC(2026, 5, 19));
		d.setUTCDate(d.getUTCDate() - i);
		grain.push(dm(d.toISOString().slice(0, 10), 'codex', 'claude-opus-4-8', 1));
	}
	const snap = snapFrom(grain);

	it('All period spans earliest..latest and totals the full history', () => {
		const w = periodWindow(snap, defaultViewState('all'));
		expect(w.from).toBe(snap.earliestDay);
		expect(w.to).toBe(snap.latestDay);
		expect(w.label).toBe('All time');
		expect(scopedTotals(snap, defaultViewState('all')).cost).toBe(60);
	});

	it('Quarter period is the rolling last 90 days (capped by available data here)', () => {
		const w = periodWindow(snap, defaultViewState('quarter'));
		expect(w.to).toBe('2026-06-19');
		expect(w.from).toBe(addDaysISO('2026-06-19', -89));
		// only 60 days of data exist, so the quarter total is the full 60
		expect(scopedTotals(snap, defaultViewState('quarter')).cost).toBe(60);
	});

	it('long-span trend buckets by WEEK (not 60 daily slivers) and stays legible', () => {
		const buckets = trend(snap, defaultViewState('all'));
		// 60 days bucketed by week → roughly 9-10 bars, never 60.
		expect(buckets.length).toBeLessThanOrEqual(11);
		expect(buckets.length).toBeGreaterThan(1);
		// every bucket key is an ISO week, not a bare day
		for (const b of buckets) expect(b.key).toMatch(/^\d{4}-W\d{2}$/);
		// the buckets still sum to the full scoped total (no spend lost in bucketing)
		const sum = buckets.reduce((a, b) => a + b.cost, 0);
		expect(sum).toBeCloseTo(scopedTotals(snap, defaultViewState('all')).cost, 10);
	});

	it('short spans still render one bar per calendar day', () => {
		const weekBuckets = trend(snap, defaultViewState('week'));
		expect(weekBuckets.length).toBe(7);
		for (const b of weekBuckets) expect(b.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('shared view-model — bucketDayRange (coarse-bar drill range)', () => {
	it('a day-key bucket drills a single day', () => {
		const b: PeriodBucket = {
			key: '2026-06-19',
			startDay: '2026-06-19',
			tokens: toks(0),
			requests: 0,
			cost: 0,
			costUnknownRequests: 0,
			byModel: new Map(),
			coverage: { states: {}, worst: 'frozen' }
		};
		expect(bucketDayRange(b)).toEqual({ from: '2026-06-19', to: '2026-06-19' });
	});

	it('an ISO-week-key bucket drills Monday..Sunday of that week', () => {
		// 2026-W25 = 2026-06-15 (Mon) .. 2026-06-21 (Sun)
		const b: PeriodBucket = {
			key: '2026-W25',
			startDay: '2026-06-16',
			tokens: toks(0),
			requests: 0,
			cost: 0,
			costUnknownRequests: 0,
			byModel: new Map(),
			coverage: { states: {}, worst: 'frozen' }
		};
		expect(bucketDayRange(b)).toEqual({ from: '2026-06-15', to: '2026-06-21' });
	});

	it('a month-key bucket drills the 1st..last day of the month', () => {
		const b: PeriodBucket = {
			key: '2026-02',
			startDay: '2026-02-03',
			tokens: toks(0),
			requests: 0,
			cost: 0,
			costUnknownRequests: 0,
			byModel: new Map(),
			coverage: { states: {}, worst: 'frozen' }
		};
		expect(bucketDayRange(b)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
	});

	it('clamps an edge coarse bucket to the active window (no spill beyond the bar)', () => {
		// A weekly bar at the front of the window: the ISO week is 06-15..06-21 but
		// the window starts 06-18, so the bar only aggregated 06-18..06-21. The
		// drill must clamp to the window, not drill the whole calendar week.
		const b: PeriodBucket = {
			key: '2026-W25', // 2026-06-15 .. 2026-06-21
			startDay: '2026-06-18',
			tokens: toks(0),
			requests: 0,
			cost: 0,
			costUnknownRequests: 0,
			byModel: new Map(),
			coverage: { states: {}, worst: 'frozen' }
		};
		expect(bucketDayRange(b, { from: '2026-06-18', to: '2026-06-20' })).toEqual({
			from: '2026-06-18',
			to: '2026-06-20'
		});
	});
});

describe('shared view-model — per-model bucket stacking', () => {
	it('Σ per-model segments == the bucket total for every bar', () => {
		const grain = [
			dm('2026-06-19', 'codex', 'claude-opus-4-8', 7),
			dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 3),
			dm('2026-06-19', 'codex', 'claude-haiku-4-5', 1.5),
			dm('2026-06-18', 'codex', 'claude-opus-4-8', 4),
			dm('2026-06-18', 'opencode', 'claude-sonnet-4-5', 2)
		];
		const snap = snapFrom(grain);
		const buckets = trend(snap, defaultViewState('week'));
		// every bar exists with a per-model breakdown that sums to its total
		const withData = buckets.filter((b) => b.cost > 0);
		expect(withData.length).toBe(2);
		for (const b of buckets) {
			const segSum = [...b.byModel.values()].reduce((a, m) => a + m.cost, 0);
			expect(segSum).toBeCloseTo(b.cost, 10);
		}
		// the 3-model day stacks all three models
		const day19 = buckets.find((b) => b.key === '2026-06-19')!;
		expect(day19.byModel.size).toBe(3);
		expect(day19.cost).toBeCloseTo(11.5, 10);
	});

	it('emits one bar per calendar day in the window, zero-filling gaps', () => {
		// data only on the latest day and 6 days earlier; the 5 days between have
		// no spend but must still appear as zero-total bars (gaps stay visible).
		const grain = [
			dm('2026-06-19', 'codex', 'claude-opus-4-8', 9),
			dm('2026-06-13', 'codex', 'claude-opus-4-8', 4)
		];
		const snap = snapFrom(grain);
		const buckets = trend(snap, defaultViewState('week'));
		expect(buckets.length).toBe(7); // 06-13 .. 06-19 inclusive
		expect(buckets.map((b) => b.key)).toEqual([
			'2026-06-13',
			'2026-06-14',
			'2026-06-15',
			'2026-06-16',
			'2026-06-17',
			'2026-06-18',
			'2026-06-19'
		]);
		// the in-between days are real zero buckets
		expect(buckets[1].cost).toBe(0);
		expect(buckets[1].byModel.size).toBe(0);
		expect(buckets[0].cost).toBe(4);
		expect(buckets[6].cost).toBe(9);
	});

	it('respects the model filter in the per-bar breakdown', () => {
		const grain = [
			dm('2026-06-19', 'codex', 'claude-opus-4-8', 7),
			dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 3)
		];
		const snap = snapFrom(grain);
		const filtered: ViewState = { ...defaultViewState('week'), modelFilter: new Set(['claude-opus-4-8']) };
		const day19 = trend(snap, filtered).find((b) => b.key === '2026-06-19')!;
		expect(day19.byModel.size).toBe(1);
		expect(day19.byModel.has('claude-opus-4-8')).toBe(true);
		expect(day19.cost).toBe(7);
	});
});

describe('shared view-model — cross-element (provider filter + period together)', () => {
	const grain = [
		dm('2026-06-19', 'codex', 'claude-opus-4-8', 5),
		dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 3),
		dm('2026-06-15', 'codex', 'claude-opus-4-8', 8),
		dm('2026-06-15', 'opencode', 'claude-sonnet-4-5', 2)
	];
	const snap = snapFrom(grain);

	it('applies provider subset AND period re-aggregation combined, not either-or', () => {
		// day + codex: only 2026-06-19 codex = 5
		const dayCodex = scopedTotals(snap, withFilter(defaultViewState('day'), ['codex']));
		expect(dayCodex.cost).toBe(5);
		// week + codex: both codex days = 13
		const weekCodex = scopedTotals(snap, withFilter(defaultViewState('week'), ['codex']));
		expect(weekCodex.cost).toBe(13);
	});

	it('providers() returns the full provider set over the scoped grain', () => {
		const list = providers(snap, defaultViewState('week'));
		expect(list.map((p) => p.provider).sort()).toEqual(['codex', 'opencode']);
	});
});

describe('byDay — one cell per banked calendar day', () => {
	it('emits one cell per day in [earliest, latest] inclusive, gaps zero-filled', () => {
		// 06-15 spend, 06-16 gap (no rows), 06-18 spend. Range 06-15..06-18 = 4 days.
		const grain = [
			dm('2026-06-15', 'codex', 'claude-opus-4-8', 8),
			dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)
		];
		const snap = snapFrom(grain);
		const cells = byDay(snap);
		expect(cells.map((c) => c.day)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18']);
		// per-day cost matches sumGrain over [day, day]
		for (const c of cells) {
			expect(c.cost).toBe(sumGrain(snap.dayModel, { from: c.day, to: c.day }).cost);
		}
		// gap days are zero with hasData=false
		const gap = cells.find((c) => c.day === '2026-06-16')!;
		expect(gap.cost).toBe(0);
		expect(gap.hasData).toBe(false);
	});

	it('marks an interior gap day missing and present days from the coverage map', () => {
		const grain = [
			dm('2026-06-15', 'codex', 'claude-opus-4-8', 8),
			dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)
		];
		const snap = snapFrom(grain);
		const cells = byDay(snap);
		// 06-16/06-17 are in-range but absent from the coverage map -> missing
		expect(cells.find((c) => c.day === '2026-06-16')!.coverage).toBe('missing');
		// 06-15 is a past spend day -> frozen; 06-18 is latest -> partial (per snapFrom)
		expect(cells.find((c) => c.day === '2026-06-15')!.coverage).toBe('frozen');
		expect(cells.find((c) => c.day === '2026-06-18')!.coverage).toBe('partial');
	});

	it('returns [] for an empty snapshot (no earliestDay)', () => {
		const snap = snapFrom([]);
		expect(byDay(snap)).toEqual([]);
	});

	it('is a single pass: total of cells equals total spend', () => {
		const grain = [
			dm('2026-06-15', 'codex', 'claude-opus-4-8', 8),
			dm('2026-06-15', 'opencode', 'claude-sonnet-4-5', 2),
			dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)
		];
		const snap = snapFrom(grain);
		const total = byDay(snap).reduce((a, c) => a + c.cost, 0);
		expect(total).toBe(15);
	});
});

describe('focusedDay scoping', () => {
	const grain = [
		dm('2026-06-15', 'codex', 'claude-opus-4-8', 8),
		dm('2026-06-15', 'opencode', 'claude-sonnet-4-5', 2),
		dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)
	];
	const snap = snapFrom(grain);
	const st = defaultViewState('week');

	it('focusedTotals(X).cost === sumGrain over [X, X]', () => {
		const x = '2026-06-15';
		expect(focusedTotals(snap, x, st).cost).toBe(sumGrain(snap.dayModel, { from: x, to: x }).cost);
		expect(focusedTotals(snap, x, st).cost).toBe(10);
	});

	it('differs across days with different spend', () => {
		expect(focusedTotals(snap, '2026-06-15', st).cost).not.toBe(focusedTotals(snap, '2026-06-18', st).cost);
	});

	it('composes with a provider filter (not either-or)', () => {
		const filtered = focusedTotals(snap, '2026-06-15', withFilter(st, ['codex']));
		expect(filtered.cost).toBe(8); // codex-only on 06-15
		expect(filtered.cost).not.toBe(focusedTotals(snap, '2026-06-15', st).cost);
	});

	it('focusedModels for a day applies the provider filter', () => {
		const all = focusedModels(snap, '2026-06-15', st);
		expect(all.reduce((a, m) => a + m.cost, 0)).toBe(10);
		const codexOnly = focusedModels(snap, '2026-06-15', withFilter(st, ['codex']));
		expect(codexOnly.reduce((a, m) => a + m.cost, 0)).toBe(8);
	});
});

describe('focusedSessions — intersect the pinned day', () => {
	function sess(id: string, firstDay: string, lastDay: string, provider = 'codex', models = ['claude-opus-4-8']): SessionSummary {
		return {
			sessionId: id,
			provider,
			project: 'p',
			firstTs: new Date(firstDay + 'T08:00:00Z').getTime(),
			lastTs: new Date(lastDay + 'T20:00:00Z').getTime(),
			tokens: toks(0),
			requests: 1,
			cost: 1,
			costUnknownRequests: 0,
			models
		};
	}
	const snap = snapFrom([dm('2026-06-15', 'codex', 'claude-opus-4-8', 8), dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)]);
	const st = defaultViewState('week');

	it('keeps only sessions overlapping the day window', () => {
		const sessions = [sess('a', '2026-06-15', '2026-06-15'), sess('b', '2026-06-16', '2026-06-17'), sess('c', '2026-06-14', '2026-06-15')];
		const s2 = { ...snap, sessions };
		const hit = focusedSessions(s2, '2026-06-15', st).map((s) => s.sessionId).sort();
		expect(hit).toEqual(['a', 'c']); // b is 06-16..06-17, no overlap with 06-15
	});

	it('composes the provider filter with the day window', () => {
		const sessions = [sess('a', '2026-06-15', '2026-06-15', 'codex'), sess('b', '2026-06-15', '2026-06-15', 'opencode')];
		const s2 = { ...snap, sessions };
		const hit = focusedSessions(s2, '2026-06-15', withFilter(st, ['codex'])).map((s) => s.sessionId);
		expect(hit).toEqual(['a']);
	});
});

describe('clampDay — bounds + step', () => {
	const snap = snapFrom([dm('2026-06-15', 'codex', 'claude-opus-4-8', 8), dm('2026-06-18', 'codex', 'claude-opus-4-8', 5)]);

	it('clamps an out-of-range day into [earliest, latest]', () => {
		expect(clampDay(snap, '2026-06-10')).toBe('2026-06-15');
		expect(clampDay(snap, '2026-06-30')).toBe('2026-06-18');
		expect(clampDay(snap, '2026-06-16')).toBe('2026-06-16');
	});

	it('returns null when there is no data range', () => {
		expect(clampDay(snapFrom([]), '2026-06-16')).toBeNull();
	});

	it('stepping via addDaysISO+clamp is a no-op at the bounds', () => {
		// at earliest, stepping -1 then clamping stays at earliest
		expect(clampDay(snap, addDaysISO('2026-06-15', -1))).toBe('2026-06-15');
		// at latest, stepping +1 then clamping stays at latest
		expect(clampDay(snap, addDaysISO('2026-06-18', 1))).toBe('2026-06-18');
	});
});

// ---------------------------------------------------------------------------
// chaching-session-browser: scopedSessions date-windowing (the bug fix) + the
// explorer's pure selectors (allSessions / isLive / inWindow).
// ---------------------------------------------------------------------------

/** A session spanning [firstDay 08:00, lastDay 20:00] UTC unless `firstTs`/`lastTs` overridden. */
function sess(
	id: string,
	firstDay: string,
	lastDay: string,
	opts: { provider?: string; models?: string[]; firstTs?: number; lastTs?: number } = {}
): SessionSummary {
	return {
		sessionId: id,
		provider: opts.provider ?? 'codex',
		project: 'p',
		firstTs: opts.firstTs ?? new Date(firstDay + 'T08:00:00Z').getTime(),
		lastTs: opts.lastTs ?? new Date(lastDay + 'T20:00:00Z').getTime(),
		tokens: toks(0),
		requests: 1,
		cost: 1,
		costUnknownRequests: 0,
		models: opts.models ?? ['claude-opus-4-8']
	};
}

describe('inWindow / dayOf — day-string overlap rule (design D3)', () => {
	it('dayOf returns the UTC YYYY-MM-DD of a timestamp', () => {
		// 23:50 UTC stays on its own day; 00:10 the next day is the next day (no TZ drift)
		expect(dayOf(new Date('2026-06-18T23:50:00Z').getTime())).toBe('2026-06-18');
		expect(dayOf(new Date('2026-06-19T00:10:00Z').getTime())).toBe('2026-06-19');
	});

	it('wholly-inside is included; wholly-before / wholly-after are excluded (boundary)', () => {
		const inside = sess('in', '2026-06-15', '2026-06-15');
		expect(inWindow(inside, '2026-06-13', '2026-06-19')).toBe(true);
		// exactly one day before `from`
		const before = sess('b', '2026-06-12', '2026-06-12');
		expect(inWindow(before, '2026-06-13', '2026-06-19')).toBe(false);
		// exactly one day after `to`
		const after = sess('a', '2026-06-20', '2026-06-20');
		expect(inWindow(after, '2026-06-13', '2026-06-19')).toBe(false);
		// touching the exact edges is included (inclusive window)
		expect(inWindow(sess('lo', '2026-06-13', '2026-06-13'), '2026-06-13', '2026-06-19')).toBe(true);
		expect(inWindow(sess('hi', '2026-06-19', '2026-06-19'), '2026-06-13', '2026-06-19')).toBe(true);
	});

	it('a midnight-straddling session overlaps BOTH adjacent windows', () => {
		// started 23:50 on 06-18, ran to 00:30 on 06-19 — touches both days.
		const straddle = sess('s', '', '', {
			firstTs: new Date('2026-06-18T23:50:00Z').getTime(),
			lastTs: new Date('2026-06-19T00:30:00Z').getTime()
		});
		// a window ending 06-18 includes it (lastTs day 06-19 >= from 06-12, firstTs day 06-18 <= to 06-18)
		expect(inWindow(straddle, '2026-06-12', '2026-06-18')).toBe(true);
		// a window starting 06-19 also includes it (firstTs day 06-18 <= to 06-25, lastTs day 06-19 >= from 06-19)
		expect(inWindow(straddle, '2026-06-19', '2026-06-25')).toBe(true);
	});
});

describe('scopedSessions — date-windowing regression (the bug)', () => {
	// 40 sessions, one per day, $1 each, descending from 2026-06-19. The latest day
	// anchors every rolling window so day/week/month all end on 06-19 but start earlier.
	const grain: DayModelAgg[] = [];
	const sessions: SessionSummary[] = [];
	for (let i = 0; i < 40; i++) {
		const d = new Date(Date.UTC(2026, 5, 19));
		d.setUTCDate(d.getUTCDate() - i);
		const day = d.toISOString().slice(0, 10);
		grain.push(dm(day, 'codex', 'claude-opus-4-8', 1));
		sessions.push(sess(`s-${day}`, day, day));
	}
	const snap = { ...snapFrom(grain), sessions };

	it('REGRESSION: scopedSessions for Day vs Week vs Month over the SAME snapshot DIFFER', () => {
		// Pre-fix scopedSessions returned the unwindowed list, so all three were identical
		// (length 40). This is the assertion that fails against the old code and locks the fix.
		const day = scopedSessions(snap, defaultViewState('day'));
		const week = scopedSessions(snap, defaultViewState('week'));
		const month = scopedSessions(snap, defaultViewState('month'));
		expect(day.length).toBe(1); // 06-19 only
		expect(week.length).toBe(7); // 06-13 .. 06-19
		expect(month.length).toBe(30); // 06-... last 30 days
		expect(day.length).not.toBe(week.length);
		expect(week.length).not.toBe(month.length);
	});

	it('windowed set matches the period window boundaries', () => {
		const w = periodWindow(snap, defaultViewState('week'));
		const ids = scopedSessions(snap, defaultViewState('week')).map((s) => dayOf(s.firstTs));
		for (const day of ids) {
			expect(day >= w.from && day <= w.to).toBe(true);
		}
	});
});

describe('scopedSessions — overlap, focusedDay, and filter composition', () => {
	const snap = snapFrom([
		dm('2026-06-13', 'codex', 'claude-opus-4-8', 1),
		dm('2026-06-19', 'codex', 'claude-opus-4-8', 1)
	]);

	it('a midnight-straddle session appears in both adjacent period windows', () => {
		// straddles 06-18 23:50 → 06-19 00:30. Week window = 06-13..06-19 (includes it);
		// a day window on 06-18 (built via a snapshot whose latest is 06-18) also includes it.
		const straddle = sess('s', '', '', {
			firstTs: new Date('2026-06-18T23:50:00Z').getTime(),
			lastTs: new Date('2026-06-19T00:30:00Z').getTime()
		});
		const weekSnap = { ...snap, sessions: [straddle] };
		expect(scopedSessions(weekSnap, defaultViewState('week')).map((s) => s.sessionId)).toEqual(['s']);
		// a snapshot whose latest day is 06-18 → day window [06-18,06-18] still catches the straddle
		const snap18 = { ...snapFrom([dm('2026-06-18', 'codex', 'claude-opus-4-8', 1)]), sessions: [straddle] };
		expect(scopedSessions(snap18, defaultViewState('day')).map((s) => s.sessionId)).toEqual(['s']);
	});

	it('focusedDay narrows the window to that single day', () => {
		const sessions = [sess('a', '2026-06-13', '2026-06-13'), sess('b', '2026-06-19', '2026-06-19')];
		const s2 = { ...snap, sessions };
		// week view alone would include both
		expect(scopedSessions(s2, defaultViewState('week')).length).toBe(2);
		// pinned to 06-13 → only the 06-13 session
		const pinned: ViewState = { ...defaultViewState('week'), focusedDay: '2026-06-13' };
		expect(scopedSessions(s2, pinned).map((s) => s.sessionId)).toEqual(['a']);
	});

	it('model + provider filters AND-compose with the window', () => {
		const sessions = [
			sess('keep', '2026-06-19', '2026-06-19', { provider: 'codex', models: ['claude-opus-4-8'] }),
			sess('wrongProvider', '2026-06-19', '2026-06-19', { provider: 'opencode', models: ['claude-opus-4-8'] }),
			sess('wrongModel', '2026-06-19', '2026-06-19', { provider: 'codex', models: ['claude-sonnet-4-5'] }),
			sess('outOfWindow', '2026-06-01', '2026-06-01', { provider: 'codex', models: ['claude-opus-4-8'] })
		];
		const s2 = { ...snap, sessions };
		const state: ViewState = {
			...defaultViewState('week'),
			modelFilter: new Set(['claude-opus-4-8']),
			providerFilter: new Set(['codex'])
		};
		expect(scopedSessions(s2, state).map((s) => s.sessionId)).toEqual(['keep']);
	});
});

describe('allSessions / isLive — explorer selectors', () => {
	const sessions = [
		sess('a', '2026-06-13', '2026-06-13', { provider: 'codex', models: ['claude-opus-4-8'] }),
		sess('b', '2026-06-19', '2026-06-19', { provider: 'opencode', models: ['claude-sonnet-4-5'] }),
		sess('c', '2026-06-01', '2026-06-01', { provider: 'codex', models: ['claude-haiku-4-5'] })
	];
	const snap = { ...snapFrom([dm('2026-06-19', 'codex', 'claude-opus-4-8', 1)]), sessions };

	it('allSessions returns the full frozen ∪ live union (no date window) by default', () => {
		expect(allSessions(snap, defaultViewState('month')).length).toBe(3);
		// even a Day view returns ALL sessions (the explorer is cross-day by design)
		expect(allSessions(snap, defaultViewState('day')).length).toBe(3);
	});

	it('allSessions applies model + provider filters but not the window', () => {
		const codex = allSessions(snap, { ...defaultViewState('day'), providerFilter: new Set(['codex']) });
		expect(codex.map((s) => s.sessionId).sort()).toEqual(['a', 'c']);
		const opus = allSessions(snap, { ...defaultViewState('day'), modelFilter: new Set(['claude-opus-4-8']) });
		expect(opus.map((s) => s.sessionId)).toEqual(['a']);
	});

	it('isLive is true for a today-lastTs session, false for a past day (boundary)', () => {
		const now = new Date('2026-06-19T12:00:00Z').getTime();
		expect(todayUTC(now)).toBe('2026-06-19');
		// last activity at 20:00 on 06-19 (same UTC day as `now`) → live
		expect(isLive(sess('live', '2026-06-19', '2026-06-19'), now)).toBe(true);
		// last activity 06-18 → frozen, even one day before
		expect(isLive(sess('frozen', '2026-06-18', '2026-06-18'), now)).toBe(false);
		// a session that ran into 06-19 00:01 is live relative to a 06-19 now
		const justInto = sess('x', '', '', {
			firstTs: new Date('2026-06-18T23:50:00Z').getTime(),
			lastTs: new Date('2026-06-19T00:01:00Z').getTime()
		});
		expect(isLive(justInto, now)).toBe(true);
	});
});
