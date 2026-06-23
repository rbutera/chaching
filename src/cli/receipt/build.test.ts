import { describe, it, expect } from 'vitest';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '../../lib/types.js';
import { filterDays, sumGrain } from '../../lib/core/aggregate.js';
import { buildReceipt, rollingPeriodRange } from './build.js';
import { periodWindow } from '../../lib/core/view-model.js';
import { resolvePrice } from '../../lib/core/pricing/cost.js';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

function dm(
	day: string,
	provider: string,
	model: string,
	cost: number,
	tokens: TokenCounts,
	requests = 1,
	costUnknownRequests = 0
): DayModelAgg {
	return { day, provider, model, tokens, requests, cost, costUnknownRequests };
}

function snapFrom(grain: DayModelAgg[]): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const totals = sumGrain(grain);
	return {
		generatedAt: 0,
		earliestDay: days[0] ?? null,
		latestDay: days[days.length - 1] ?? null,
		totals: {
			tokens: totals.tokens,
			requests: totals.requests,
			cost: totals.cost,
			costUnknownRequests: totals.costUnknownRequests
		},
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: {}
	};
}

// A fixed, deterministic grain with cache reads on a priced model + an unknown one.
const grain: DayModelAgg[] = [
	// opus: 1M input, 0.5M output, 2M cache read
	dm('2026-06-19', 'claude', 'claude-opus-4-8', 12.5, toks(1_000_000, 500_000, 0, 2_000_000), 100),
	// sonnet: 0.5M input, no cache reads
	dm('2026-06-19', 'codex', 'claude-sonnet-4-6', 1.5, toks(500_000, 0, 0, 0), 20),
	// unknown-price model
	dm('2026-06-19', 'opencode', 'some-unknown-model-x', 0, toks(10_000, 0, 0, 5_000), 3, 3)
];
const FIXED_NOW = Date.parse('2026-06-19T12:00:00Z');

describe('buildReceipt — sections + invariants', () => {
	const snap = snapFrom(grain);

	it('renders header, line items, coupons, subtotals, and total', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		expect(m.empty).toBe(false);
		expect(m.lineItems.length).toBe(3);
		expect(m.subtotals.length).toBeGreaterThan(0);
		expect(m.from).toBe('2026-06-19');
		expect(m.to).toBe('2026-06-19');
		expect(m.wordmark).toContain('chaching');
	});

	it('TOTAL BURN equals sumGrain(grain).cost exactly (no double-count)', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		expect(m.totalBurn).toBeCloseTo(sumGrain(grain).cost, 10);
	});

	it('coupon YOU SAVED == Σ per-model cacheRead × (input − read) rate; total unchanged', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		const opus = resolvePrice('claude-opus-4-8')!;
		const expectedOpusSaved = 2_000_000 * (opus.input_cost_per_token - opus.cache_read_input_token_cost);
		// only opus has cache reads AND a known price
		expect(m.youSaved).toBeCloseTo(expectedOpusSaved, 8);
		expect(m.coupons.length).toBe(1);
		expect(m.coupons[0].model).toBe('claude-opus-4-8');
		// total is NOT reduced by the coupon
		expect(m.totalBurn).toBeCloseTo(sumGrain(grain).cost, 10);
	});

	it('unknown-price model contributes no coupon and is noted', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		expect(m.unknownPriceModels).toContain('some-unknown-model-x');
		const couponModels = m.coupons.map((c) => c.model);
		expect(couponModels).not.toContain('some-unknown-model-x');
		const item = m.lineItems.find((i) => i.model === 'some-unknown-model-x');
		expect(item?.unknownPrice).toBe(true);
	});

	it('no-cache-reads case: youSaved is 0 / coupon omitted when nothing qualifies', () => {
		const noCacheGrain = [dm('2026-06-19', 'codex', 'claude-sonnet-4-6', 1.5, toks(500_000, 0, 0, 0), 20)];
		const m = buildReceipt(snapFrom(noCacheGrain), { now: FIXED_NOW });
		expect(m.youSaved).toBe(0);
		expect(m.coupons.length).toBe(0);
		expect(m.totalBurn).toBeCloseTo(1.5, 10);
	});

	it('empty snapshot → empty-state receipt', () => {
		const m = buildReceipt(snapFrom([]), { now: FIXED_NOW });
		expect(m.empty).toBe(true);
		expect(m.lineItems.length).toBe(0);
		expect(m.totalBurn).toBe(0);
	});

	it('faux barcode is deterministic for the same snapshot + scope', () => {
		const a = buildReceipt(snap, { now: FIXED_NOW });
		const b = buildReceipt(snap, { now: FIXED_NOW });
		expect(a.barcode).toBe(b.barcode);
		expect(a.ref).toBe(b.ref);
		expect(a.barcode.length).toBeGreaterThan(0);
	});

	it('provider filter scopes line items and total', () => {
		const all = buildReceipt(snap, { now: FIXED_NOW });
		const codexOnly = buildReceipt(snap, { now: FIXED_NOW, providers: ['codex'] });
		expect(codexOnly.lineItems.every((i) => i.provider === 'codex')).toBe(true);
		expect(codexOnly.totalBurn).toBeLessThan(all.totalBurn);
		expect(codexOnly.totalBurn).toBeCloseTo(1.5, 10);
	});
});

describe('buildReceipt — billed cache cost + subsidisation footer', () => {
	const snap = snapFrom(grain);
	const subscription = {
		claude: { enabled: true, tier: 'corporate', monthlyUsd: 99 },
		codex: { enabled: true, tier: 'plus', monthlyUsd: 20 }
	};

	it('always exposes the billed cache-cost breakdown (reads + writes), from resolvePrice', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		const opus = resolvePrice('claude-opus-4-8')!;
		// only opus carries cache reads (2M) in the fixture; unknown model excluded from cost
		expect(m.cacheCost.cacheReadTokens).toBe(2_005_000); // opus 2M + unknown 5k tokens counted
		expect(m.cacheCost.cacheReadCost).toBeCloseTo(2_000_000 * opus.cache_read_input_token_cost, 8);
		expect(m.cacheCost.savedVsUncached).toBeCloseTo(
			2_000_000 * (opus.input_cost_per_token - opus.cache_read_input_token_cost),
			8
		);
		// TOTAL BURN is untouched by the breakdown
		expect(m.totalBurn).toBeCloseTo(sumGrain(grain).cost, 10);
	});

	it('no subscription → no subsidisation footer', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		expect(m.subsidisation).toBeNull();
	});

	it('--period month shows the month-basis subsidisation with a multiple', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, period: 'month', subscription });
		expect(m.subsidisation).not.toBeNull();
		expect(m.subsidisation!.monthBasis).toBe(true);
		expect(m.subsidisation!.monthlyUsd).toBe(119); // 99 + 20, both enabled
		expect(m.subsidisation!.multiple).not.toBeNull();
		// month-to-date burn = claude+codex June burn; multiple = burn / 119
		expect(m.subsidisation!.multiple!).toBeCloseTo(
			m.subsidisation!.apiEquivalentUsd / 119,
			6
		);
	});

	it('default (all-time) receipt uses the current-month headline (monthBasis)', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, subscription });
		expect(m.subsidisation!.monthBasis).toBe(true);
	});

	it('--period week omits the monthly multiple (period mismatch)', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, period: 'week', subscription });
		expect(m.subsidisation).not.toBeNull();
		expect(m.subsidisation!.monthBasis).toBe(false);
		expect(m.subsidisation!.multiple).toBeNull();
		expect(m.subsidisation!.periodLabel).toBe('this week');
	});

	it('TOTAL BURN is unchanged whether or not a subscription is supplied', () => {
		const without = buildReceipt(snap, { now: FIXED_NOW });
		const withSub = buildReceipt(snap, { now: FIXED_NOW, period: 'month', subscription });
		expect(withSub.totalBurn).toBeCloseTo(without.totalBurn, 12);
	});
});

describe('buildReceipt — ROLLING window matches the dashboard (anchored at latestDay)', () => {
	// A grain that spans 40 days so calendar-month-to-date and rolling-30d DISAGREE,
	// AND the latest day is NOT "today" — this is exactly the drift case: a calendar
	// window anchored at `now` would scope a different set of days than the rolling
	// window anchored at the latest day with data. latestDay = 2026-06-23.
	const spanGrain: DayModelAgg[] = [
		dm('2026-05-15', 'claude', 'claude-opus-4-8', 100, toks(1_000_000, 0, 0, 0), 10), // before rolling-30d, inside calendar-month? no (May)
		dm('2026-05-25', 'claude', 'claude-opus-4-8', 50, toks(500_000, 0, 0, 0), 5), // inside rolling-30d (>= May 25), before calendar Jun-1
		dm('2026-06-02', 'claude', 'claude-opus-4-8', 30, toks(300_000, 0, 0, 0), 3),
		dm('2026-06-23', 'codex', 'claude-sonnet-4-6', 20, toks(200_000, 0, 0, 0), 2)
	];
	const spanSnap = snapFrom(spanGrain); // latestDay 2026-06-23, earliestDay 2026-05-15
	// `now` deliberately AFTER latestDay (no data "today") — the drift trigger.
	const NOW_AFTER = Date.parse('2026-06-28T09:00:00Z');

	function stateFor(period: Parameters<typeof periodWindow>[1]['period']) {
		return { period, modelFilter: new Set<string>(), providerFilter: new Set<string>(), focusedDay: null };
	}

	it('rollingPeriodRange(month) is the rolling 30d window (latestDay-29 .. latestDay), NOT calendar Jun-1', () => {
		const r = rollingPeriodRange(spanSnap, 'month');
		expect(r.to).toBe('2026-06-23'); // anchored at latestDay, not `now`/today
		expect(r.from).toBe('2026-05-25'); // 30-day inclusive window: 06-23 minus 29 days
		// it is emphatically NOT the calendar month-to-date start
		expect(r.from).not.toBe('2026-06-01');
	});

	it('rollingPeriodRange(week) is the rolling 7d window anchored at latestDay (NOT Monday-to-date)', () => {
		const r = rollingPeriodRange(spanSnap, 'week');
		expect(r.to).toBe('2026-06-23');
		expect(r.from).toBe('2026-06-17'); // 7-day inclusive: 06-23 minus 6 days
	});

	it('receipt --period month TOTAL == periodWindow-scoped sumGrain for month (matches the dashboard hero)', () => {
		const m = buildReceipt(spanSnap, { now: NOW_AFTER, period: 'month' });
		const w = periodWindow(spanSnap, stateFor('month'));
		const dashboardMonth = sumGrain(filterDays(spanSnap.dayModel, w.from, w.to)).cost;
		expect(m.totalBurn).toBeCloseTo(dashboardMonth, 10);
		// concretely: May-25 (50) + Jun-02 (30) + Jun-23 (20) = 100; the May-15 row
		// (100) falls OUTSIDE the rolling 30d window, so it is excluded.
		expect(m.totalBurn).toBeCloseTo(100, 10);
	});

	it('every period: receipt TOTAL == the dashboard periodWindow total', () => {
		for (const period of ['day', 'week', 'month', 'quarter', 'all'] as const) {
			const m = buildReceipt(spanSnap, { now: NOW_AFTER, period });
			const w = periodWindow(spanSnap, stateFor(period));
			const dash = sumGrain(filterDays(spanSnap.dayModel, w.from, w.to)).cost;
			expect(m.totalBurn).toBeCloseTo(dash, 10);
		}
	});

	it('an explicit range (web focused-day pin) STILL wins over the rolling window', () => {
		const m = buildReceipt(spanSnap, {
			now: NOW_AFTER,
			period: 'month',
			range: { from: '2026-06-02', to: '2026-06-02' }
		});
		expect(m.totalBurn).toBeCloseTo(30, 10); // just the Jun-02 row
		expect(m.from).toBe('2026-06-02');
		expect(m.to).toBe('2026-06-02');
	});

	it('empty snapshot → null from/to (NOT the 1970 periodWindow sentinel)', () => {
		const m = buildReceipt(snapFrom([]), { now: NOW_AFTER, period: 'month' });
		expect(m.empty).toBe(true);
		// regression: rollingPeriodRange must surface no-data as undefined so the
		// empty receipt shows no range line, not a bogus 1970-01-01 header.
		expect(m.from).toBeNull();
		expect(m.to).toBeNull();
	});

	it('rollingPeriodRange returns undefined bounds for an empty snapshot', () => {
		const r = rollingPeriodRange(snapFrom([]), 'month');
		expect(r.from).toBeUndefined();
		expect(r.to).toBeUndefined();
	});
});
