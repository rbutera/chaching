// Cost computation. Claude Code stores NO cost field, so cost is always computed
// = Σ (tokens × per-token price), summed over the four billable token classes.
//
// Price resolution order (first hit wins):
//   1. exact id in the hand-maintained override table
//   2. exact id in the vendored LiteLLM snapshot (bare key)
//   3. a normalised LiteLLM key (try anthropic-prefixed / regional variants)
//   4. unknown -> cost is null (NOT zero) so the UI can flag it honestly.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TokenCounts } from '../../types';
import { PRICE_OVERRIDES, type PriceEntry } from './overrides';

interface Snapshot {
	_meta?: { source?: string; snapshot_date?: string; note?: string };
	prices: Record<string, Partial<PriceEntry>>;
}

let snapshot: Snapshot | null = null;
let snapshotMeta: Snapshot['_meta'] = {};

// The snapshot ships in the package at <root>/static/pricing/ and is also copied
// to <root>/build/client/pricing/ by the adapter-node build. This module is
// imported from several layouts (src tree under vitest, the bundled dist/cli CLI,
// the SvelteKit server build), and the CLI runs from ANY cwd — so resolve by
// walking up from this module's own location, never relying on process.cwd().
const SNAPSHOT_RELS = [
	'static/pricing/litellm-prices.json',
	'build/client/pricing/litellm-prices.json'
];

function findSnapshotPath(): string | null {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		for (const rel of SNAPSHOT_RELS) {
			const candidate = join(dir, rel);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// last resort: cwd-relative (covers running straight from the package root)
	for (const rel of SNAPSHOT_RELS) {
		const candidate = join(process.cwd(), rel);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function loadSnapshot(): Snapshot {
	if (snapshot) return snapshot;
	const path = findSnapshotPath();
	if (path) {
		try {
			const parsed = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
			snapshot = parsed;
			snapshotMeta = parsed._meta ?? {};
			return snapshot;
		} catch {
			// fall through to graceful degrade
		}
	}
	// degrade gracefully: overrides still apply
	snapshot = { prices: {} };
	return snapshot;
}

export function getPricingMeta(): { snapshotDate: string | null; source: string | null } {
	loadSnapshot();
	return {
		snapshotDate: snapshotMeta?.snapshot_date ?? null,
		source: snapshotMeta?.source ?? null
	};
}

const priceCache = new Map<string, PriceEntry | null>();

/** Resolve a Claude Code model id to a complete price entry, or null if unknown. */
export function resolvePrice(model: string): PriceEntry | null {
	if (priceCache.has(model)) return priceCache.get(model) ?? null;

	const resolved = resolveUncached(model);
	priceCache.set(model, resolved);
	return resolved;
}

function asEntry(p: Partial<PriceEntry> | undefined): PriceEntry | null {
	if (!p) return null;
	// require at least the two core rates to consider it a usable entry
	if (p.input_cost_per_token == null || p.output_cost_per_token == null) return null;
	return {
		input_cost_per_token: p.input_cost_per_token,
		output_cost_per_token: p.output_cost_per_token,
		cache_creation_input_token_cost: p.cache_creation_input_token_cost ?? 0,
		cache_creation_input_token_cost_above_1hr: p.cache_creation_input_token_cost_above_1hr,
		cache_read_input_token_cost: p.cache_read_input_token_cost ?? 0
	};
}

function resolveUncached(model: string): PriceEntry | null {
	// 1. exact override
	if (PRICE_OVERRIDES[model]) return PRICE_OVERRIDES[model];

	const snap = loadSnapshot();
	// 2. exact bare key in snapshot
	const exact = asEntry(snap.prices[model]);
	if (exact) return exact;

	// 3. normalised lookups: try common provider-prefixed / regional variants.
	const candidates = [
		`anthropic.${model}`,
		`anthropic.${model}-v1:0`,
		`anthropic.${model}-v1`,
		`us.anthropic.${model}`,
		`us.anthropic.${model}-v1:0`,
		`azure_ai/${model}`,
		`claude-${model}` // defensive
	];
	for (const c of candidates) {
		const e = asEntry(snap.prices[c]);
		if (e) return e;
	}

	// 4. family fallback by id pattern -> override family rates (still better than zero)
	if (/opus/i.test(model) && PRICE_OVERRIDES['claude-opus-4-8']) {
		return PRICE_OVERRIDES['claude-opus-4-8'];
	}
	if (/sonnet/i.test(model) && PRICE_OVERRIDES['claude-sonnet-4-6']) {
		return PRICE_OVERRIDES['claude-sonnet-4-6'];
	}
	if (/haiku/i.test(model) && PRICE_OVERRIDES['claude-haiku-4-5']) {
		return PRICE_OVERRIDES['claude-haiku-4-5'];
	}

	return null;
}

/**
 * Compute the USD cost of one usage record. Returns null when the model has no
 * known price (so the caller can count it as unknown rather than silently $0).
 *
 * cache-creation is split into 1h vs 5m where the price entry distinguishes them;
 * otherwise the single cache-creation rate is applied to the whole creation count.
 */
export function computeCost(
	model: string,
	tokens: TokenCounts,
	cacheCreation1h = 0,
	cacheCreation5m = 0
): number | null {
	const price = resolvePrice(model);
	if (!price) return null;

	let cacheCreationCost: number;
	const oneHrRate = price.cache_creation_input_token_cost_above_1hr;
	if (oneHrRate != null && (cacheCreation1h > 0 || cacheCreation5m > 0)) {
		cacheCreationCost =
			cacheCreation1h * oneHrRate + cacheCreation5m * price.cache_creation_input_token_cost;
		// any creation tokens not accounted for by the split fall back to the base rate
		const accounted = cacheCreation1h + cacheCreation5m;
		const remainder = tokens.cacheCreation - accounted;
		if (remainder > 0) cacheCreationCost += remainder * price.cache_creation_input_token_cost;
	} else {
		cacheCreationCost = tokens.cacheCreation * price.cache_creation_input_token_cost;
	}

	return (
		tokens.input * price.input_cost_per_token +
		tokens.output * price.output_cost_per_token +
		cacheCreationCost +
		tokens.cacheRead * price.cache_read_input_token_cost
	);
}

/** True if we have a price for this model. */
export function hasPrice(model: string): boolean {
	return resolvePrice(model) !== null;
}
