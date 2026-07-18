// Server-side price resolution for the Counterfactual Lab. NODE-ONLY: backed by
// cost.ts (LiteLLM snapshot + overrides, via node:url file IO) and modelsdev.ts
// (models.dev snapshot). Mirrors cache-breakdown.ts — the pure math core takes
// this injected, the browser must never import this file.

import { costFromPriceEntry, resolvePrice } from '../pricing/cost';
import { resolveModelsDevPrice } from '../pricing/modelsdev';
import type { PriceEntry } from '../pricing/overrides';
import type { CostFn, PriceResolver } from './types';

/** The single per-token cost formula — re-exported so the engine injects the ONE formula. */
export const defaultCostFn: CostFn = costFromPriceEntry;

/**
 * Resolve an alternate/target model id across catalogs: try cost.ts first
 * (overrides + LiteLLM, the Claude/Codex path), then fall back to the models.dev
 * cross-catalog search for ids only that snapshot carries. Provider is left blank
 * so models.dev searches all catalogs (canonical vendor list price first).
 */
function resolveTargetPrice(model: string): PriceEntry | null {
	return resolvePrice(model) ?? resolveModelsDevPrice('', model);
}

/**
 * The default server resolver: prices each slice by the resolver its provider was
 * ingested through (claude/codex → cost.ts; everything else → models.dev), so a
 * scenario's recomputed baseline matches the real bill.
 */
export const defaultResolver: PriceResolver = {
	source(provider: string, model: string): PriceEntry | null {
		if (provider === 'claude' || provider === 'codex') return resolvePrice(model);
		return resolveModelsDevPrice(provider, model);
	},
	target: resolveTargetPrice
};
