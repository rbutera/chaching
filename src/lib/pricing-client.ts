// Client-safe price resolver for the cost-math DISPLAY only (the authoritative
// cost is computed server-side and shipped in the snapshot). These mirror the
// override / LiteLLM-snapshot rates so the detail sheet + cache panel can show the
// per-class math without an extra round-trip. If a model is unknown, returns null
// and the UI says so.
//
// CLIENT-SAFE BY CONSTRUCTION: plain constants only, no Node imports (no `node:url`,
// no `fileURLToPath`, no `cost.ts`). The full Node price table (LiteLLM snapshot +
// file resolution) stays out of the browser bundle — see client-safety.test.ts.
//
// Per-token USD. Claude: Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 (cache-write = 5m
// rate). OpenAI/Codex families: rates from the vendored LiteLLM snapshot as of
// 2026-06. OpenAI has no separate cache-WRITE rate (you're not billed to create a
// cache entry), so cacheCreation === input for those — matching the server table,
// where the snapshot carries no cache-creation cost for these ids.

export interface ClientPrice {
	input: number;
	output: number;
	cacheCreation: number; // 5m / base cache-write rate (= input for OpenAI families)
	cacheRead: number;
}

// ── Claude (mirror src/lib/core/pricing/overrides.ts) ───────────────────────────
const OPUS: ClientPrice = { input: 5e-6, output: 2.5e-5, cacheCreation: 6.25e-6, cacheRead: 5e-7 };
const SONNET: ClientPrice = { input: 3e-6, output: 1.5e-5, cacheCreation: 3.75e-6, cacheRead: 3e-7 };
const HAIKU: ClientPrice = { input: 1e-6, output: 5e-6, cacheCreation: 1.25e-6, cacheRead: 1e-7 };

// ── OpenAI / Codex (mirror static/pricing/litellm-prices.json) ──────────────────
// No cache-write billing on OpenAI → cacheCreation = input.
const GPT5: ClientPrice = { input: 1.25e-6, output: 1e-5, cacheCreation: 1.25e-6, cacheRead: 1.25e-7 };
const GPT5_MINI: ClientPrice = { input: 2.5e-7, output: 2e-6, cacheCreation: 2.5e-7, cacheRead: 2.5e-8 };
const GPT5_NANO: ClientPrice = { input: 5e-8, output: 4e-7, cacheCreation: 5e-8, cacheRead: 5e-9 };
const GPT41: ClientPrice = { input: 2e-6, output: 8e-6, cacheCreation: 2e-6, cacheRead: 5e-7 };
const GPT41_MINI: ClientPrice = { input: 4e-7, output: 1.6e-6, cacheCreation: 4e-7, cacheRead: 1e-7 };
const GPT41_NANO: ClientPrice = { input: 1e-7, output: 4e-7, cacheCreation: 1e-7, cacheRead: 2.5e-8 };
const GPT4O: ClientPrice = { input: 2.5e-6, output: 1e-5, cacheCreation: 2.5e-6, cacheRead: 1.25e-6 };
const GPT4O_MINI: ClientPrice = { input: 1.5e-7, output: 6e-7, cacheCreation: 1.5e-7, cacheRead: 7.5e-8 };
const O3: ClientPrice = { input: 2e-6, output: 8e-6, cacheCreation: 2e-6, cacheRead: 5e-7 };
const O4_MINI: ClientPrice = { input: 1.1e-6, output: 4.4e-6, cacheCreation: 1.1e-6, cacheRead: 2.75e-7 };
const CODEX_MINI: ClientPrice = { input: 1.5e-6, output: 6e-6, cacheCreation: 1.5e-6, cacheRead: 3.75e-7 };

/**
 * Resolve a model id to a client-safe price for DISPLAY. Pattern-matched
 * most-specific-first. Unknown ids → null (the UI flags "price unknown").
 */
export function resolvePriceClient(model: string): ClientPrice | null {
	// Claude families
	if (/opus/i.test(model)) return OPUS;
	if (/sonnet/i.test(model)) return SONNET;
	if (/haiku/i.test(model)) return HAIKU;

	// OpenAI / Codex families. Match the mini/nano variants BEFORE the bare family
	// so "gpt-5-mini" doesn't get swallowed by the "gpt-5" rule.
	if (/gpt-5[.\d]*-codex-mini/i.test(model)) return GPT5_MINI;
	if (/gpt-5[.\d]*-nano/i.test(model)) return GPT5_NANO;
	if (/gpt-5[.\d]*-mini/i.test(model)) return GPT5_MINI;
	// gpt-5, gpt-5.1, gpt-5-codex, gpt-5.1-codex(-max), gpt-5-chat, etc.
	if (/gpt-5/i.test(model)) return GPT5;

	if (/gpt-4\.1-nano/i.test(model)) return GPT41_NANO;
	if (/gpt-4\.1-mini/i.test(model)) return GPT41_MINI;
	if (/gpt-4\.1/i.test(model)) return GPT41;
	if (/gpt-4o-mini/i.test(model)) return GPT4O_MINI;
	if (/gpt-4o/i.test(model)) return GPT4O;

	if (/codex-mini/i.test(model)) return CODEX_MINI;
	if (/o4-mini/i.test(model)) return O4_MINI;
	if (/(?:^|[^a-z])o3(?:$|[^a-z])/i.test(model)) return O3;

	return null;
}
