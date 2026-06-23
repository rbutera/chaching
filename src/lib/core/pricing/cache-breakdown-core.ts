// Pure cache-cost breakdown core — price-agnostic so it is safe to import from
// the BROWSER. It carries NO dependency on `cost.ts` (which uses `node:url`
// `fileURLToPath` to locate the snapshot and therefore must never reach the
// client bundle). Callers inject a rate resolver: the server passes one backed
// by `resolvePrice`, the client passes one backed by `resolvePriceClient`.
//
// This does NOT recompute total burn and does NOT call computeCost. It derives,
// per model, what cache reads and cache writes were BILLED, plus the narrative
// "saved vs uncached" figure, from the injected rates.

import type { DayModelAgg } from '../../types';

/** The three per-token rates the breakdown needs, normalized across resolvers. */
export interface CacheRates {
	/** fresh-input per-token rate */
	input: number;
	/** cache-read per-token rate */
	cacheRead: number;
	/** cache-write (5m / base creation) per-token rate */
	cacheWrite: number;
}

/** Resolve a model id to its cache rates, or null if unknown-price. */
export type ResolveCacheRates = (model: string) => CacheRates | null;

/** Billed cache economics for one slice (a provider, or the combined roll-up). */
export interface CacheCostBreakdown {
	cacheReadTokens: number;
	cacheReadCost: number;
	cacheWriteTokens: number;
	cacheWriteCost: number;
	savedVsUncached: number;
	unknownTokens: number;
}

export interface CacheCostBreakdownResult {
	combined: CacheCostBreakdown;
	byProvider: Map<string, CacheCostBreakdown>;
}

function zero(): CacheCostBreakdown {
	return {
		cacheReadTokens: 0,
		cacheReadCost: 0,
		cacheWriteTokens: 0,
		cacheWriteCost: 0,
		savedVsUncached: 0,
		unknownTokens: 0
	};
}

function addRow(into: CacheCostBreakdown, dm: DayModelAgg, resolve: ResolveCacheRates): void {
	const read = dm.tokens.cacheRead;
	const write = dm.tokens.cacheCreation;
	into.cacheReadTokens += read;
	into.cacheWriteTokens += write;

	const rates = resolve(dm.model);
	if (!rates) {
		// Unknown-price model: count tokens as unknown, contribute NO cost (mirrors how
		// total burn excludes unknown-price requests — a conservative underestimate).
		into.unknownTokens += read + write;
		return;
	}

	into.cacheReadCost += read * rates.cacheRead;
	into.cacheWriteCost += write * rates.cacheWrite;
	into.savedVsUncached += read * (rates.input - rates.cacheRead);
}

/**
 * Derive the per-provider + combined cache-cost breakdown from the (already
 * filtered/scoped) grain, using the injected rate resolver. No hardcoded
 * per-family constants, no call to computeCost.
 */
export function cacheCostBreakdownWith(
	grain: DayModelAgg[],
	resolve: ResolveCacheRates
): CacheCostBreakdownResult {
	const combined = zero();
	const byProvider = new Map<string, CacheCostBreakdown>();
	for (const dm of grain) {
		addRow(combined, dm, resolve);
		let p = byProvider.get(dm.provider);
		if (!p) {
			p = zero();
			byProvider.set(dm.provider, p);
		}
		addRow(p, dm, resolve);
	}
	return { combined, byProvider };
}
