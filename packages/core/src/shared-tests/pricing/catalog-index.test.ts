import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	freezeCatalog,
	mergeCatalogs,
	normalizeCatalog,
	normalizeModelID,
	resolveValuation,
	valuationCandidates,
	type BillingInput,
	type CatalogEntry,
	type PricingCatalog
} from '@chaching/shared/pricing/catalog';
import { bundledCatalog } from '@chaching/shared/pricing/bundled';

const snapshot = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../../shared/src/pricing/data/${name}`, import.meta.url), 'utf8'));
const litellm = snapshot('litellm-prices.json');
const modelsdev = snapshot('modelsdev-prices.json');

// A production-shaped catalog: the bundled snapshots and overrides plus a downloaded copy
// of both upstream sources, so every rank (override, downloaded, bundled; LiteLLM and
// models.dev) is populated and many ids sit in several buckets at once.
const realistic = mergeCatalogs(
	'realistic',
	bundledCatalog,
	normalizeCatalog('litellm', litellm, 'downloaded-litellm', true),
	normalizeCatalog('modelsdev', modelsdev, 'downloaded-modelsdev', true)
);

// The linear scan resolveValuation used before the catalog index, kept verbatim as the oracle.
function legacyCandidates(catalog: PricingCatalog, input: Pick<BillingInput, 'provider' | 'model'>) {
	const aliases: Record<string, string> = { 'cursor-acp': 'anthropic', 'openai-codex': 'openai', moonshot: 'moonshotai', kimi: 'moonshotai' };
	const families: [RegExp, string][] = [
		[/(?:^|[-./])fable(?:-|$)/i, 'claude-fable-5-1'],
		[/(?:^|[-./])mythos(?:-|$)/i, 'claude-mythos-5-1'],
		[/(?:^|[-./])opus(?:-|$)/i, 'claude-opus-5-5'],
		[/(?:^|[-./])sonnet(?:-|$)/i, 'claude-sonnet-4-6'],
		[/(?:^|[-./])haiku(?:-|$)/i, 'claude-haiku-4-5']
	];
	const provider = aliases[input.provider] ?? input.provider;
	const ids = [input.model, ...(normalizeModelID(input.model) ? [normalizeModelID(input.model)!] : [])];
	const rank = (e: CatalogEntry) => (e.source === 'override' ? 0 : (e.downloaded ? 1 : 3) + (e.source === 'modelsdev' ? 1 : 0));
	const ordered = [...catalog.entries].sort((a, b) => rank(a) - rank(b));
	const candidates: { entry: CatalogEntry; kind: 'exact' | 'estimated' }[] = [];
	for (const model of ids)
		for (const entry of ordered)
			if (entry.provider === provider && (entry.model === model || entry.model === `${provider}/${model}`))
				candidates.push({ entry, kind: 'exact' });
	for (const p of ['anthropic', 'openai', 'google', 'moonshotai', 'opencode', 'opencode-go', 'zai'])
		for (const model of ids)
			for (const entry of ordered)
				if (entry.provider === p && entry.provider !== provider && entry.model === model)
					candidates.push({ entry, kind: 'estimated' });
	const representative = families.find(([pattern]) => pattern.test(input.model))?.[1];
	if (representative)
		for (const entry of ordered)
			if (entry.provider === 'anthropic' && entry.model === representative)
				candidates.push({ entry, kind: 'estimated' });
	return candidates;
}

function inputs(catalog: PricingCatalog): Pick<BillingInput, 'provider' | 'model'>[] {
	const models = new Set<string>();
	for (const entry of catalog.entries) {
		models.add(entry.model);
		const slash = entry.model.indexOf('/');
		if (slash > 0) models.add(entry.model.slice(slash + 1));
	}
	for (const model of [
		'claude-opus-5-5[1m]', 'opus-5.5', 'claude-5.5-opus', 'claude-opus-9', 'fable-5.1', 'mythos-5.1',
		'claude-sonnet-future', 'haiku-unreleased', 'anthropic/claude-opus-5-5', 'openai/gpt-5.5',
		'gpt-5.6-mars', 'unrecognized', ''
	])
		models.add(model);
	const providers = [...new Set(catalog.entries.map((e) => e.provider))].concat(['cursor-acp', 'openai-codex', 'moonshot', 'kimi', '', 'nonsense']);
	return [...models].flatMap((model, i) =>
		// Every model against its likely providers plus a rotating sample of all others.
		['anthropic', 'openai', 'opencode', 'cursor-acp', '', providers[i % providers.length], providers[(i * 7) % providers.length]].map((provider) => ({ provider, model }))
	);
}

describe('catalog index', () => {
	it('yields exactly the legacy linear-scan candidates, in order, for a production-shaped catalog', () => {
		const cases = inputs(realistic);
		expect(cases.length).toBeGreaterThan(5_000);
		let mismatches = 0;
		for (const input of cases) {
			const indexed = valuationCandidates(realistic, input);
			const legacy = legacyCandidates(realistic, input);
			// Same entry objects, same kinds, same order.
			if (indexed.length !== legacy.length || indexed.some((c, i) => c.entry !== legacy[i].entry || c.kind !== legacy[i].kind)) {
				mismatches++;
				expect(indexed, JSON.stringify(input)).toEqual(legacy);
			}
		}
		expect(mismatches).toBe(0);
	}, 120_000);

	it('matches the oracle on synthetic edge cases: empty providers, rank ties, prefixed collisions', () => {
		const entry = (provider: string, model: string, source: CatalogEntry['source'], downloaded: boolean, input: number): CatalogEntry => ({
			provider, model, source, downloaded, revision: 'synthetic', rates: { input, output: input }, tiers: [], tools: {}
		});
		const synthetic = freezeCatalog({
			revision: 'synthetic',
			entries: [
				entry('anthropic', 'anthropic/claude-x', 'modelsdev', false, 1),
				entry('anthropic', 'claude-x', 'modelsdev', false, 2), // rank tie with the prefixed row
				entry('anthropic', 'claude-x', 'litellm', true, 3),
				entry('anthropic', 'anthropic/anthropic/claude-x', 'litellm', false, 4),
				entry('anthropic', 'claude-x', 'override', false, 5),
				entry('', 'claude-x', 'litellm', false, 6),
				entry('', '/claude-x', 'litellm', false, 7),
				entry('openai', 'claude-x', 'modelsdev', true, 8),
				entry('opencode', 'anthropic/claude-x', 'modelsdev', false, 9),
				entry('anthropic', 'claude-opus-5-5', 'litellm', false, 10),
				entry('anthropic', 'claude-opus-5-5', 'litellm', false, 11), // exact duplicate key
				entry('openai', 'claude-opus-5-5', 'litellm', false, 12)
			]
		});
		const models = ['claude-x', 'anthropic/claude-x', 'anthropic/anthropic/claude-x', '/claude-x', 'claude-opus-5-5', 'opus-9', 'claude-opus-9[1m]', ''];
		const providers = ['anthropic', 'openai', 'opencode', 'cursor-acp', '', 'zai', 'bedrock'];
		for (const model of models)
			for (const provider of providers) {
				const input = { provider, model };
				const indexed = valuationCandidates(synthetic, input);
				const legacy = legacyCandidates(synthetic, input);
				expect(indexed.map((c) => [c.kind, c.entry.rates.input]), JSON.stringify(input)).toEqual(legacy.map((c) => [c.kind, c.entry.rates.input]));
				expect(indexed.every((c, i) => c.entry === legacy[i].entry)).toBe(true);
			}
	});

	it('re-values 100k estimated records against the full vendored catalog within budget', () => {
		const models = ['claude-opus-future-9', 'claude-sonnet-future', 'mystery-model', 'claude-opus-5-5', 'gpt-5.6-sol', 'kimi-k3'];
		const providers = ['anthropic', 'anthropic', 'openai', 'anthropic', 'openai', 'opencode'];
		const tokens = { input: 1_000, output: 1_000, cacheCreation: 5_000, cacheRead: 50_000 };
		// A fresh catalog object so the timing includes building its index.
		const catalog = mergeCatalogs('bench', realistic);
		const started = performance.now();
		let priced = 0;
		for (let i = 0; i < 100_000; i++) {
			const v = resolveValuation(catalog, { provider: providers[i % 6], model: models[i % 6], tokens, cacheCreation1h: 2_500 });
			if (v.kind !== 'missing') priced++;
		}
		const elapsed = performance.now() - started;
		expect(priced).toBeGreaterThan(0);
		// The linear scan took minutes for this on spitfire's catalog; the index takes well
		// under a second. The budget is loose enough for a slow CI runner.
		expect(elapsed).toBeLessThan(5_000);
	});
});
