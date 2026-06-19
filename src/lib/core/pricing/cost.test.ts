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
});
