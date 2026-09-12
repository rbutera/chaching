import { describe, it, expect } from 'vitest';
import { resolveModelsDevPrice, getModelsDevMeta, normalizeModelID } from './modelsdev';

// Directly exercise normalization so a regression can't hide behind the family
// fallback (same-family ids resolve to the same rates either way).
describe('normalizeModelID', () => {
	it('rewrites bare family-version ids to canonical claude-<family>-<version>', () => {
		expect(normalizeModelID('opus-4.6')).toBe('claude-opus-4-6');
		expect(normalizeModelID('sonnet-4.5')).toBe('claude-sonnet-4-5');
		expect(normalizeModelID('haiku-4.5')).toBe('claude-haiku-4-5');
	});

	it('rewrites version-first ids (claude-4.5-sonnet) to family-first', () => {
		expect(normalizeModelID('claude-4.5-sonnet')).toBe('claude-sonnet-4-5');
	});

	it('strips a leading provider prefix', () => {
		expect(normalizeModelID('anthropic/opus-4.6')).toBe('claude-opus-4-6');
	});

	it('returns null when nothing changes', () => {
		expect(normalizeModelID('claude-opus-4-8')).toBeNull();
		expect(normalizeModelID('gpt-5.4')).toBeNull();
	});
});

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

	it.each(['moonshotai', 'moonshot', 'kimi', 'opencode', 'opencode-go'])(
		'prices Kimi K3 through %s at the canonical launch rates',
		(provider) => {
			const p = resolveModelsDevPrice(provider, 'kimi-k3');
			expect(p).not.toBeNull();
			expect(p!.input_cost_per_token).toBe(3e-6);
			expect(p!.output_cost_per_token).toBe(15e-6);
			expect(p!.cache_read_input_token_cost).toBe(0.3e-6);
			expect(p!.cache_creation_input_token_cost).toBe(0);
		}
	);

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

	it('cross-catalog fallback prefers the canonical list price over a discounted aggregator rate', () => {
		// "gpt-5" exists in both openai (canonical 1.25/Mtok) and the opencode Zen
		// catalog (discounted 1.07/Mtok). With an UNMAPPED providerID the resolver
		// must pick the canonical openai rate, not whichever comes first by
		// snapshot insertion order.
		const p = resolveModelsDevPrice('someunknownprovider', 'gpt-5');
		expect(p).not.toBeNull();
		expect(p!.input_cost_per_token).toBe(1.25e-6);
		expect(p!.input_cost_per_token).not.toBe(1.07e-6);
	});

	it('opus family fallback resolves to the explicit claude-opus-4-8 rates (not order-dependent)', () => {
		// An unknown opus-family id with no exact/normalised hit must fall back to
		// the explicit representative (claude-opus-4-8: input 5, output 25 /Mtok),
		// NOT the first /opus/i key by insertion order (claude-opus-4-5).
		const p = resolveModelsDevPrice('anthropic', 'opus-some-unreleased-variant');
		expect(p).not.toBeNull();
		expect(p!.input_cost_per_token).toBe(5e-6);
		expect(p!.output_cost_per_token).toBe(25e-6);
	});

	it('normalises the "claude-<version>-<family>" id format (claude-4.5-sonnet -> Sonnet rates)', () => {
		const p = resolveModelsDevPrice('cursor-acp', 'claude-4.5-sonnet');
		expect(p).not.toBeNull();
		// anthropic claude-sonnet-4-5: input 3, output 15 /Mtok.
		expect(p!.input_cost_per_token).toBe(3e-6);
		expect(p!.output_cost_per_token).toBe(15e-6);
	});

	it('prices a genuinely-free model as a real $0 entry (not null/unknown)', () => {
		// "*-free" ids have input:0/output:0 in the snapshot; that is a real $0
		// price, NOT an unknown one — the presence guard must return a PriceEntry.
		const p = resolveModelsDevPrice('opencode', 'ring-2.6-1t-free');
		expect(p).not.toBeNull();
		expect(p!.input_cost_per_token).toBe(0);
		expect(p!.output_cost_per_token).toBe(0);
	});
});

describe('getModelsDevMeta', () => {
	it('exposes the snapshot source and date', () => {
		const meta = getModelsDevMeta();
		expect(meta.source).toBe('models.dev');
		expect(meta.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
