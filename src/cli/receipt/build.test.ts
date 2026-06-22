import { describe, it, expect } from 'vitest';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '../../lib/types.js';
import { sumGrain } from '../../lib/core/aggregate.js';
import { buildReceipt } from './build.js';
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
		cutoverTs: null
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
