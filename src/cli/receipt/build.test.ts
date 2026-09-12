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
		expect(m.from).toBe('2026-05-21');
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
	it('uses the selected dates and provider for both usage and fee, including unknown fees', () => {
		const options = {
			period: 'month' as const,
			range: { from: '2026-06-13', to: '2026-06-19' },
			providers: ['claude'],
			subscription: { claude: { enabled: true, tier: 'custom', monthlyUsd: 300 }, codex: { enabled: true, tier: 'unknown', monthlyUsd: null } }
		};
		const receipt = buildReceipt(snap, options);
		expect(receipt.totalBurn).toBe(12.5);
		expect(receipt.subsidisation).toMatchObject({ from: options.range.from, to: options.range.to, feeUsd: 70, apiEquivalentUsd: receipt.totalBurn });
		const combined = buildReceipt(snap, { ...options, providers: [] });
		expect(combined.subsidisation).toMatchObject({ feeUsd: null, multiple: null, netSubsidyUsd: null, apiEquivalentUsd: combined.totalBurn });
	});

	const snap = snapFrom(grain);
	const subscription = {
		claude: { enabled: true, tier: 'corporate', monthlyUsd: 99 },
		codex: { enabled: true, tier: 'plus', monthlyUsd: 20 }
	};

	it('keeps legacy cache costs unavailable while preserving total burn', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		// Legacy fixture has no retained monetary components.
		expect(m.cacheCost.cacheReadTokens).toBe(2_005_000); // opus 2M + unknown 5k tokens counted
		expect(m.cacheCost.cacheReadCost).toBeNull();
		expect(m.cacheCost.savedVsUncached).toBeNull();
		// TOTAL BURN is untouched by the breakdown
		expect(m.totalBurn).toBeCloseTo(sumGrain(grain).cost, 10);
	});

	it('no subscription → no subsidisation footer', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW });
		expect(m.subsidisation).toBeNull();
	});

	it('--period month prorates a 30-day fee with a multiple', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, period: 'month', subscription });
		expect(m.subsidisation).not.toBeNull();
		expect(m.subsidisation!.feeUsd).toBe(119); // 99 + 20, both enabled
		expect(m.subsidisation!.multiple).not.toBeNull();
		// month-to-date burn = claude+codex June burn; multiple = burn / 119
		expect(m.subsidisation!.multiple!).toBeCloseTo(
			m.subsidisation!.apiEquivalentUsd / 119,
			6
		);
	});

	it('default receipt uses its rolling window for usage and fees', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, subscription });
		expect(m.subsidisation?.apiEquivalentUsd).toBeCloseTo(m.totalBurn);
	});

	it('--period week compares seven days of usage against seven days of fees', () => {
		const m = buildReceipt(snap, { now: FIXED_NOW, period: 'week', subscription });
		expect(m.subsidisation).not.toBeNull();
		expect(m.subsidisation!.feeUsd).toBeCloseTo(119 * 7 / 30);
		expect(m.subsidisation!.multiple).toBeCloseTo(m.subsidisation!.apiEquivalentUsd / (119 * 7 / 30));
		expect(m.subsidisation!.periodLabel).toBe('last 7 days');
	});

	it('TOTAL BURN is unchanged whether or not a subscription is supplied', () => {
		const without = buildReceipt(snap, { now: FIXED_NOW });
		const withSub = buildReceipt(snap, { now: FIXED_NOW, period: 'month', subscription });
		expect(withSub.totalBurn).toBeCloseTo(without.totalBurn, 12);
	});
});

describe('receipt windows use the dashboard current UTC date', () => {
	const spanSnap = snapFrom([
		dm('2026-05-15', 'claude', 'claude-opus-4-8', 100, toks(1000)),
		dm('2026-05-25', 'claude', 'claude-opus-4-8', 50, toks(500)),
		dm('2026-06-02', 'claude', 'claude-opus-4-8', 30, toks(300)),
		dm('2026-06-23', 'codex', 'claude-sonnet-4-6', 20, toks(200))
	]);
	const NOW_AFTER = Date.parse('2026-06-28T09:00:00Z');

	it('keeps quiet days in rolling windows instead of shifting to the latest activity', () => {
		expect(rollingPeriodRange(spanSnap, 'month', NOW_AFTER)).toEqual({ from: '2026-05-30', to: '2026-06-28' });
		expect(rollingPeriodRange(spanSnap, 'week', NOW_AFTER)).toEqual({ from: '2026-06-22', to: '2026-06-28' });
		const today = buildReceipt(spanSnap, { now: NOW_AFTER, period: 'day' });
		expect(today).toMatchObject({ empty: true, totalBurn: 0, from: '2026-06-28', to: '2026-06-28' });
	});

	it('matches dashboard usage and bounds for every period', () => {
		for (const period of ['day', 'week', 'month', 'quarter', 'all'] as const) {
			const receipt = buildReceipt(spanSnap, { now: NOW_AFTER, period });
			const range = periodWindow(spanSnap, {
				period, modelFilter: new Set(), providerFilter: new Set(), focusedDay: null, windowEnd: '2026-06-28'
			});
			expect(receipt.totalBurn).toBe(sumGrain(filterDays(spanSnap.dayModel, range.from, range.to)).cost);
			expect(receipt.from).toBe(range.from);
			expect(receipt.to).toBe(range.to);
		}
	});

	it('an explicit range (web focused-day pin) STILL wins over the rolling window', () => {
		const m = buildReceipt(spanSnap, {
			now: NOW_AFTER,
			period: 'month',
			range: { from: '2026-06-02', to: '2026-06-02' }
		});
		expect(m.totalBurn).toBeCloseTo(30, 10); // just the Jun-02 row
		expect(m.periodLabel).toBe('1 day');
		expect(m.from).toBe('2026-06-02');
		expect(m.to).toBe('2026-06-02');
	});

	it('retains the requested dates and fees when there is no usage at all', () => {
		const receipt = buildReceipt(snapFrom([]), { now: NOW_AFTER, period: 'month', subscription: {
			claude: { enabled: true, tier: 'max', monthlyUsd: 100 }, codex: { enabled: false, tier: 'unknown', monthlyUsd: null }
		} });
		expect(receipt).toMatchObject({ empty: true, from: '2026-05-30', to: '2026-06-28', subsidisation: { feeUsd: 100, apiEquivalentUsd: 0 } });
	});
});


it('filters model usage and coupons while retaining the whole selected Account fee', () => {
	const snapshot = snapFrom([
		dm('2026-06-19', 'claude', 'claude-opus-4-8', 120, toks(1_000_000, 0, 0, 1_000_000)),
		dm('2026-06-19', 'claude', 'claude-sonnet-4-6', 80, toks(500_000, 0, 0, 500_000))
	]);
	const options = {
		now: FIXED_NOW,
		range: { from: '2026-06-01', to: '2026-06-30' },
		subscription: {
			claude: { enabled: true, tier: 'max', monthlyUsd: 100 },
			codex: { enabled: false, tier: 'unknown', monthlyUsd: null }
		}
	};
	const receipt = buildReceipt(snapshot, { ...options, models: ['claude-opus-4-8'] });
	expect(receipt.totalBurn).toBe(120);
	expect(receipt.lineItems.map((item) => item.model)).toEqual(['claude-opus-4-8']);
	expect(receipt.coupons.map((coupon) => coupon.model)).toEqual(['claude-opus-4-8']);
	expect(receipt.subsidisation).toMatchObject({ feeUsd: 100, apiEquivalentUsd: 120, multiple: 1.2 });
	const empty = buildReceipt(snapshot, { ...options, models: ['absent'] });
	expect(empty.empty).toBe(true);
	expect(empty.subsidisation).toMatchObject({ feeUsd: 100, apiEquivalentUsd: 0 });
});


it('scopes pooled receipt usage by both machine and Account while retaining a shared fee', () => {
	const snapshot = snapFrom([
		{ ...dm('2026-06-19', 'claude', 'claude-opus-4-8', 10, toks(100)), machineId: 'one', accountId: 'a' },
		{ ...dm('2026-06-19', 'claude', 'claude-opus-4-8', 20, toks(200)), machineId: 'two', accountId: 'a' },
		{ ...dm('2026-06-19', 'claude', 'claude-opus-4-8', 30, toks(300)), machineId: 'one', accountId: 'b' }
	]);
	const receipt = buildReceipt(snapshot, {
		now: FIXED_NOW, range: { from: '2026-06-01', to: '2026-06-30' }, machines: ['one'], accountIds: ['a'],
		subscription: { claude: { enabled: true, tier: 'max', monthlyUsd: 100 }, codex: { enabled: false, tier: 'unknown', monthlyUsd: null } }
	});
	expect(receipt).toMatchObject({ totalBurn: 10, machines: ['one'], accountIds: ['a'], subsidisation: { apiEquivalentUsd: 10, feeUsd: 100, wholeAccountFee: true } });
});


it('retains known-set unsplit spend in a combined Account receipt without inventing individual spend', () => {
	const snapshot = snapFrom([{ ...dm('2026-06-19', 'claude', 'claude-opus-4-8', 100, toks(100)), accountId: null, accountCandidates: ['a', 'b'] }]);
	const options = { now: FIXED_NOW, range: { from: '2026-06-19', to: '2026-06-19' } };
	expect(buildReceipt(snapshot, { ...options, accountIds: ['a', 'b'] }).totalBurn).toBe(100);
	expect(buildReceipt(snapshot, { ...options, accountIds: ['a'] }).totalBurn).toBe(0);
});
