import { describe, expect, it } from 'vitest';
import { cacheCostBreakdown } from '@chaching/shared/pricing/cache-breakdown';
import { resolvePrice } from '@chaching/core/pricing/cost';
import type { DayModelAgg } from '@chaching/shared/types';

function agg(
	provider: string,
	model: string,
	t: { input?: number; output?: number; cacheCreation?: number; cacheRead?: number }
): DayModelAgg {
	const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, ...t };
	const p = resolvePrice(model);
	const monetary = p ? {input: tokens.input*p.input_cost_per_token, output:tokens.output*p.output_cost_per_token, cacheCreation:tokens.cacheCreation*p.cache_creation_input_token_cost, cacheRead:tokens.cacheRead*p.cache_read_input_token_cost, tools:0, cacheReadUncached:tokens.cacheRead*p.input_cost_per_token} : undefined;
	return { day: '2026-06-10', provider, model, tokens, requests: 1, cost: 0, costUnknownRequests: 0, monetary };
}

describe('cacheCostBreakdown', () => {
	it('sums the retained cache read and write charges', () => {
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
			byProvider.get('claude')!.cacheReadCost! + byProvider.get('codex')!.cacheReadCost!,
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
		expect(combined.cacheReadCost).toBeNull();
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
		expect(combined.cacheReadCost! + combined.cacheWriteCost!).toBeLessThanOrEqual(totalBurn + 1e-9);
	});
});

it('uses retained costs independently of model rates and leaves legacy breakdown unavailable', () => {
	const row = agg('claude','claude-opus-4-8',{cacheRead:100,cacheCreation:20});
	row.monetary = {input:1,output:2,cacheRead:7,cacheCreation:11,tools:3,cacheReadUncached:19};
	expect(cacheCostBreakdown([row]).combined).toMatchObject({cacheReadCost:7,cacheWriteCost:11,savedVsUncached:12});
	delete row.monetary;
	expect(cacheCostBreakdown([row]).combined).toMatchObject({cacheReadCost:null,cacheWriteCost:null,savedVsUncached:null});
});

it('model aggregation retains a complete breakdown and withholds mixed legacy components', async () => {
	const { aggregateByModel } = await import('@chaching/shared/aggregate');
	const row = agg('claude', 'claude-opus-4-8', {cacheRead:100});
	row.monetary = {input:1,output:2,cacheCreation:3,cacheRead:4,tools:5,cacheReadUncached:9};
	expect(aggregateByModel([row, row])[0].monetary).toEqual({input:2,output:4,cacheCreation:6,cacheRead:8,tools:10,cacheReadUncached:18});
	const legacy = {...row, monetary:undefined};
	expect(aggregateByModel([row, legacy])[0].monetary).toBeUndefined();
	expect(aggregateByModel([legacy, row])[0].monetary).toBeUndefined();
});
