// Cache-cost breakdown — a PRESENTATION reframe over already-aggregated grain.
//
// This module does NOT recompute total burn and does NOT call computeCost. It
// derives, per model, what the cache reads and cache writes were BILLED, and the
// narrative "saved vs uncached" figure, sourcing EVERY rate from resolvePrice so
// it can never drift from the real price table (design D1/D2). The web dashboard
// and the receipt both consume this, so the two surfaces cannot diverge.

import type { DayModelAgg } from '../../types';
import { resolvePrice } from './cost';

/** Billed cache economics for one slice (a provider, or the combined roll-up). */
export interface CacheCostBreakdown {
	/** total cache-read tokens in scope */
	cacheReadTokens: number;
	/** Σ cacheRead × cache_read_input_token_cost (the BILLED read cost) */
	cacheReadCost: number;
	/** total cache-creation (write) tokens in scope */
	cacheWriteTokens: number;
	/** Σ cacheCreation × cache_creation_input_token_cost (the BILLED write cost) */
	cacheWriteCost: number;
	/** narrative delta: what cache reads WOULD have cost at fresh-input rate, minus the read rate */
	savedVsUncached: number;
	/** unknown-price tokens excluded from the cost figures (read+write), for honesty */
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

function addRow(into: CacheCostBreakdown, dm: DayModelAgg): void {
	const read = dm.tokens.cacheRead;
	const write = dm.tokens.cacheCreation;
	into.cacheReadTokens += read;
	into.cacheWriteTokens += write;

	const price = resolvePrice(dm.model);
	if (!price) {
		// Unknown-price model: count the tokens as unknown, contribute NO cost (mirrors how
		// total burn already excludes unknown-price requests — a conservative underestimate).
		into.unknownTokens += read + write;
		return;
	}

	// Billed cache-read cost: cacheRead × the cache-read rate.
	into.cacheReadCost += read * price.cache_read_input_token_cost;
	// Billed cache-write cost: cacheCreation × the 5m / default creation rate. We use the
	// single creation rate here (the grain does not carry the 1h/5m split), matching the
	// dominant pricing; the figure is a faithful presentation of the creation term, not a
	// recompute of total burn.
	into.cacheWriteCost += write * price.cache_creation_input_token_cost;
	// Saved vs uncached: what those reads WOULD have cost at the fresh-input rate, less the
	// read rate actually billed. Always ≥ 0 (read rate < input rate by construction).
	into.savedVsUncached += read * (price.input_cost_per_token - price.cache_read_input_token_cost);
}

/**
 * Derive the per-provider + combined cache-cost breakdown from the (already
 * filtered/scoped) grain. Every rate comes from `resolvePrice`; no hardcoded
 * per-family constants, no call to computeCost, no token re-sum against new rates.
 */
export function cacheCostBreakdown(grain: DayModelAgg[]): CacheCostBreakdownResult {
	const combined = zero();
	const byProvider = new Map<string, CacheCostBreakdown>();
	for (const dm of grain) {
		addRow(combined, dm);
		let p = byProvider.get(dm.provider);
		if (!p) {
			p = zero();
			byProvider.set(dm.provider, p);
		}
		addRow(p, dm);
	}
	return { combined, byProvider };
}
