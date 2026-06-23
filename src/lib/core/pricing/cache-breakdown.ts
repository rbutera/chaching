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

	// Billed cache-read cost: cacheRead × the cache-read rate (exact: computeCost bills
	// reads at this same single rate, so the read figure reconciles with total burn).
	into.cacheReadCost += read * price.cache_read_input_token_cost;
	// Billed cache-write cost: cacheCreation × the BASE (5m / default) creation rate. The
	// grain carries only a combined creation total (no 1h/5m split, design D1), so where a
	// model has a distinct 1h rate AND 1h-cached writes, computeCost bills those at the
	// higher 1h rate and this presentation figure is a slight UNDERSTATEMENT of the write
	// component (it never overstates, and never affects total burn, which stays totals.cost).
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
