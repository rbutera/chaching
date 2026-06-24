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
const WANTED_PROVIDERS = ['opencode', 'opencode-go', 'openai', 'anthropic', 'zai', 'google'];

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

async function main(): Promise<void> {
	const raw = await loadRaw();
	const providers: Record<string, { models: Record<string, ModelsDevModel> }> = {};

	for (const key of WANTED_PROVIDERS) {
		const p = raw[key];
		if (!p) continue;
		const models: Record<string, ModelsDevModel> = {};
		for (const [id, m] of Object.entries(p.models ?? {})) {
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
		providers[key] = { models };
	}

	const out = { _meta: { source: 'models.dev', snapshot_date: today() }, providers };

	const root = join(dirname(fileURLToPath(import.meta.url)), '..');
	const dest = join(root, 'static', 'pricing', 'modelsdev-prices.json');
	writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');

	const counts = Object.entries(providers)
		.map(([k, v]) => `${k}=${Object.keys(v.models).length}`)
		.join(', ');
	console.log(`[modelsdev] wrote ${dest} (${counts})`);
}

void main();
