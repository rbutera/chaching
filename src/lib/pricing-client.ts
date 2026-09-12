import { bundledCatalog } from './core/pricing/bundled';
import {
	freezeCatalog,
	inferPricingProvider,
	resolveValuation,
	type PricingCatalog
} from './core/pricing/catalog';
export interface ClientPrice {
	input: number;
	output: number;
	cacheCreation: number;
	cacheCreation1h?: number;
	cacheRead: number;
}
let catalog = bundledCatalog;
export function installClientPricingCatalog(next: PricingCatalog): void {
	catalog = freezeCatalog(next);
}
export function resolvePriceClient(
	model: string,
	provider = inferPricingProvider(model)
): ClientPrice | null {
	const result = resolveValuation(catalog, {
		provider,
		model,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
	});
	if (result.kind === 'missing') return null;
	const p = result.price;
	return {
		input: p.input_cost_per_token,
		output: p.output_cost_per_token,
		cacheCreation: p.cache_creation_input_token_cost,
		cacheCreation1h: p.cache_creation_input_token_cost_above_1hr,
		cacheRead: p.cache_read_input_token_cost
	};
}
