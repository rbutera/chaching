import { describe, it, expect } from 'vitest';
import { computeCost, resolvePrice, hasPrice } from './cost';
import type { TokenCounts } from '@chaching/shared/types';

const tokens: TokenCounts = {
	input: 1_000_000,
	output: 1_000_000,
	cacheCreation: 0,
	cacheRead: 1_000_000
};

describe('cost resolution', () => {
	// Regression: the vendored snapshot used to be Claude-only, so every Codex
	// (OpenAI) model resolved to unknown and Codex spend rendered as $0.00 — for a
	// provider in heavy daily use. The snapshot must carry OpenAI/Codex prices.
	it('prices Codex / OpenAI models with a real (non-zero) cost', () => {
		for (const model of ['gpt-5.5', 'gpt-5.4', 'gpt-5-codex']) {
			expect(hasPrice(model), `${model} should be priced`).toBe(true);
			const cost = computeCost(model, tokens);
			expect(cost, `${model} cost`).not.toBeNull();
			expect(cost as number).toBeGreaterThan(0);
		}
	});

	it('prices Claude models', () => {
		const cost = computeCost('claude-opus-4-8', tokens);
		expect(cost).not.toBeNull();
		expect(cost as number).toBeGreaterThan(0);
	});

	it('prices exact Claude Opus 5 standard and cache TTL buckets', () => {
		expect(
			computeCost('claude-opus-5', {
				input: 1_000_000,
				output: 1_000_000,
				cacheCreation: 0,
				cacheRead: 0
			})
		).toBeCloseTo(30);
		expect(
			computeCost(
				'claude-opus-5',
				{ input: 0, output: 0, cacheCreation: 2_000_000, cacheRead: 1_000_000 },
				1_000_000,
				1_000_000
			)
		).toBeCloseTo(16.75);
	});

	it('keeps Opus 5 at standard rates throughout its 1M context window', () => {
		const request = {
			input: 900_000,
			output: 10_000,
			cacheCreation: 0,
			cacheRead: 100_000
		};
		expect(computeCost('claude-opus-5', request, 0, 0, 1_000_000)).toBeCloseTo(4.8);
		expect(resolvePrice('claude-opus-5')?.long_context_threshold_tokens).toBeUndefined();
	});

	it('returns null (not zero) for a genuinely unknown model, so it is flagged not silently free', () => {
		expect(computeCost('totally-made-up-model-xyz-9000', tokens)).toBeNull();
		expect(resolvePrice('totally-made-up-model-xyz-9000')).toBeNull();
	});

	it('prices the three GPT-5.6 tiers at their exact standard rates', () => {
		const standard = { input: 100_000, output: 100_000, cacheCreation: 0, cacheRead: 100_000 };
		expect(computeCost('gpt-5.6-sol', standard)).toBeCloseTo(2.44);
		expect(computeCost('gpt-5.6-terra', standard)).toBeCloseTo(1.42);
		expect(computeCost('gpt-5.6-luna', standard)).toBeCloseTo(0.142);
	});

	it('bills explicit GPT-5.6 cache writes at 1.25x without inferring them', () => {
		const explicitWrite = { input: 0, output: 0, cacheCreation: 100_000, cacheRead: 0 };
		expect(computeCost('gpt-5.6-sol', explicitWrite, 0, 0, 100_000)).toBeCloseTo(0.5);
		expect(computeCost('gpt-5.6-sol', { ...explicitWrite, cacheCreation: 0 }, 0, 0, 100_000)).toBe(0);
	});

	it('applies long-context pricing strictly above 272k prompt tokens', () => {
		const request = { input: 172_000, output: 10_000, cacheCreation: 0, cacheRead: 100_000 };
		expect(computeCost('gpt-5.6-sol', request, 0, 0, 272_000)).toBeCloseTo(0.928);
		expect(computeCost('gpt-5.6-sol', request, 0, 0, 272_001)).toBeCloseTo(1.756);
	});

	it('counts cached input toward the long-context boundary', () => {
		const request = { input: 100_000, output: 0, cacheCreation: 0, cacheRead: 172_001 };
		expect(computeCost('gpt-5.6-terra', request)).toBeCloseTo(0.4688004);
	});

	it('prices Claude Opus 5.5 at its published rates, including both cache-write TTLs', () => {
		const tokens = { input: 1_000_000, output: 1_000_000, cacheCreation: 2_000_000, cacheRead: 1_000_000 };
		// $4 in + $20 out + $5 5m write + $8 1h write + $0.20 read
		expect(computeCost('claude-opus-5-5', tokens, 1_000_000, 1_000_000)).toBeCloseTo(37.2);
	});

	it('counts cache writes of either TTL toward the Haiku 5.5 100K prompt tier', () => {
		const writes = { input: 1_000, output: 1_000, cacheCreation: 100_000, cacheRead: 0 };
		// 101K-token prompt: every rate is 5x ($0.50 in, $2.50 out, $1 1h write, $0.625 5m write).
		expect(computeCost('claude-haiku-5-5', writes, 100_000, 0)).toBeCloseTo(0.103, 6);
		expect(computeCost('claude-haiku-5-5', writes, 0, 100_000)).toBeCloseTo(0.0655, 6);
		// A 100K prompt is not over the threshold.
		const under = { ...writes, cacheCreation: 98_000 };
		expect(computeCost('claude-haiku-5-5', under, 98_000, 0)).toBeCloseTo(0.0202, 6);
	});

	it('maps an unknown future Opus id to the newest Opus estimate', () => {
		expect(resolvePrice('claude-opus-9')?.input_cost_per_token).toBe(4e-6);
	});

	it('keeps unknown GPT-5.6 tiers unknown', () => {
		expect(resolvePrice('gpt-5.6-mars')).toBeNull();
		expect(computeCost('gpt-5.6-mars', tokens)).toBeNull();
	});
});
