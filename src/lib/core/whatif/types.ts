// Counterfactual Lab — shared types. CLIENT-SAFE: this module carries no Node
// imports (only a type-only import of PriceEntry, which is erased at compile
// time), so the web wave can import the ScenarioResult shape into the browser
// bundle. The pricing RESOLUTION that produces the numbers stays server-side
// (see resolve.ts); the math core (scenarios.ts) takes its resolver + cost
// function injected, mirroring the cache-breakdown-core/cache-breakdown split.

import type { PriceEntry } from '../pricing/overrides';
import type { TokenCounts } from '../../types';

/**
 * A window-aggregated usage slice: the token-class sums for one (provider, model)
 * over the selected period. This is the engine's input grain (design decision 1 —
 * scenarios operate on the aggregated slice, not raw records, so the math is
 * identical to the real bill and works for both runOnce() and the live engine).
 */
export interface UsageSlice {
	provider: string;
	model: string;
	/** token-class sums over the window for this (provider, model) */
	tokens: TokenCounts;
	requests: number;
	/** the real bill's computed cost for this slice (sum of dm.cost); 0 when unknown-priced */
	actualCost: number;
	/** how many of `requests` had no known price at ingestion time */
	costUnknownRequests: number;
}

/** The window a set of slices was aggregated over, for explicit labelling. */
export interface UsageWindow {
	from: string;
	to: string;
}

/** The aggregated engine input: slices + the window they cover. */
export interface WhatifInput {
	slices: UsageSlice[];
	window: UsageWindow | null;
}

/**
 * Usage excluded from a scenario because its SOURCE or TARGET price resolved to
 * `null`. Excluded from BOTH sides of the comparison (never one-sided — that
 * would fabricate a delta) and reported here (design decision 5).
 */
export interface ScenarioExclusion {
	/** distinct (provider, model) pairs excluded */
	modelCount: number;
	/** the excluded models as "provider/model", for display */
	models: string[];
	/** the real-bill spend of the excluded slices ($; a source-unknown slice contributes 0) */
	spendUsd: number;
}

/** The kind of counterfactual a result represents. */
export type ScenarioKind = 'alt-model' | 'no-cache' | 'plan-fit';

/**
 * One counterfactual result. ONE shape for every scenario and for both renderers
 * (design decision 6): the CLI ledger and the web region render this array.
 */
export interface ScenarioResult {
	/** stable id, e.g. "alt-model:claude-sonnet-4-6", "no-cache", "plan-fit:claude" */
	id: string;
	kind: ScenarioKind;
	/** human label for the row */
	label: string;
	/** one-line description of the price basis */
	basis: string;
	/** the counterfactual total (USD) over the INCLUDED slices */
	totalUsd: number;
	/** the baseline actual (USD) over the SAME included slices — the delta anchor */
	actualUsd: number;
	/** totalUsd − actualUsd (negative = cheaper than actual) */
	deltaUsd: number;
	/** usage excluded because a source or target price was null */
	exclusions: ScenarioExclusion;
	/** honesty label(s) + substitution notes */
	notes: string[];
}

/**
 * A resolved-price provider, injected into the math core so scenarios.ts stays
 * free of Node imports (the real implementation lives in resolve.ts and is backed
 * by cost.ts + modelsdev.ts). `source` prices a slice by its own (provider, model)
 * exactly as the rollup did; `target` prices an alternate model id across catalogs.
 */
export interface PriceResolver {
	/** the slice's own price, by the resolver its provider was ingested through */
	source(provider: string, model: string): PriceEntry | null;
	/** an alternate/target model id, resolved across catalogs (overrides → snapshot → null) */
	target(model: string): PriceEntry | null;
}

/**
 * The single per-token cost formula, injected. The real implementation is
 * `costFromPriceEntry` from cost.ts — there is exactly ONE formula in the
 * codebase and the engine calls it; scenarios reshape the token classes (folding
 * cache tokens into input for substitutions) but never re-implement the math.
 */
export type CostFn = (
	price: PriceEntry,
	tokens: TokenCounts,
	cacheCreation1h?: number,
	cacheCreation5m?: number,
	promptTokens?: number
) => number;

/** Mandatory honesty label carried on every scenario result (see proposal). */
export const PRICE_ONLY_COUNTERFACTUAL =
	'Price-only counterfactual: real usage repriced under a different basis. It does not model different token counts, output quality, or plan usage limits — a bound, not a promise.';
