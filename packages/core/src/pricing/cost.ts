import type { TokenCounts } from '@chaching/shared/types';
import type { PriceEntry } from '@chaching/shared/pricing/overrides';
import { bundledCatalog, bundledPricingMeta } from '@chaching/shared/pricing/bundled';
import {
	freezeCatalog,
	inferPricingProvider,
	resolveValuation,
	type BillingInput,
	type PricingCatalog
} from '@chaching/shared/pricing/catalog';
let catalog = bundledCatalog;
export function getPricingCatalog(): PricingCatalog {
	return catalog;
}
export function installPricingCatalog(next: PricingCatalog): void {
	catalog = freezeCatalog(next);
}
export function getPricingMeta() {
	return bundledPricingMeta;
}
export function priceUsage(input: BillingInput) {
	return resolveValuation(catalog, input);
}
export function resolvePrice(model: string): PriceEntry | null {
	const result = priceUsage({
		provider: inferPricingProvider(model),
		model,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
	});
	if (result.kind === 'missing') return null;
	const entry = catalog.entries.find(
		(e) =>
			e.provider === result.provider &&
			e.model === result.model &&
			e.source === result.source
	);
	const tier = entry?.tiers[0];
	return {
		...result.price,
		...(tier && !tier.inclusive && entry?.rates.input && entry.rates.output
			? {
					long_context_threshold_tokens: tier.threshold,
					long_context_input_multiplier:
						(tier.rates.input ?? entry.rates.input) / entry.rates.input,
					long_context_output_multiplier:
						(tier.rates.output ?? entry.rates.output) / entry.rates.output
				}
			: {})
	};
}
export function costFromPriceEntry(
	price: PriceEntry,
	tokens: TokenCounts,
	cacheCreation1h = 0,
	cacheCreation5m = 0,
	promptTokens = tokens.input + tokens.cacheRead
): number {
	const longContext =
		price.long_context_threshold_tokens != null &&
		promptTokens > price.long_context_threshold_tokens;
	const inputMultiplier = longContext
		? (price.long_context_input_multiplier ?? 1)
		: 1;
	const outputMultiplier = longContext
		? (price.long_context_output_multiplier ?? 1)
		: 1;
	let cacheCreationCost: number;
	const oneHrRate = price.cache_creation_input_token_cost_above_1hr;
	if (oneHrRate != null && (cacheCreation1h > 0 || cacheCreation5m > 0)) {
		cacheCreationCost =
			cacheCreation1h * oneHrRate +
			cacheCreation5m * price.cache_creation_input_token_cost;
		// any creation tokens not accounted for by the split fall back to the base rate
		const accounted = cacheCreation1h + cacheCreation5m;
		const remainder = tokens.cacheCreation - accounted;
		if (remainder > 0)
			cacheCreationCost += remainder * price.cache_creation_input_token_cost;
	} else {
		cacheCreationCost =
			tokens.cacheCreation * price.cache_creation_input_token_cost;
	}

	const inputCost =
		tokens.input * price.input_cost_per_token +
		cacheCreationCost +
		tokens.cacheRead * price.cache_read_input_token_cost;
	return (
		inputCost * inputMultiplier +
		tokens.output * price.output_cost_per_token * outputMultiplier
	);
}

export function computeCost(
	model: string,
	tokens: TokenCounts,
	cacheCreation1h = 0,
	cacheCreation5m = 0,
	promptTokens = tokens.input + tokens.cacheRead
): number | null {
	return priceUsage({
		provider: inferPricingProvider(model),
		model,
		tokens,
		cacheCreation1h,
		cacheCreation5m,
		promptTokens
	}).cost;
}
export function hasPrice(model: string): boolean {
	return resolvePrice(model) !== null;
}
