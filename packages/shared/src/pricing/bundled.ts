import litellm from './data/litellm-prices.json';
import modelsdev from './data/modelsdev-prices.json';
import { mergeCatalogs, normalizeCatalog, overrideCatalog } from './catalog';
export const bundledCatalog = mergeCatalogs(
	'bundled-v2',
	normalizeCatalog('litellm', litellm, 'bundled-litellm'),
	normalizeCatalog('modelsdev', modelsdev, 'bundled-modelsdev'),
	overrideCatalog()
);
export const bundledPricingMeta = {
	snapshotDate: litellm._meta.snapshot_date,
	source: litellm._meta.source
};
export const bundledModelsDevMeta = {
	snapshotDate: modelsdev._meta.snapshot_date,
	source: modelsdev._meta.source
};
