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

function slice(partial: Partial<UsageSlice> & Pick<UsageSlice, 'provider' | 'model'>): UsageSlice {
	return {
		tokens: { input: 100, output: 200, cacheCreation: 50, cacheRead: 80 },
		requests: 1,
		actualCost: 0,
		costUnknownRequests: 0,
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
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8' });
		const r = altModelScenario(input([s]), 'gpt-5', opusToOpenai, costFromPriceEntry);

		// actual at OPUS: input 100*5e-6=5e-4; cacheWrite 50*6.25e-6=3.125e-4;
		//   cacheRead 80*5e-7=4e-5; output 200*2.5e-5=5e-3  => 5.8525e-3
		expect(r.actualUsd).toBeCloseTo(5.8525e-3, 12);
		// target at OPENAI with cacheCreation(50) folded into input => input=150:
		//   150*2e-6=3e-4; cacheRead 80*5e-7=4e-5; output 200*1e-5=2e-3 => 2.34e-3
		expect(r.totalUsd).toBeCloseTo(2.34e-3, 12);
		expect(r.deltaUsd).toBeCloseTo(2.34e-3 - 5.8525e-3, 12);
		expect(r.exclusions.modelCount).toBe(0);
		expect(r.notes.some((n) => n.includes('50 cache-write tokens'))).toBe(true);
	});

	it('equals costFromPriceEntry applied with the target price when target keeps cache-write', () => {
		// Target with a real cache-write price → no folding, straight reprice.
		const targetWithCache: PriceEntry = { ...OPUS, input_cost_per_token: 3e-6 };
		const resolver: PriceResolver = { source: () => OPUS, target: () => targetWithCache };
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8' });
		const r = altModelScenario(input([s]), 'sonnet-ish', resolver, costFromPriceEntry);
		expect(r.totalUsd).toBeCloseTo(costFromPriceEntry(targetWithCache, s.tokens), 12);
		expect(r.notes.some((n) => n.includes('cache-write tokens'))).toBe(false);
	});
});

describe('noCacheScenario (task 1.3)', () => {
	it('rebills cache reads+writes at base input rate; delta is the caching saving', () => {
		const s = slice({ provider: 'claude', model: 'claude-opus-4-8' });
		const resolver: PriceResolver = { source: () => OPUS, target: () => OPUS };
		const r = noCacheScenario(input([s]), resolver, costFromPriceEntry);

		expect(r.actualUsd).toBeCloseTo(5.8525e-3, 12);
		// no-cache: input=100+80+50=230 * 5e-6 = 1.15e-3; output 5e-3 => 6.15e-3
		expect(r.totalUsd).toBeCloseTo(6.15e-3, 12);
		// caching saved exactly the delta, and it is an upper bound (>= 0)
		expect(r.deltaUsd).toBeCloseTo(2.975e-4, 12);
		expect(r.deltaUsd).toBeGreaterThan(0);
		expect(r.notes.some((n) => n.includes('Upper bound'))).toBe(true);
	});
});

describe('both-sides exclusion (task 1.5)', () => {
	it('a null SOURCE price excludes the slice from BOTH totals — never one-sided', () => {
		// Resolver knows OPUS for "known" models and nothing for "mystery".
		const resolver: PriceResolver = {
			source: (_p, model) => (model === 'mystery' ? null : OPUS),
			target: () => OPENAI
		};
		const known = slice({ provider: 'claude', model: 'known', actualCost: 1.23 });
		const mystery = slice({ provider: 'claude', model: 'mystery', actualCost: 0 });

		const r = altModelScenario(input([known, mystery]), 'gpt-5', resolver, costFromPriceEntry);

		// The engine's totals over BOTH slices must equal the totals over the
		// single priceable slice — proving the excluded slice added nothing to
		// EITHER side (a one-sided exclusion would break exactly one of these).
		const solo = altModelScenario(input([known]), 'gpt-5', resolver, costFromPriceEntry);
		expect(r.actualUsd).toBeCloseTo(solo.actualUsd, 12);
		expect(r.totalUsd).toBeCloseTo(solo.totalUsd, 12);

		expect(r.exclusions.modelCount).toBe(1);
		expect(r.exclusions.models).toEqual(['claude/mystery']);
		expect(r.exclusions.spendUsd).toBeCloseTo(0, 12);
	});

	it('a null TARGET price excludes every slice from both totals', () => {
		const resolver: PriceResolver = { source: () => OPUS, target: () => null };
		const a = slice({ provider: 'claude', model: 'a', actualCost: 2 });
		const b = slice({ provider: 'codex', model: 'b', actualCost: 3 });
		const r = altModelScenario(input([a, b]), 'unpriceable-target', resolver, costFromPriceEntry);
		expect(r.actualUsd).toBe(0);
		expect(r.totalUsd).toBe(0);
		expect(r.exclusions.modelCount).toBe(2);
		expect(r.exclusions.spendUsd).toBeCloseTo(5, 12);
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

	function usage(inputTokens: number, from: string, to: string): WhatifInput {
		return input(
			[slice({ provider: 'claude', model: 'm', tokens: { input: inputTokens, output: 0, cacheCreation: 0, cacheRead: 0 } })],
			{ from, to }
		);
	}

	it('names the cheapest PAID plan when it beats pay-as-you-go (Free/Custom excluded)', () => {
		// 30-day window, burn = 50M * 1e-6 = $50/mo pay-as-you-go.
		const [r] = planFitScenarios(usage(50_000_000, '2026-07-01', '2026-07-30'), resolver, costFromPriceEntry, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(50, 9);
		expect(r.totalUsd).toBe(20); // Pro, not Free ($0) which is excluded
		expect(r.deltaUsd).toBeCloseTo(-30, 9);
		expect(r.notes.some((n) => n.includes('Pro ($20/mo)'))).toBe(true);
		expect(r.notes.some((n) => n.includes('2026-06'))).toBe(true);
	});

	it('normalizes a sub-month window to a 30-day monthly figure', () => {
		// 15-day window, burn $50 over the window => $100/mo normalized.
		const [r] = planFitScenarios(usage(50_000_000, '2026-07-01', '2026-07-15'), resolver, costFromPriceEntry, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(100, 9);
		expect(r.totalUsd).toBe(20);
		expect(r.deltaUsd).toBeCloseTo(-80, 9);
	});

	it('keeps pay-as-you-go when no flat plan beats it', () => {
		// $5/mo burn: cheapest paid plan (Pro $20) does not beat it.
		const [r] = planFitScenarios(usage(5_000_000, '2026-07-01', '2026-07-30'), resolver, costFromPriceEntry, planTable, '2026-06');
		expect(r.actualUsd).toBeCloseTo(5, 9);
		expect(r.totalUsd).toBeCloseTo(5, 9);
		expect(r.deltaUsd).toBeCloseTo(0, 9);
		expect(r.basis).toContain('pay-as-you-go');
	});

	it('returns [] without a window (nothing to normalize against)', () => {
		const noWindow = input([slice({ provider: 'claude', model: 'm' })], null);
		expect(planFitScenarios(noWindow, resolver, costFromPriceEntry, planTable)).toEqual([]);
	});
});
