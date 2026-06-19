import { describe, expect, it } from 'vitest';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '../types';
import {
	defaultViewState,
	heroTotals,
	models,
	periodWindow,
	providers,
	scopedTotals,
	trend,
	type ViewState
} from './view-model';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

function dm(day: string, provider: string, model: string, cost: number, requests = 1): DayModelAgg {
	return { day, provider, model, tokens: toks(cost * 1000), requests, cost, costUnknownRequests: 0 };
}

/** Build a snapshot from a flat grain; latest/earliest derived from days present. */
function snapFrom(grain: DayModelAgg[]): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const totalCost = grain.reduce((a, g) => a + g.cost, 0);
	const totalReq = grain.reduce((a, g) => a + g.requests, 0);
	return {
		generatedAt: 0,
		earliestDay: days[0] ?? null,
		latestDay: days[days.length - 1] ?? null,
		totals: { tokens: toks(0), requests: totalReq, cost: totalCost, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null
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

	it('trend bucket count differs across periods', () => {
		const dayBuckets = trend(snap, defaultViewState('day')).length;
		const weekBuckets = trend(snap, defaultViewState('week')).length;
		const monthBuckets = trend(snap, defaultViewState('month')).length;
		// day grain has one bucket per day (40); week/month coarsen into fewer.
		expect(dayBuckets).toBe(40);
		expect(weekBuckets).toBeLessThan(dayBuckets);
		expect(monthBuckets).toBeLessThan(weekBuckets);
	});

	it('sum across trend buckets is period-invariant for the full window', () => {
		const sum = (s: ViewState) => trend(snap, s).reduce((a, b) => a + b.cost, 0);
		const total = grain.reduce((a, g) => a + g.cost, 0);
		expect(sum(defaultViewState('day'))).toBeCloseTo(total, 10);
		expect(sum(defaultViewState('week'))).toBeCloseTo(total, 10);
		expect(sum(defaultViewState('month'))).toBeCloseTo(total, 10);
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
