import { describe, expect, it } from 'vitest';
import { mergeSnapshot } from './gen-modelsdev-prices';

describe('models.dev snapshot merge', () => {
	const previous = {
		anthropic: { models: { 'claude-opus-4-1': { name: 'Opus 4.1', cost: { input: 15, output: 75 } } } },
		moonshotai: { models: { 'kimi-k2.5': { name: 'Kimi K2.5', cost: { input: 0.6, output: 3 } } } }
	};

	it('keeps retired models, and whole retired providers, at their last published price', () => {
		const merged = mergeSnapshot(
			{ anthropic: { models: { 'claude-opus-5-5': { name: 'Opus 5.5', cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } } },
			previous
		);
		expect(Object.keys(merged.anthropic.models).sort()).toEqual(['claude-opus-4-1', 'claude-opus-5-5']);
		// moonshotai is absent upstream entirely; its retained rows survive.
		expect(merged.moonshotai).toEqual(previous.moonshotai);
	});

	it('lets fresh rows win and skips models without a cost block', () => {
		const merged = mergeSnapshot(
			{ anthropic: { models: { 'claude-opus-4-1': { name: 'Opus 4.1', cost: { input: 14, output: 70 } }, free: { name: 'No cost' } } } },
			previous
		);
		expect(merged.anthropic.models['claude-opus-4-1'].cost).toMatchObject({ input: 14, output: 70 });
		expect(merged.anthropic.models.free).toBeUndefined();
		expect(merged.opencode).toBeUndefined();
	});
});
