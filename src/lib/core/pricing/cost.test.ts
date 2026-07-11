import { describe, it, expect } from 'vitest';
import { computeCost, resolvePrice, hasPrice } from './cost';
import type { TokenCounts } from '../../types';

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

	it('returns null (not zero) for a genuinely unknown model, so it is flagged not silently free', () => {
		expect(computeCost('totally-made-up-model-xyz-9000', tokens)).toBeNull();
		expect(resolvePrice('totally-made-up-model-xyz-9000')).toBeNull();
	});

	it('prices the three GPT-5.6 tiers at their exact standard rates', () => {
		const standard = { input: 100_000, output: 100_000, cacheCreation: 0, cacheRead: 100_000 };
		expect(computeCost('gpt-5.6-sol', standard)).toBeCloseTo(3.55);
		expect(computeCost('gpt-5.6-terra', standard)).toBeCloseTo(1.775);
		expect(computeCost('gpt-5.6-luna', standard)).toBeCloseTo(0.71);
	});

	it('bills explicit GPT-5.6 cache writes at 1.25x without inferring them', () => {
		const explicitWrite = { input: 0, output: 0, cacheCreation: 100_000, cacheRead: 0 };
		expect(computeCost('gpt-5.6-sol', explicitWrite, 0, 0, 100_000)).toBeCloseTo(0.625);
		expect(computeCost('gpt-5.6-sol', { ...explicitWrite, cacheCreation: 0 }, 0, 0, 100_000)).toBe(0);
	});

	it('applies long-context pricing strictly above 272k prompt tokens', () => {
		const request = { input: 172_000, output: 10_000, cacheCreation: 0, cacheRead: 100_000 };
		expect(computeCost('gpt-5.6-sol', request, 0, 0, 272_000)).toBeCloseTo(1.21);
		expect(computeCost('gpt-5.6-sol', request, 0, 0, 272_001)).toBeCloseTo(2.27);
	});

	it('counts cached input toward the long-context boundary', () => {
		const request = { input: 100_000, output: 0, cacheCreation: 0, cacheRead: 172_001 };
		expect(computeCost('gpt-5.6-terra', request)).toBeCloseTo(0.5860005);
	});

	it('keeps unknown GPT-5.6 tiers unknown', () => {
		expect(resolvePrice('gpt-5.6-mars')).toBeNull();
		expect(computeCost('gpt-5.6-mars', tokens)).toBeNull();
	});
});
