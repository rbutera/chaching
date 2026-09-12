import { describe, it, expect } from 'vitest';
import {
	normalizeCatalog,
	resolveValuation,
	mergeCatalogs,
	validateCatalog
} from '@chaching/shared/pricing/catalog';
import { bundledCatalog } from '@chaching/shared/pricing/bundled';
import { resolvePrice } from '@chaching/core/pricing/cost';
import { resolvePriceClient } from '@chaching/shared/pricing-client';
const tokens = { input: 100, output: 10, cacheCreation: 0, cacheRead: 0 };
const lookup = (
	catalog: ReturnType<typeof normalizeCatalog>,
	model: string,
	provider = 'anthropic'
) => resolveValuation(catalog, { model, provider, tokens });
describe('shared catalog', () => {
	it('keeps identity, exact normalization and family estimates distinct', () => {
		expect(lookup(bundledCatalog, 'claude-fable-5-1[1m]').kind).toBe('exact');
		expect(lookup(bundledCatalog, 'claude-fable-9').kind).toBe('estimated');
		expect(lookup(bundledCatalog, 'claude-fable-5-1[unexpected]').kind).toBe(
			'estimated'
		);
		expect(lookup(bundledCatalog, 'claude-fable-5-1', 'bedrock').kind).toBe(
			'estimated'
		);
		expect(lookup(bundledCatalog, 'unrecognized').kind).toBe('missing');
	});
	it('prices input-only usage with a partial rate row and retains it through cache validation', () => {
		const partial = normalizeCatalog(
			'modelsdev',
			{ anthropic: { models: { partial: { cost: { input: 2 } } } } },
			'partial'
		);
		const restored = validateCatalog(JSON.parse(JSON.stringify(partial)));
		expect(
			resolveValuation(restored, {
				provider: 'anthropic',
				model: 'partial',
				tokens: { ...tokens, output: 0 }
			})
		).toMatchObject({ kind: 'exact', cost: expect.closeTo(0.0002, 10) });
		expect(
			resolveValuation(restored, {
				provider: 'anthropic',
				model: 'partial',
				tokens
			})
		).toMatchObject({ kind: 'missing', cost: null });
		expect(() =>
			validateCatalog({
				...partial,
				entries: partial.entries.map((e) => ({ ...e, rates: {} }))
			})
		).toThrow('Invalid pricing entry');
	});
	it('honors literal ids before annotation normalization', () => {
		const catalog = normalizeCatalog(
			'modelsdev',
			{
				anthropic: {
					models: {
						'claude-test': { cost: { input: 1, output: 2 } },
						'claude-test[1m]': { cost: { input: 3, output: 4 } }
					}
				}
			},
			'literal'
		);
		expect(lookup(catalog, 'claude-test[1m]').cost).toBeCloseTo(0.00034);
	});
	it('requires rates only for dimensions actually billed and preserves free rates', () => {
		const catalog = normalizeCatalog(
			'modelsdev',
			{ anthropic: { models: { free: { cost: { input: 0, output: 0 } } } } },
			'free'
		);
		expect(lookup(catalog, 'free')).toMatchObject({ kind: 'exact', cost: 0 });
		expect(
			resolveValuation(catalog, {
				provider: 'anthropic',
				model: 'free',
				tokens: { ...tokens, cacheRead: 1 }
			}).kind
		).toBe('missing');
		expect(
			resolveValuation(catalog, {
				provider: 'anthropic',
				model: 'free',
				tokens,
				tools: { search: 1 }
			}).kind
		).toBe('missing');
	});
	it('preserves actual models.dev context tier thresholds and explicit LiteLLM TTL rates', () => {
		const catalog = normalizeCatalog(
			'modelsdev',
			{
				anthropic: {
					models: {
						tiered: {
							cost: {
								input: 1,
								output: 2,
								context_over_200k: { input: 3, output: 4 },
								tiers: [
									{
										tier: { type: 'context', size: 272000 },
										input: 3,
										output: 4
									}
								]
							}
						}
					}
				}
			},
			'tiers'
		);
		expect(
			resolveValuation(catalog, {
				provider: 'anthropic',
				model: 'tiered',
				tokens,
				promptTokens: 272000
			}).cost
		).toBeCloseTo(0.00012);
		expect(
			resolveValuation(catalog, {
				provider: 'anthropic',
				model: 'tiered',
				tokens,
				promptTokens: 272001
			}).cost
		).toBeCloseTo(0.00034);
		const ttl = normalizeCatalog(
			'litellm',
			{
				'claude-ttl': {
					input_cost_per_token: 1,
					output_cost_per_token: 2,
					cache_creation_input_token_cost: 3,
					cache_creation_input_token_cost_above_1hr: 4
				}
			},
			'ttl'
		);
		expect(
			resolveValuation(ttl, {
				provider: 'anthropic',
				model: 'claude-ttl',
				tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 10 },
				cacheCreation1h: 4,
				cacheCreation5m: 6
			}).cost
		).toBe(34);
	});
	it('keeps combined context and cache duration rates and bills supported tools', () => {
		const catalog = normalizeCatalog(
			'litellm',
			{
				'claude-tiered': {
					input_cost_per_token: 1,
					output_cost_per_token: 2,
					cache_creation_input_token_cost: 3,
					cache_creation_input_token_cost_above_1hr: 4,
					cache_creation_input_token_cost_above_200k_tokens: 6,
					cache_creation_input_token_cost_above_1hr_above_200k_tokens: 8
				}
			},
			'ttl'
		);
		const v = resolveValuation(catalog, {
			provider: 'anthropic',
			model: 'claude-tiered',
			tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 10 },
			cacheCreation1h: 4,
			cacheCreation5m: 6,
			promptTokens: 200001,
			tools: { webSearch: 2, webFetch: 3 }
		});
		expect(v.cost).toBeCloseTo(68.02);
	});
	it('uses Dashscope strict lower boundaries and its final range above the last boundary', () => {
		const catalog = normalizeCatalog(
			'litellm',
			{
				'dashscope/test': {
					litellm_provider: 'dashscope',
					input_cost_per_token: 1,
					output_cost_per_token: 2,
					tiered_pricing: [
						{
							range: [0, 100],
							input_cost_per_token: 1,
							output_cost_per_token: 2
						},
						{
							range: [100, 200],
							input_cost_per_token: 3,
							output_cost_per_token: 4
						}
					]
				}
			},
			'ranges'
		);
		expect(
			resolveValuation(catalog, {
				provider: 'dashscope',
				model: 'dashscope/test',
				tokens,
				promptTokens: 99
			}).cost
		).toBe(120);
		expect(
			resolveValuation(catalog, {
				provider: 'dashscope',
				model: 'dashscope/test',
				tokens,
				promptTokens: 100
			}).cost
		).toBe(120);
		expect(
			resolveValuation(catalog, {
				provider: 'dashscope',
				model: 'dashscope/test',
				tokens,
				promptTokens: 201
			}).cost
		).toBe(340);
	});
	it('retains usable old rows after incomplete updates and rejects invalid cache data', () => {
		const old = normalizeCatalog(
			'modelsdev',
			{
				anthropic: {
					models: { a: { cost: { input: 1, output: 2, cache_read: 0.1 } } }
				}
			},
			'old',
			true
		);
		const next = normalizeCatalog(
			'modelsdev',
			{ anthropic: { models: { a: { cost: { input: 3, output: 4 } } } } },
			'new',
			true
		);
		expect(mergeCatalogs('merged', old, next).entries[0].revision).toBe('old');
		expect(() =>
			validateCatalog({ revision: 'bad', entries: [{ rates: { input: -1 } }] })
		).toThrow();
		expect(validateCatalog(JSON.parse(JSON.stringify(old)))).toEqual(old);
	});
	it('retains the complete source entry when an update loses tier or tool prices', () => {
		const row = {
			litellm_provider: 'dashscope',
			input_cost_per_token: 1,
			output_cost_per_token: 2,
			cache_read_input_token_cost: 0.1,
			tiered_pricing: [
				{
					range: [0, 100],
					input_cost_per_token: 1,
					output_cost_per_token: 2,
					cache_read_input_token_cost: 0.1
				}
			],
			search_context_cost_per_query: { low: 0.01, medium: 0.01, high: 0.01 }
		};
		const old = normalizeCatalog(
			'litellm',
			{ 'dashscope/test': row },
			'complete',
			true
		);
		const noTierCache = {
			...row,
			tiered_pricing: [
				{ range: [0, 100], input_cost_per_token: 3, output_cost_per_token: 4 }
			]
		};
		const { search_context_cost_per_query, ...noTool } = row;
		for (const incomplete of [noTierCache, noTool]) {
			const next = normalizeCatalog(
				'litellm',
				{ 'dashscope/test': incomplete },
				'incomplete',
				true
			);
			const merged = mergeCatalogs('merged', old, next);
			expect(merged.entries[0].revision).toBe('complete');
			expect(
				resolveValuation(merged, {
					provider: 'dashscope',
					model: 'dashscope/test',
					tokens: { ...tokens, cacheRead: 10 },
					tools: { webSearch: 1 }
				}).kind
			).toBe('exact');
		}
		const freeTool = normalizeCatalog(
			'litellm',
			{
				'dashscope/test': {
					...row,
					search_context_cost_per_query: { low: 0, medium: 0, high: 0 }
				}
			},
			'free-tool',
			true
		);
		expect(mergeCatalogs('merged', old, freeTool).entries[0].revision).toBe(
			'free-tool'
		);
	});
	it('executes the same server and browser resolver for all result classes', () => {
		for (const model of [
			'claude-fable-5',
			'claude-fable-5-1[1m]',
			'claude-fable-9',
			'gpt-6-astra',
			'gpt-5.6-mars',
			'unrecognized'
		]) {
			const server = resolvePrice(model),
				client = resolvePriceClient(model);
			expect(client?.input ?? null).toBe(server?.input_cost_per_token ?? null);
			expect(client?.cacheRead ?? null).toBe(
				server?.cache_read_input_token_cost ?? null
			);
		}
	});
});
