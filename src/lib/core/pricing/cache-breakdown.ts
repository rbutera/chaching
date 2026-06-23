// Server/CLI cache-cost breakdown — the authoritative path, backed by the full
// `resolvePrice` table (which uses `node:url` and MUST stay server-side). The
// pure logic lives in `cache-breakdown-core.ts`; this module only injects the
// server rate resolver. Browser code must import the core directly with the
// client-safe resolver (see `pricing-client.ts`), never this file.

import type { DayModelAgg } from '../../types';
import { resolvePrice } from './cost';
import {
	cacheCostBreakdownWith,
	type CacheRates,
	type ResolveCacheRates,
	type CacheCostBreakdownResult
} from './cache-breakdown-core';

export type {
	CacheRates,
	ResolveCacheRates,
	CacheCostBreakdown,
	CacheCostBreakdownResult
} from './cache-breakdown-core';

/** Server resolver: the full vendored/override price table. */
const serverRates: ResolveCacheRates = (model: string): CacheRates | null => {
	const p = resolvePrice(model);
	if (!p) return null;
	return {
		input: p.input_cost_per_token,
		cacheRead: p.cache_read_input_token_cost,
		cacheWrite: p.cache_creation_input_token_cost
	};
};

/** Cache-cost breakdown over scoped grain, using the authoritative server price table. */
export function cacheCostBreakdown(grain: DayModelAgg[]): CacheCostBreakdownResult {
	return cacheCostBreakdownWith(grain, serverRates);
}
