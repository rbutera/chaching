import { describe, it, expect } from 'vitest';
import { resolveModelsDevPrice, getModelsDevMeta } from './modelsdev';

describe('resolveModelsDevPrice', () => {
	it('prices an Anthropic model via the opencode (Zen) catalog with full rates', () => {
		const p = resolveModelsDevPrice('opencode', 'claude-opus-4-8');
		expect(p).not.toBeNull();
		expect(p!.input_cost_per_token).toBeGreaterThan(0);
		expect(p!.output_cost_per_token).toBeGreaterThan(0);
		expect(p!.cache_read_input_token_cost).toBeGreaterThan(0);
		expect(p!.cache_creation_input_token_cost).toBeGreaterThan(0);
	});

	it('gives an opencode-go model a zero cache-creation rate (no cache_write)', () => {
		const p = resolveModelsDevPrice('opencode-go', 'deepseek-v4-flash');
		expect(p).not.toBeNull();
		expect(p!.cache_creation_input_token_cost).toBe(0);
		expect(p!.input_cost_per_token).toBeGreaterThan(0);
		expect(p!.output_cost_per_token).toBeGreaterThan(0);
		expect(p!.cache_read_input_token_cost).toBeGreaterThan(0);
	});

	it('normalises cursor-acp opus-4.6 to the Anthropic Opus entry with a cache-write rate', () => {
		const p = resolveModelsDevPrice('cursor-acp', 'opus-4.6');
		expect(p).not.toBeNull();
		expect(p!.input_cost_per_token).toBeGreaterThan(0);
		expect(p!.output_cost_per_token).toBeGreaterThan(0);
		expect(p!.cache_creation_input_token_cost).toBeGreaterThan(0);
	});

	it('returns null for a fully unknown provider/model pair', () => {
		expect(resolveModelsDevPrice('nonsense-provider', 'totally-unknown-model-xyz')).toBeNull();
	});

	it('converts per-million rates to per-token exactly (input 5 -> 5e-6)', () => {
		const p = resolveModelsDevPrice('opencode', 'claude-opus-4-8');
		expect(p).not.toBeNull();
		// providers.opencode.models["claude-opus-4-8"].cost.input === 5 (per Mtok)
		expect(p!.input_cost_per_token).toBe(5e-6);
	});
});

describe('getModelsDevMeta', () => {
	it('exposes the snapshot source and date', () => {
		const meta = getModelsDevMeta();
		expect(meta.source).toBe('models.dev');
		expect(meta.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
