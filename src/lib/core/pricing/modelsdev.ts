// models.dev provider-aware price resolver. Node-only (file IO, like cost.ts).
//
// models.dev/api.json is keyed `provider -> models[id] -> cost { input, output,
// cache_read, cache_write }` in USD PER MILLION TOKENS. This module loads the
// vendored, filtered snapshot and resolves an OpenCode (providerID, modelID)
// pair to the same per-token `PriceEntry` the rest of the pricing code uses.
//
// Resolution order (first hit wins):
//   1. map providerID -> models.dev catalog key, look up modelID exactly
//   2. normalise the id (strip provider prefix, opus-4.6 -> claude-opus-4-6) and retry
//   3. search ALL catalogs by exact then normalised id (canonical vendor
//      catalogs first, aggregator/discount catalogs last)
//   4. family fallback by id pattern (opus/sonnet/haiku) -> anthropic catalog
//   5. unknown -> null (NOT zero) so the caller can flag it honestly.
//
// This module MUST NOT be imported by browser/client code — the client price
// path is pricing-client.ts. Guarded by client-safety.test.ts.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PriceEntry } from './overrides';

interface ModelCost {
	input?: number;
	output?: number;
	cache_read?: number;
	cache_write?: number;
}

interface CatalogModel {
	name?: string;
	cost?: ModelCost;
}

interface Catalog {
	models?: Record<string, CatalogModel>;
}

interface Snapshot {
	_meta?: { source?: string; snapshot_date?: string; note?: string };
	providers: Record<string, Catalog>;
}

let snapshot: Snapshot | null = null;
let snapshotMeta: Snapshot['_meta'] = {};

// The snapshot ships in the package at <root>/static/pricing/ and is also copied
// to <root>/build/client/pricing/ by the adapter-node build. This module is
// imported from several layouts (src tree under vitest, the bundled dist/cli CLI,
// the SvelteKit server build), and the CLI runs from ANY cwd — so resolve by
// walking up from this module's own location, never relying on process.cwd().
const SNAPSHOT_RELS = [
	'static/pricing/modelsdev-prices.json',
	'build/client/pricing/modelsdev-prices.json'
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
	// degrade gracefully: empty catalog, resolver returns null for everything
	snapshot = { providers: {} };
	return snapshot;
}

export function getModelsDevMeta(): { snapshotDate: string | null; source: string | null } {
	loadSnapshot();
	return {
		snapshotDate: snapshotMeta?.snapshot_date ?? null,
		source: snapshotMeta?.source ?? null
	};
}

// providerID -> ordered list of models.dev catalog keys to try. Unmapped
// providerIDs fall through to a cross-catalog search (see resolveUncached).
const PROVIDER_CATALOGS: Record<string, string[]> = {
	'cursor-acp': ['anthropic'],
	'zai-anthropic': ['zai', 'anthropic'],
	openai: ['openai'],
	anthropic: ['anthropic'],
	opencode: ['opencode'],
	'opencode-go': ['opencode-go'],
	google: ['google']
};

// Catalog order for the cross-catalog fallback (step 3). Canonical vendor
// catalogs (list price) come first; aggregator/discount catalogs (opencode Zen,
// zai) come last, so a duplicate id resolves to the canonical list price rather
// than a discounted rate. Any catalog not named here is searched afterwards.
const CROSS_CATALOG_ORDER = [
	'anthropic',
	'openai',
	'google',
	'opencode',
	'opencode-go',
	'zai'
] as const;

const priceCache = new Map<string, PriceEntry | null>();

/**
 * Resolve an OpenCode (providerID, modelID) pair to a complete per-token price
 * entry, or null if unknown. Never throws.
 */
export function resolveModelsDevPrice(providerID: string, modelID: string): PriceEntry | null {
	const cacheKey = `${providerID} ${modelID}`;
	if (priceCache.has(cacheKey)) return priceCache.get(cacheKey) ?? null;

	const resolved = resolveUncached(providerID, modelID);
	priceCache.set(cacheKey, resolved);
	return resolved;
}

// per-million USD -> per-token. cache_write maps to cache_creation; absent -> 0.
// Require at least input+output present to count as a usable entry (mirror cost.ts).
function asEntry(cost: ModelCost | undefined): PriceEntry | null {
	if (!cost) return null;
	// Presence check (`== null`), NOT a positivity guard (`> 0`), ON PURPOSE: the
	// snapshot's genuinely-free models (the "*-free" ids with input:0/output:0)
	// must resolve to a real $0 PriceEntry, not null. Returning null would wrongly
	// flag a free model as "unknown price" (cost honesty cuts both ways).
	if (cost.input == null || cost.output == null) return null;
	return {
		input_cost_per_token: cost.input / 1e6,
		output_cost_per_token: cost.output / 1e6,
		cache_creation_input_token_cost: (cost.cache_write ?? 0) / 1e6,
		cache_creation_input_token_cost_above_1hr: undefined, // models.dev has no 1h rate
		cache_read_input_token_cost: (cost.cache_read ?? 0) / 1e6
	};
}

// Normalise a model id: strip a leading provider prefix (e.g. "anthropic/")
// and rewrite a few Anthropic id shapes to the canonical
// "claude-<family>-<version-with-dashes>" form (e.g. "claude-opus-4-6"):
//   - bare      "opus-4.6"      -> "claude-opus-4-6"
//   - version-first "claude-4.5-sonnet" -> "claude-sonnet-4-5"
// Returns null if unchanged. Exported for direct unit testing — the family
// fallback would otherwise mask a normalization regression for same-family ids.
export function normalizeModelID(modelID: string): string | null {
	let id = modelID;
	const slash = id.lastIndexOf('/');
	if (slash !== -1) id = id.slice(slash + 1);

	// "opus-4.6" / "sonnet-4.5" / "haiku-4.5" -> "claude-opus-4-6" etc.
	const family = id.match(/^(opus|sonnet|haiku)-(\d+(?:\.\d+)*)$/i);
	if (family) {
		id = `claude-${family[1].toLowerCase()}-${family[2].replace(/\./g, '-')}`;
	}

	// "claude-4.5-sonnet" (version BEFORE family) -> "claude-sonnet-4-5".
	const versionFirst = id.match(/^claude-(\d+(?:[.-]\d+)*)-(opus|sonnet|haiku)$/i);
	if (versionFirst) {
		id = `claude-${versionFirst[2].toLowerCase()}-${versionFirst[1].replace(/\./g, '-')}`;
	}

	return id !== modelID ? id : null;
}

function lookupIn(catalogKey: string, modelID: string): PriceEntry | null {
	const snap = loadSnapshot();
	const catalog = snap.providers[catalogKey];
	if (!catalog?.models) return null;
	return asEntry(catalog.models[modelID]?.cost);
}

function resolveUncached(providerID: string, modelID: string): PriceEntry | null {
	const mapped = PROVIDER_CATALOGS[providerID] ?? [];
	const normalized = normalizeModelID(modelID);

	// 1. mapped catalog(s), exact id
	for (const key of mapped) {
		const e = lookupIn(key, modelID);
		if (e) return e;
	}
	// 2. mapped catalog(s), normalised id
	if (normalized) {
		for (const key of mapped) {
			const e = lookupIn(key, normalized);
			if (e) return e;
		}
	}

	// 3. search ALL catalogs by exact then normalised id. CANONICAL vendor
	// catalogs (list price) are tried BEFORE aggregator/discount catalogs, so an
	// id present in several catalogs (e.g. "gpt-5" in both openai and the opencode
	// Zen catalog) resolves to the canonical list price, not the discounted rate.
	// Exact id is still preferred over normalised within that ordering.
	const snap = loadSnapshot();
	const seen = new Set<string>(CROSS_CATALOG_ORDER);
	const searchOrder = [
		...CROSS_CATALOG_ORDER,
		...Object.keys(snap.providers).filter((k) => !seen.has(k))
	];
	for (const key of searchOrder) {
		const e = lookupIn(key, modelID);
		if (e) return e;
	}
	if (normalized) {
		for (const key of searchOrder) {
			const e = lookupIn(key, normalized);
			if (e) return e;
		}
	}

	// 4. family fallback by id pattern -> anthropic catalog's representative entry.
	// Prefer an EXPLICIT representative id per family (mirrors cost.ts) so the rate
	// is deterministic; only if that id is absent do we fall back to the first
	// /family/i match (which is order-dependent on catalog insertion order).
	const anthropic = snap.providers.anthropic?.models ?? {};
	const familyHit = (representative: string, re: RegExp): PriceEntry | null => {
		const explicit = asEntry(anthropic[representative]?.cost);
		if (explicit) return explicit;
		for (const id of Object.keys(anthropic)) {
			if (re.test(id)) {
				const e = asEntry(anthropic[id]?.cost);
				if (e) return e;
			}
		}
		return null;
	};
	if (/opus/i.test(modelID)) {
		const e = familyHit('claude-opus-4-8', /opus/i);
		if (e) return e;
	}
	if (/sonnet/i.test(modelID)) {
		const e = familyHit('claude-sonnet-4-6', /sonnet/i);
		if (e) return e;
	}
	if (/haiku/i.test(modelID)) {
		const e = familyHit('claude-haiku-4-5', /haiku/i);
		if (e) return e;
	}

	// 5. unknown
	return null;
}
