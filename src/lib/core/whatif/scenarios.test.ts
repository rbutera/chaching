import { describe, expect, it } from 'vitest';
import { costFromPriceEntry } from '../pricing/cost';
import type { PriceEntry } from '../pricing/overrides';
import type { SubscriptionPreset } from '../subscription-presets';
import { altModelScenario, noCacheScenario, planFitScenarios } from './scenarios';
import type { PriceResolver, UsageSlice, WhatifInput } from './types';

// Hand-picked round rates so every expected total below is computed by hand.
// Anthropic-shaped source: has a cache-write price.
const OPUS: PriceEntry = {
	input_cost_per_token: 5e-6,
	output_cost_per_token: 2.5e-5,
	cache_creation_input_token_cost: 6.25e-6,
	cache_read_input_token_cost: 5e-7
};
// OpenAI-shaped target: NO cache-write price (cache_creation = 0), has cache-read.
const OPENAI: PriceEntry = {
	input_cost_per_token: 2e-6,
	output_cost_per_token: 1e-5,
	cache_creation_input_token_cost: 0,
	cache_read_input_token_cost: 5e-7
};

// The recorded bill for the standard OPUS slice below (tokens 100/200/50/80),
// computed by hand: input 5e-4 + cacheWrite 3.125e-4 + cacheRead 4e-5 + output 5e-3.
const OPUS_ACTUAL = 5.8525e-3;

function slice(partial: Partial<UsageSlice> & Pick<UsageSlice, 'provider' | 'model'>): UsageSlice {
	return {
		tokens: { input: 100, output: 200, cacheCreation: 50, cacheRead: 80 },
		requests: 1,
		actualCost: 0,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		...partial
	};
}

function input(slices: UsageSlice[], window: WhatifInput['window'] = null): WhatifInput {
	return { slices, window };
}

/** Resolver where source is always OPUS and target is always OPENAI. */
const opusToOpenai: PriceResolver = {
	source: () => OPUS,
	target: () => OPENAI
};

describe('altModelScenario (task 1.2)', () => {
	it('cross-catalog Anthropic→OpenAI: cache-write folded to input rate, hand-computed', () => {
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8', actualCost: OPUS_ACTUAL });
		const r = altModelScenario(input([s]), 'gpt-5', opusToOpenai, costFromPriceEntry);

		// actual side is the RECORDED bill, not a recompute.
		expect(r.actualUsd).toBeCloseTo(OPUS_ACTUAL, 12);
		// target at OPENAI with cacheCreation(50) folded into input => input=150:
		//   150*2e-6=3e-4; cacheRead 80*5e-7=4e-5; output 200*1e-5=2e-3 => 2.34e-3
		expect(r.totalUsd).toBeCloseTo(2.34e-3, 12);
		expect(r.deltaUsd).toBeCloseTo(2.34e-3 - OPUS_ACTUAL, 12);
		expect(r.exclusions.modelCount).toBe(0);
		expect(r.exclusions.spendUsd).toBe(0);
		expect(r.notes.some((n) => n.includes('50 cache-write tokens'))).toBe(true);
	});

	it('equals costFromPriceEntry applied with the target price when target keeps cache-write', () => {
		// Target with a real cache-write price → no folding, straight reprice.
		const targetWithCache: PriceEntry = { ...OPUS, input_cost_per_token: 3e-6 };
		const resolver: PriceResolver = { source: () => OPUS, target: () => targetWithCache };
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8', actualCost: OPUS_ACTUAL });
		const r = altModelScenario(input([s]), 'sonnet-ish', resolver, costFromPriceEntry);
		// No 1h/5m split on the slice → the whole creation count bills at the base rate.
		expect(r.totalUsd).toBeCloseTo(costFromPriceEntry(targetWithCache, s.tokens, 0, 0, 0), 12);
		expect(r.notes.some((n) => n.includes('cache-write tokens'))).toBe(false);
	});

	it('passes the recorded 1h/5m cache-write split through to the target rates', () => {
		// Target distinguishes 1h vs 5m cache-writes.
		const targetSplit: PriceEntry = {
			input_cost_per_token: 3e-6,
			output_cost_per_token: 1.5e-5,
			cache_creation_input_token_cost: 3.75e-6, // 5m / base
			cache_creation_input_token_cost_above_1hr: 6e-6, // 1h
			cache_read_input_token_cost: 3e-7
		};
		const resolver: PriceResolver = { source: () => OPUS, target: () => targetSplit };
		// 50 cache-write tokens recorded as 30 @1h + 20 @5m.
		const s = slice({
			provider: 'claude',
			model: 'claude-opus-4-8',
			actualCost: OPUS_ACTUAL,
			cacheCreation1h: 30,
			cacheCreation5m: 20
		});
		const r = altModelScenario(input([s]), 'split-target', resolver, costFromPriceEntry);

		// With split: cacheWrite = 30*6e-6 + 20*3.75e-6 = 2.55e-4; input 100*3e-6=3e-4;
		//   cacheRead 80*3e-7=2.4e-5; output 200*1.5e-5=3e-3 => 3.579e-3.
		expect(r.totalUsd).toBeCloseTo(3.579e-3, 12);
		// It must DIFFER from ignoring the split (all 50 at the base 5m rate = 3.5115e-3).
		expect(r.totalUsd).not.toBeCloseTo(costFromPriceEntry(targetSplit, s.tokens, 0, 0, 0), 12);
	});

	it('appends a long-context lower-bound note when the target carries a threshold', () => {
		const longCtxTarget: PriceEntry = {
			...OPENAI,
			long_context_threshold_tokens: 272_000,
			long_context_input_multiplier: 2,
			long_context_output_multiplier: 1.5
		};
		const resolver: PriceResolver = { source: () => OPUS, target: () => longCtxTarget };
		// A big slice whose SUMMED input crosses 272k though no single request did.
		const s = slice({
			provider: 'claude',
			model: 'claude-opus-4-8',
			actualCost: OPUS_ACTUAL,
			tokens: { input: 500_000, output: 10, cacheCreation: 0, cacheRead: 0 }
		});
		const r = altModelScenario(input([s]), 'long-ctx', resolver, costFromPriceEntry);
		// promptTokens: 0 → the multiplier never fires on the aggregate.
		expect(r.totalUsd).toBeCloseTo(costFromPriceEntry(longCtxTarget, s.tokens, 0, 0, 0), 12);
		expect(r.notes.some((n) => n.includes('Long-context surcharges excluded'))).toBe(true);
	});
});

describe('noCacheScenario (task 1.3)', () => {
	it('rebills cache reads+writes at base input rate; delta is the caching saving', () => {
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8', actualCost: OPUS_ACTUAL });
		const resolver: PriceResolver = { source: () => OPUS, target: () => OPUS };
		const r = noCacheScenario(input([s]), resolver, costFromPriceEntry);

		expect(r.actualUsd).toBeCloseTo(OPUS_ACTUAL, 12);
		// no-cache: input=100+80+50=230 * 5e-6 = 1.15e-3; output 5e-3 => 6.15e-3
		expect(r.totalUsd).toBeCloseTo(6.15e-3, 12);
		// caching saved exactly the delta, and it is an upper bound (>= 0)
		expect(r.deltaUsd).toBeCloseTo(2.975e-4, 12);
		expect(r.deltaUsd!).toBeGreaterThan(0);
		expect(r.notes.some((n) => n.includes('Upper bound'))).toBe(true);
	});
});

describe('both-sides exclusion (task 1.5)', () => {
	it('a source-null slice with NONZERO recorded cost is excluded from the ACTUAL side', () => {
		// mystery has a real recorded bill but the resolver can't price it → it must
		// NOT leak into actualUsd (a one-sided include would fabricate the delta).
		const resolver: PriceResolver = {
			source: (_p, model) => (model === 'mystery' ? null : OPUS),
			target: () => OPENAI
		};
		const known = slice({ provider: 'claude', model: 'known', actualCost: OPUS_ACTUAL });
		const mystery = slice({
			provider: 'claude',
			model: 'mystery',
			actualCost: 4.2, // NONZERO recorded spend, but source-unpriceable here
			costUnknownRequests: 0
		});

		const r = altModelScenario(input([known, mystery]), 'gpt-5', resolver, costFromPriceEntry);
		const solo = altModelScenario(input([known]), 'gpt-5', resolver, costFromPriceEntry);

		// Repricing both == repricing only the priceable slice: mystery added to NEITHER side.
		expect(r.actualUsd).toBeCloseTo(solo.actualUsd!, 12);
		expect(r.actualUsd).toBeCloseTo(OPUS_ACTUAL, 12); // NOT OPUS_ACTUAL + 4.2
		expect(r.totalUsd).toBeCloseTo(solo.totalUsd!, 12);
		expect(r.exclusions.modelCount).toBe(1);
		expect(r.exclusions.models).toEqual(['claude/mystery']);
		// mystery was fully priced (costUnknownRequests 0) → its excluded spend IS known.
		expect(r.exclusions.spendUsd).toBeCloseTo(4.2, 12);
	});

	it('reports NULL excluded spend when an excluded slice was never fully priced', () => {
		const resolver: PriceResolver = {
			source: (_p, model) => (model === 'mystery' ? null : OPUS),
			target: () => OPENAI
		};
		const known = slice({ provider: 'claude', model: 'known', actualCost: OPUS_ACTUAL });
		// source-unpriceable AND unpriced at ingest → recorded 0 means "unknown", not $0.
		const mystery = slice({
			provider: 'claude',
			model: 'mystery',
			actualCost: 0,
			costUnknownRequests: 3
		});
		const r = altModelScenario(input([known, mystery]), 'gpt-5', resolver, costFromPriceEntry);
		expect(r.exclusions.modelCount).toBe(1);
		expect(r.exclusions.spendUsd).toBeNull();
		expect(r.notes.some((n) => n.includes('An unknown amount'))).toBe(true);
	});

	it('a null TARGET price makes the whole scenario UNAVAILABLE (null totals), not $0', () => {
		const resolver: PriceResolver = { source: () => OPUS, target: () => null };
		const a = slice({ provider: 'claude', model: 'a', actualCost: 2 });
		const b = slice({ provider: 'codex', model: 'b', actualCost: 3 });
		const r = altModelScenario(input([a, b]), 'unpriceable-target', resolver, costFromPriceEntry);
		expect(r.totalUsd).toBeNull();
		expect(r.actualUsd).toBeNull();
		expect(r.deltaUsd).toBeNull();
		expect(r.exclusions.modelCount).toBe(2);
		// both were fully priced → their excluded spend is known ($5).
		expect(r.exclusions.spendUsd).toBeCloseTo(5, 12);
	});

	it('no-cache with every slice unpriceable is UNAVAILABLE (null totals)', () => {
		const resolver: PriceResolver = { source: () => null, target: () => null };
		const s = slice({ provider: 'claude', model: 'x', actualCost: 0, costUnknownRequests: 1 });
		const r = noCacheScenario(input([s]), resolver, costFromPriceEntry);
		expect(r.totalUsd).toBeNull();
		expect(r.actualUsd).toBeNull();
		expect(r.deltaUsd).toBeNull();
		expect(r.exclusions.spendUsd).toBeNull();
	});
});

describe('planFitScenarios (task 1.4)', () => {
	// A model priced at $1e-6/input-token, no other rates → burn = input tokens × 1e-6.
	const CHEAP: PriceEntry = {
		input_cost_per_token: 1e-6,
		output_cost_per_token: 0,
		cache_creation_input_token_cost: 0,
		cache_read_input_token_cost: 0
	};
	const resolver: PriceResolver = { source: () => CHEAP, target: () => CHEAP };
	const planTable: Record<string, SubscriptionPreset[]> = {
		claude: [
			{ id: 'free', label: 'Free', monthlyUsd: 0 },
			{ id: 'pro', label: 'Pro', monthlyUsd: 20 },
			{ id: 'max', label: 'Max', monthlyUsd: 100 },
			{ id: 'custom', label: 'Custom', monthlyUsd: 0, custom: true }
		]
	};

	// The RECORDED bill is what plan-fit sums, so the fixture carries actualCost
	// (== inputTokens × 1e-6, the CHEAP rate) rather than relying on a recompute.
	function usage(inputTokens: number, from: string, to: string): WhatifInput {
		return input(
			[
				slice({
					provider: 'claude',
					model: 'm',
					tokens: { input: inputTokens, output: 0, cacheCreation: 0, cacheRead: 0 },
					actualCost: inputTokens * 1e-6
				})
			],
			{ from, to }
		);
	}

	it('names the cheapest PAID plan when it beats pay-as-you-go (Free/Custom excluded)', () => {
		// 30-day window, burn = 50M * 1e-6 = $50/mo pay-as-you-go.
		const [r] = planFitScenarios(usage(50_000_000, '2026-07-01', '2026-07-30'), resolver, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(50, 9);
		expect(r.totalUsd).toBe(20); // Pro, not Free ($0) which is excluded
		expect(r.deltaUsd).toBeCloseTo(-30, 9);
		expect(r.notes.some((n) => n.includes('Pro ($20/mo)'))).toBe(true);
		expect(r.notes.some((n) => n.includes('2026-06'))).toBe(true);
	});

	it('normalizes a sub-month window to a 30-day monthly figure', () => {
		// 15-day window, burn $50 over the window => $100/mo normalized.
		const [r] = planFitScenarios(usage(50_000_000, '2026-07-01', '2026-07-15'), resolver, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(100, 9);
		expect(r.totalUsd).toBe(20);
		expect(r.deltaUsd).toBeCloseTo(-80, 9);
	});

	it('keeps pay-as-you-go when no flat plan beats it', () => {
		// $5/mo burn: cheapest paid plan (Pro $20) does not beat it.
		const [r] = planFitScenarios(usage(5_000_000, '2026-07-01', '2026-07-30'), resolver, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(5, 9);
		expect(r.totalUsd).toBeCloseTo(5, 9);
		expect(r.deltaUsd).toBeCloseTo(0, 9);
		expect(r.basis).toContain('pay-as-you-go');
	});

	it('returns [] without a window (nothing to normalize against)', () => {
		const noWindow = input([slice({ provider: 'claude', model: 'm' })], null);
		expect(planFitScenarios(noWindow, resolver, planTable)).toEqual([]);
	});

	it('an entirely unpriceable provider yields an UNAVAILABLE row, not a $0 verdict', () => {
		const nullResolver: PriceResolver = { source: () => null, target: () => null };
		const wi = input(
			[
				slice({
					provider: 'claude',
					model: 'm',
					tokens: { input: 50_000_000, output: 0, cacheCreation: 0, cacheRead: 0 },
					actualCost: 0,
					costUnknownRequests: 4
				})
			],
			{ from: '2026-07-01', to: '2026-07-30' }
		);
		const [r] = planFitScenarios(wi, nullResolver, planTable, '2026-06');
		expect(r.totalUsd).toBeNull();
		expect(r.actualUsd).toBeNull();
		expect(r.deltaUsd).toBeNull();
		expect(r.exclusions.spendUsd).toBeNull();
		expect(r.basis).toContain('no priceable usage');
	});
});
