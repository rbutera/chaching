import { bundledModelsDevMeta } from '@chaching/shared/pricing/bundled';
import { priceUsage } from './cost';
export { normalizeModelID } from '@chaching/shared/pricing/catalog';
export function getModelsDevMeta() {
	return bundledModelsDevMeta;
}
export function resolveModelsDevPrice(providerID: string, modelID: string) {
	const result = priceUsage({
		provider: providerID,
		model: modelID,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
	});
	return result.kind === 'missing' ? null : result.price;
}
