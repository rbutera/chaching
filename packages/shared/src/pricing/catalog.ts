import type { TokenCounts } from '../types';
import { PRICE_OVERRIDES, type PriceEntry } from './overrides';

export type PricingSource = 'litellm' | 'modelsdev' | 'override';
export interface Rates {
	input?: number;
	output?: number;
	cacheCreation?: number;
	cacheCreation1h?: number;
	cacheRead?: number;
}
export interface PricingTier {
	threshold: number;
	inclusive: boolean;
	rates: Rates;
}
export interface CatalogEntry {
	provider: string;
	model: string;
	source: PricingSource;
	revision: string;
	downloaded: boolean;
	rates: Rates;
	tiers: readonly PricingTier[];
	tools: Readonly<Record<string, number>>;
	unsupported?: boolean;
}
export interface PricingCatalog {
	revision: string;
	entries: readonly CatalogEntry[];
}
export interface BillingInput {
	provider: string;
	model: string;
	tokens: TokenCounts;
	cacheCreation1h?: number;
	cacheCreation5m?: number;
	promptTokens?: number;
	tools?: Record<string, number>;
}
export interface MonetaryComponents {
	cacheReadUncached?: number;
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	tools: number;
}
export type Valuation =
	| {
			kind: 'missing';
			revision: string;
			provider: string;
			model: string;
			cost: null;
	  }
	| {
			kind: 'exact' | 'estimated';
			revision: string;
			provider: string;
			model: string;
			source: PricingSource;
			price: PriceEntry;
			components: MonetaryComponents;
			cost: number;
	  };
function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function rate(value: unknown, divisor = 1): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value / divisor
		: undefined;
}
export function inferPricingProvider(model: string): string {
	const prefix = model.match(/^(anthropic|openai|google|moonshotai)\//)?.[1];
	if (prefix) return prefix;
	if (/^(claude-|opus-|sonnet-|haiku-)/i.test(model)) return 'anthropic';
	if (/^(gpt-|o[134](?:-|$)|codex-)/i.test(model)) return 'openai';
	return '';
}
export function normalizeModelID(model: string): string | null {
	let id = model.replace(/\[1m\]$/, '');
	id = id.replace(/^(anthropic|openai|google|moonshotai)\//, '');
	id = id.replace(
		/^(opus|sonnet|haiku|fable|mythos)-(\d+(?:\.\d+)*)$/i,
		(_, family: string, version: string) =>
			`claude-${family.toLowerCase()}-${version.replace(/\./g, '-')}`
	);
	id = id.replace(
		/^claude-(\d+(?:[.-]\d+)*)-(opus|sonnet|haiku|fable|mythos)$/i,
		(_, version: string, family: string) =>
			`claude-${family.toLowerCase()}-${version.replace(/\./g, '-')}`
	);
	return id === model ? null : id;
}
const aliases: Record<string, string> = {
	'cursor-acp': 'anthropic',
	'openai-codex': 'openai',
	moonshot: 'moonshotai',
	kimi: 'moonshotai'
};
function readRates(
	row: Record<string, unknown>,
	source: PricingSource,
	suffix = ''
): Rates {
	const million = source === 'modelsdev';
	const names = million
		? ['input', 'output', 'cache_write', 'cache_write_1h', 'cache_read']
		: [
				'input_cost_per_token',
				'output_cost_per_token',
				'cache_creation_input_token_cost',
				'cache_creation_input_token_cost_above_1hr',
				'cache_read_input_token_cost'
			];
	return Object.fromEntries(
		[
			'input',
			'output',
			'cacheCreation',
			'cacheCreation1h',
			'cacheRead'
		].flatMap((key, i) => {
			const value = rate(row[names[i] + suffix], million ? 1e6 : 1);
			return value === undefined ? [] : [[key, value]];
		})
	);
}
export function normalizeCatalog(
	source: 'litellm' | 'modelsdev',
	payload: unknown,
	revision: string,
	downloaded = false
): PricingCatalog {
	const entries: CatalogEntry[] = [];
	const root = object(payload);
	function add(provider: string, model: string, row: Record<string, unknown>) {
		if (invalidPrices(row)) return;
		const rates = readRates(row, source);
		if (Object.keys(rates).length === 0) return;
		const tiers: PricingTier[] = [];
		let unsupported = false;
		if (source === 'litellm') {
			const boundaries = new Set(
				Object.keys(row).flatMap((key) => {
					const m = key.match(/_above_(\d+)k_tokens$/);
					return m ? [Number(m[1]) * 1000] : [];
				})
			);
			for (const threshold of boundaries)
				tiers.push({
					threshold,
					inclusive: false,
					rates: {
						...rates,
						...readRates(row, source, `_above_${threshold / 1000}k_tokens`)
					}
				});
			if (row.tiered_pricing !== undefined) {
				if (provider !== 'dashscope' || !Array.isArray(row.tiered_pricing))
					unsupported = true;
				else
					for (const raw of row.tiered_pricing) {
						const tier = object(raw);
						const range = tier.range;
						if (
							!Array.isArray(range) ||
							range.length !== 2 ||
							rate(range[0]) === undefined ||
							rate(range[1]) === undefined ||
							range[1] <= range[0]
						) {
							unsupported = true;
							continue;
						}
						tiers.push({
							threshold: range[0],
							inclusive: false,
							rates: readRates(tier, source)
						});
					}
			}
		} else if (row.tiers !== undefined) {
			if (!Array.isArray(row.tiers)) unsupported = true;
			else
				for (const raw of row.tiers) {
					const tier = object(raw);
					const boundary = object(tier.tier);
					const threshold = rate(boundary.size);
					if (boundary.type !== undefined && boundary.type !== 'context') {
						unsupported = true;
						continue;
					}
					if (threshold === undefined) {
						unsupported = true;
						continue;
					}
					tiers.push({
						threshold,
						inclusive: false,
						rates: { ...rates, ...readRates(tier, source) }
					});
				}
			if (row.context_over_200k !== undefined && !Array.isArray(row.tiers))
				unsupported = true;
		}
		if (
			source === 'modelsdev' &&
			row.context_over_200k !== undefined &&
			!Array.isArray(row.tiers)
		)
			unsupported = true;
		if (
			new Set(tiers.map((t) => t.threshold)).size !== tiers.length ||
			tiers.some((t) => !Number.isInteger(t.threshold))
		)
			unsupported = true;
		if (
			Object.entries(row).some(
				([key, value]) =>
					/cost|input|output|cache/.test(key) &&
					typeof value === 'number' &&
					(!Number.isFinite(value) || value < 0)
			)
		)
			return;
		entries.push({
			provider,
			model,
			source,
			revision,
			downloaded,
			rates,
			tiers: tiers.sort((a, b) => a.threshold - b.threshold),
			tools: toolRates(provider, row),
			unsupported
		});
	}
	if (source === 'modelsdev') {
		for (const [provider, raw] of Object.entries(
			object(root.providers ?? root)
		))
			for (const [model, value] of Object.entries(object(object(raw).models)))
				add(provider, model, object(object(value).cost));
	} else {
		for (const [model, raw] of Object.entries(object(root.prices ?? root))) {
			const row = object(raw);
			let provider =
				typeof row.litellm_provider === 'string'
					? row.litellm_provider
					: inferPricingProvider(model);
			let id = model;
			if (!provider && model.includes('/')) {
				provider = model.split('/')[0];
				id = model.slice(provider.length + 1);
			}
			if (!provider && /^(?:us\.|eu\.|apac\.)?anthropic\./.test(model))
				provider = 'bedrock';
			if (provider) add(provider, id, row);
		}
	}
	if (entries.length === 0)
		throw new Error(`No usable ${source} pricing entries`);
	return freezeCatalog({ revision, entries });
}
export function freezeCatalog(catalog: PricingCatalog): PricingCatalog {
	return Object.freeze({
		revision: catalog.revision,
		entries: Object.freeze(
			catalog.entries.map((entry) =>
				Object.freeze({
					...entry,
					rates: Object.freeze({ ...entry.rates }),
					tiers: Object.freeze(
						entry.tiers.map((tier) =>
							Object.freeze({
								...tier,
								rates: Object.freeze({ ...tier.rates })
							})
						)
					),
					tools: Object.freeze({ ...entry.tools })
				})
			)
		)
	});
}
export function mergeCatalogs(
	revision: string,
	...catalogs: PricingCatalog[]
): PricingCatalog {
	const entries = new Map<string, CatalogEntry>();
	for (const catalog of catalogs)
		for (const entry of catalog.entries) {
			const key = JSON.stringify([
				entry.provider,
				entry.model,
				entry.source,
				entry.downloaded
			]);
			const previous = entries.get(key);
			// Incomplete updates cannot erase dimensions required by previously priced usage.
			if (
				previous &&
				(entry.unsupported ||
					losesRates(previous.rates, entry.rates) ||
					Object.keys(previous.tools).some(
						(key) => entry.tools[key] === undefined
					) ||
					(previous.tiers.length > 0 && entry.tiers.length === 0) ||
					previous.tiers.some((oldTier) =>
						entry.tiers.some((tier) => losesRates(oldTier.rates, tier.rates))
					))
			)
				continue;
			entries.set(key, entry);
		}
	return freezeCatalog({ revision, entries: [...entries.values()] });
}
function losesRates(previous: Rates, next: Rates): boolean {
	return (
		[
			'input',
			'output',
			'cacheCreation',
			'cacheCreation1h',
			'cacheRead'
		] as const
	).some((key) => previous[key] !== undefined && next[key] === undefined);
}
export function overrideCatalog(): PricingCatalog {
	return freezeCatalog({
		revision: 'overrides-v2',
		entries: Object.entries(PRICE_OVERRIDES).map(([model, p]) => ({
			provider: inferPricingProvider(model),
			model,
			source: 'override',
			revision: 'overrides-v2',
			downloaded: false,
			rates: {
				input: p.input_cost_per_token,
				output: p.output_cost_per_token,
				cacheCreation: p.cache_creation_input_token_cost,
				cacheCreation1h: p.cache_creation_input_token_cost_above_1hr,
				cacheRead: p.cache_read_input_token_cost
			},
			tiers:
				p.long_context_threshold_tokens === undefined
					? []
					: [
							{
								threshold: p.long_context_threshold_tokens,
								inclusive: false,
								rates: {
									input:
										p.input_cost_per_token *
										(p.long_context_input_multiplier ?? 1),
									output:
										p.output_cost_per_token *
										(p.long_context_output_multiplier ?? 1),
									cacheCreation:
										p.cache_creation_input_token_cost *
										(p.long_context_input_multiplier ?? 1),
									cacheRead:
										p.cache_read_input_token_cost *
										(p.long_context_input_multiplier ?? 1)
								}
							}
						],
			tools: toolRates(inferPricingProvider(model), {})
		}))
	});
}
export function priceEntry(rates: Rates): PriceEntry {
	return {
		input_cost_per_token: rates.input ?? 0,
		output_cost_per_token: rates.output ?? 0,
		cache_creation_input_token_cost: rates.cacheCreation ?? 0,
		cache_creation_input_token_cost_above_1hr: rates.cacheCreation1h,
		cache_read_input_token_cost: rates.cacheRead ?? 0
	};
}
const families: [RegExp, string][] = [
	[/fable/i, 'claude-fable-5-1'],
	[/mythos/i, 'claude-mythos-5-1'],
	[/opus/i, 'claude-opus-4-8'],
	[/sonnet/i, 'claude-sonnet-4-6'],
	[/haiku/i, 'claude-haiku-4-5']
];
const orderedCatalogs = new WeakMap<PricingCatalog, CatalogEntry[]>();
export function resolveValuation(
	catalog: PricingCatalog,
	input: BillingInput
): Valuation {
	const provider = aliases[input.provider] ?? input.provider;
	const ids = [
		input.model,
		...(normalizeModelID(input.model) ? [normalizeModelID(input.model)!] : [])
	];
	let ordered = orderedCatalogs.get(catalog);
	if (!ordered) {
		ordered = [...catalog.entries].sort((a, b) => rank(a) - rank(b));
		orderedCatalogs.set(catalog, ordered);
	}
	function rank(e: CatalogEntry) {
		return e.source === 'override'
			? 0
			: (e.downloaded ? 1 : 3) + (e.source === 'modelsdev' ? 1 : 0);
	}
	const candidates: { entry: CatalogEntry; kind: 'exact' | 'estimated' }[] = [];
	for (const model of ids)
		for (const entry of ordered)
			if (
				entry.provider === provider &&
				(entry.model === model || entry.model === `${provider}/${model}`)
			)
				candidates.push({ entry, kind: 'exact' });
	for (const p of [
		'anthropic',
		'openai',
		'google',
		'moonshotai',
		'opencode',
		'opencode-go',
		'zai'
	])
		for (const model of ids)
			for (const entry of ordered)
				if (
					entry.provider === p &&
					entry.provider !== provider &&
					entry.model === model
				)
					candidates.push({ entry, kind: 'estimated' });
	const representative = families.find(([pattern]) =>
		pattern.test(input.model)
	)?.[1];
	if (representative)
		for (const entry of ordered)
			if (entry.provider === 'anthropic' && entry.model === representative)
				candidates.push({ entry, kind: 'estimated' });
	for (const { entry, kind } of candidates) {
		if (entry.unsupported) continue;
		const prompt =
			input.promptTokens ?? input.tokens.input + input.tokens.cacheRead;
		let rates = entry.rates;
		for (const tier of entry.tiers)
			if (tier.inclusive ? prompt >= tier.threshold : prompt > tier.threshold) {
				rates = tier.rates;
			}
		const hour = input.cacheCreation1h ?? 0;
		const base = Math.max(0, input.tokens.cacheCreation - hour);
		if (
			(input.tokens.input > 0 && rates.input === undefined) ||
			(input.tokens.output > 0 && rates.output === undefined) ||
			(input.tokens.cacheRead > 0 && rates.cacheRead === undefined) ||
			(base > 0 && rates.cacheCreation === undefined) ||
			(hour > 0 && rates.cacheCreation1h === undefined)
		)
			continue;
		if (
			Object.entries(input.tools ?? {}).some(
				([name, count]) => count > 0 && entry.tools[name] === undefined
			)
		)
			continue;
		const components = {
			cacheReadUncached:
				rates.input === undefined
					? undefined
					: input.tokens.cacheRead * rates.input,
			input: input.tokens.input * (rates.input ?? 0),
			output: input.tokens.output * (rates.output ?? 0),
			cacheCreation:
				base * (rates.cacheCreation ?? 0) + hour * (rates.cacheCreation1h ?? 0),
			cacheRead: input.tokens.cacheRead * (rates.cacheRead ?? 0),
			tools: Object.entries(input.tools ?? {}).reduce(
				(sum, [name, count]) => sum + count * (entry.tools[name] ?? 0),
				0
			)
		};
		return {
			kind,
			revision: catalog.revision,
			provider: entry.provider,
			model: entry.model,
			source: entry.source,
			price: priceEntry(rates),
			components,
			cost:
				components.input +
				components.output +
				components.cacheCreation +
				components.cacheRead +
				components.tools
		};
	}
	return {
		kind: 'missing',
		revision: catalog.revision,
		provider,
		model: input.model,
		cost: null
	};
}

export function validateCatalog(value: unknown): PricingCatalog {
	const root = object(value);
	if (typeof root.revision !== 'string' || !Array.isArray(root.entries))
		throw new Error('Invalid pricing catalog');
	function validRates(value: unknown): value is Rates {
		const row = object(value);
		return (
			value !== null &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.values(row).some((n) => rate(n) !== undefined) &&
			Object.entries(row).every(
				([key, n]) =>
					[
						'input',
						'output',
						'cacheCreation',
						'cacheCreation1h',
						'cacheRead'
					].includes(key) &&
					(n === undefined || rate(n) !== undefined)
			)
		);
	}
	const entries: CatalogEntry[] = [];
	for (const raw of root.entries) {
		const e = object(raw);
		if (
			typeof e.provider !== 'string' ||
			typeof e.model !== 'string' ||
			!['litellm', 'modelsdev', 'override'].includes(String(e.source)) ||
			typeof e.revision !== 'string' ||
			typeof e.downloaded !== 'boolean' ||
			!validRates(e.rates) ||
			!Array.isArray(e.tiers) ||
			(e.unsupported !== undefined && typeof e.unsupported !== 'boolean')
		)
			throw new Error('Invalid pricing entry');
		const tiers: PricingTier[] = [];
		for (const rawTier of e.tiers) {
			const t = object(rawTier);
			if (
				typeof t.threshold !== 'number' ||
				rate(t.threshold) === undefined ||
				typeof t.inclusive !== 'boolean' ||
				!validRates(t.rates)
			)
				throw new Error('Invalid pricing tier');
			tiers.push({
				threshold: t.threshold,
				inclusive: t.inclusive,
				rates: t.rates
			});
		}
		const tools: Record<string, number> = {};
		if (
			e.tools === null ||
			typeof e.tools !== 'object' ||
			Array.isArray(e.tools)
		)
			throw new Error('Invalid tool prices');
		for (const [key, n] of Object.entries(object(e.tools))) {
			if (typeof n !== 'number' || rate(n) === undefined)
				throw new Error('Invalid tool rate');
			tools[key] = n;
		}
		if (
			e.source !== 'litellm' &&
			e.source !== 'modelsdev' &&
			e.source !== 'override'
		)
			throw new Error('Invalid pricing source');
		entries.push({
			provider: e.provider,
			model: e.model,
			source: e.source,
			revision: e.revision,
			downloaded: e.downloaded,
			rates: e.rates,
			tiers,
			tools,
			unsupported: e.unsupported
		});
	}
	return freezeCatalog({ revision: root.revision, entries });
}

function toolRates(
	provider: string,
	row: Record<string, unknown>
): Record<string, number> {
	// Claude API prices: /docs/en/agents-and-tools/tool-use/web-search-tool and web-fetch-tool.
	const tools: Record<string, number> =
		provider === 'anthropic' ? { webSearch: 0.01, webFetch: 0 } : {};
	const search = object(row.search_context_cost_per_query);
	const values = Object.values(search);
	if (
		values.length > 0 &&
		values.every((n) => rate(n) !== undefined && n === values[0]) &&
		typeof values[0] === 'number'
	)
		tools.webSearch = values[0];
	return tools;
}

function invalidPrices(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(invalidPrices);
	if (value === null || typeof value !== 'object') return false;
	return Object.entries(value).some(([key, n]) => {
		if (
			key === 'search_context_cost_per_query' &&
			Object.values(object(n)).some((v) => rate(v) === undefined)
		)
			return true;
		if (
			/cost_per|input_token_cost|^(input|output|cache_read|cache_write|cache_write_1h)$/.test(
				key
			) &&
			n !== null &&
			n !== undefined &&
			typeof n !== 'object'
		)
			return rate(n) === undefined;
		return typeof n === 'object' && invalidPrices(n);
	});
}
