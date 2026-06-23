import { describe, expect, it } from 'vitest';
import { cacheCostBreakdown } from './cache-breakdown';
import { resolvePrice } from './cost';
import type { DayModelAgg } from '../../types';

function agg(
	provider: string,
	model: string,
	t: { input?: number; output?: number; cacheCreation?: number; cacheRead?: number }
): DayModelAgg {
	const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, ...t };
	return { day: '2026-06-10', provider, model, tokens, requests: 1, cost: 0, costUnknownRequests: 0 };
}

describe('cacheCostBreakdown', () => {
	it('bills cache reads and writes from resolvePrice exactly (the drift-fix assertion)', () => {
		const grain: DayModelAgg[] = [
			agg('claude', 'claude-opus-4-8', { input: 1000, cacheCreation: 500, cacheRead: 2000 })
		];
		const { combined } = cacheCostBreakdown(grain);
		const price = resolvePrice('claude-opus-4-8')!;

		// Rates equal resolvePrice — no hardcoded constants survive.
		expect(combined.cacheReadCost).toBeCloseTo(2000 * price.cache_read_input_token_cost, 12);
		expect(combined.cacheWriteCost).toBeCloseTo(500 * price.cache_creation_input_token_cost, 12);
		expect(combined.cacheReadTokens).toBe(2000);
		expect(combined.cacheWriteTokens).toBe(500);
		// Saved vs uncached = reads × (input rate − read rate), always ≥ 0.
		expect(combined.savedVsUncached).toBeCloseTo(
			2000 * (price.input_cost_per_token - price.cache_read_input_token_cost),
			12
		);
		expect(combined.savedVsUncached).toBeGreaterThan(0);
	});

	it('splits per provider and rolls up to combined', () => {
		const grain: DayModelAgg[] = [
			agg('claude', 'claude-opus-4-8', { cacheRead: 1000, cacheCreation: 100 }),
			agg('codex', 'claude-haiku-4-5', { cacheRead: 3000, cacheCreation: 200 })
		];
		const { combined, byProvider } = cacheCostBreakdown(grain);
		expect(byProvider.get('claude')!.cacheReadTokens).toBe(1000);
		expect(byProvider.get('codex')!.cacheReadTokens).toBe(3000);
		expect(combined.cacheReadTokens).toBe(4000);
		expect(combined.cacheReadCost).toBeCloseTo(
			byProvider.get('claude')!.cacheReadCost + byProvider.get('codex')!.cacheReadCost,
			12
		);
	});

	it('no cache reads → $0 billed, no divide errors', () => {
		const grain: DayModelAgg[] = [agg('claude', 'claude-opus-4-8', { input: 500 })];
		const { combined } = cacheCostBreakdown(grain);
		expect(combined.cacheReadTokens).toBe(0);
		expect(combined.cacheReadCost).toBe(0);
		expect(combined.savedVsUncached).toBe(0);
		expect(Number.isFinite(combined.cacheReadCost)).toBe(true);
	});

	it('unknown-price model contributes tokens but no cost', () => {
		const grain: DayModelAgg[] = [
			agg('opencode', 'totally-unknown-model-xyz', { cacheRead: 1000, cacheCreation: 500 })
		];
		const { combined } = cacheCostBreakdown(grain);
		expect(combined.cacheReadTokens).toBe(1000);
		expect(combined.cacheReadCost).toBe(0);
		expect(combined.unknownTokens).toBe(1500);
	});

	it('billed cache cost never exceeds total burn for the same grain', () => {
		// Construct burn = computeCost-equivalent sum (here just the cost field on the agg).
		const grain: DayModelAgg[] = [
			agg('claude', 'claude-opus-4-8', { input: 10000, cacheCreation: 2000, cacheRead: 50000 })
		];
		const price = resolvePrice('claude-opus-4-8')!;
		grain[0].cost =
			10000 * price.input_cost_per_token +
			2000 * price.cache_creation_input_token_cost +
			50000 * price.cache_read_input_token_cost;
		const totalBurn = grain.reduce((s, dm) => s + dm.cost, 0);
		const { combined } = cacheCostBreakdown(grain);
		expect(combined.cacheReadCost + combined.cacheWriteCost).toBeLessThanOrEqual(totalBurn + 1e-9);
	});
});
