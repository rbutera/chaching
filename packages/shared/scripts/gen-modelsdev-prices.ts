// Refresh the vendored models.dev pricing snapshot.
//
//   pnpm tsx scripts/gen-modelsdev-prices.ts
//
// Fetches models.dev/api.json (OpenCode's own pricing backend), filters it to the
// provider catalogs chaching prices through OpenCode (Zen/Go/Cursor-ACP), keeps each
// model's `cost` block, and writes static/pricing/modelsdev-prices.json with a `_meta`
// stamp — mirroring the vendored LiteLLM snapshot. Rates are per MILLION tokens; the
// runtime resolver converts to per-token.
//
// Network note: in a sandbox without egress, fetch on a networked host and pipe in via
//   ssh <host> 'curl -s https://models.dev/api.json' > raw.json
//   MODELSDEV_RAW=raw.json pnpm tsx scripts/gen-modelsdev-prices.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://models.dev/api.json';

// The OpenCode-reachable provider catalogs chaching needs to price. `cursor-acp` and
// `zai-anthropic` are OpenCode-internal providerIDs that map onto these at resolve time.
const WANTED_PROVIDERS = [
	'opencode',
	'opencode-go',
	'openai',
	'anthropic',
	'moonshotai',
	'zai',
	'google'
];

interface ModelsDevModel {
	name?: string;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
}
interface ModelsDevProvider {
	models?: Record<string, ModelsDevModel>;
}

async function loadRaw(): Promise<Record<string, ModelsDevProvider>> {
	const local = process.env.MODELSDEV_RAW;
	if (local) return JSON.parse(readFileSync(local, 'utf8'));
	const res = await fetch(SOURCE);
	if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
	return (await res.json()) as Record<string, ModelsDevProvider>;
}

function today(): string {
	// YYYY-MM-DD (UTC)
	return new Date().toISOString().slice(0, 10);
}

// models.dev drops retired models, but local history still holds their usage. Keep the
// last published price of every model the previous snapshot carried; fresh rows win.
function previousProviders(dest: string): Snapshot {
	try {
		return JSON.parse(readFileSync(dest, 'utf8')).providers ?? {};
	} catch {
		return {};
	}
}

type Snapshot = Record<string, { models: Record<string, ModelsDevModel> }>;

/**
 * Filter models.dev to the wanted providers and keep each model's `cost` block, seeded with
 * the previous snapshot's rows so a model (or a whole provider) models.dev has since dropped
 * keeps its last published price. Fresh rows win.
 */
export function mergeSnapshot(
	raw: Record<string, ModelsDevProvider>,
	previous: Snapshot
): Snapshot {
	const providers: Snapshot = {};
	for (const key of WANTED_PROVIDERS) {
		const models: Record<string, ModelsDevModel> = {
			...(previous[key]?.models ?? {})
		};
		for (const [id, m] of Object.entries(raw[key]?.models ?? {})) {
			if (!m?.cost) continue;
			const c = m.cost;
			models[id] = {
				name: m.name,
				cost: {
					input: c.input ?? undefined,
					output: c.output ?? undefined,
					cache_read: c.cache_read ?? undefined,
					cache_write: c.cache_write ?? undefined
				}
			};
		}
		if (Object.keys(models).length > 0) providers[key] = { models };
	}
	return providers;
}

async function main(): Promise<void> {
	const raw = await loadRaw();
	const root = join(dirname(fileURLToPath(import.meta.url)), '..');
	const dest = join(root, 'src', 'pricing', 'data', 'modelsdev-prices.json');
	const providers = mergeSnapshot(raw, previousProviders(dest));
	const out = { _meta: { source: 'models.dev', snapshot_date: today() }, providers };

	writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');

	const counts = Object.entries(providers)
		.map(([k, v]) => `${k}=${Object.keys(v.models).length}`)
		.join(', ');
	console.log(`[modelsdev] wrote ${dest} (${counts})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
