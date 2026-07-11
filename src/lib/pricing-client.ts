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
// Per-token USD. Claude: Fable/Mythos $10/$50, Opus $5/$25, Sonnet $3/$15, Haiku
// $1/$5 (cache-write = 5m rate). OpenAI/Codex families: rates from the vendored
// LiteLLM snapshot. GPT-5.6 bills explicit cache writes at 1.25x input; older
// OpenAI families have no separate cache-write rate, so cacheCreation === input.
//
// Parity with the server maps (overrides.ts + the snapshot) is enforced by
// pricing-parity.test.ts, which iterates both sources so a new/repriced id fails
// CI here instead of silently showing "price unknown" or a stale rate.

export interface ClientPrice {
	input: number;
	output: number;
	cacheCreation: number; // 5m / base cache-write rate (= input for OpenAI families)
	cacheRead: number;
}

// ── Claude (mirror src/lib/core/pricing/overrides.ts + the LiteLLM snapshot) ────
// Fable 5 / Mythos 5 sit above Opus: $10/$50 per MTok, cache-write (5m) $12.50, read $1.
const FABLE: ClientPrice = { input: 1e-5, output: 5e-5, cacheCreation: 1.25e-5, cacheRead: 1e-6 };
const OPUS: ClientPrice = { input: 5e-6, output: 2.5e-5, cacheCreation: 6.25e-6, cacheRead: 5e-7 };
const SONNET: ClientPrice = { input: 3e-6, output: 1.5e-5, cacheCreation: 3.75e-6, cacheRead: 3e-7 };
const SONNET5: ClientPrice = { input: 2e-6, output: 1e-5, cacheCreation: 2.5e-6, cacheRead: 2e-7 };
const HAIKU: ClientPrice = { input: 1e-6, output: 5e-6, cacheCreation: 1.25e-6, cacheRead: 1e-7 };

// Superseded generations that priced differently before a family-wide cut: Opus
// dropped from $15/$75 to $5/$25 at the 4.5 release, Haiku from $0.25/$1.25 (Claude
// 3) to $1/$5 at 4.5. The family regexes below can't distinguish these by name, so
// these exact ids are checked first.
const LEGACY_OPUS: ClientPrice = {
	input: 1.5e-5,
	output: 7.5e-5,
	cacheCreation: 1.875e-5,
	cacheRead: 1.5e-6
};
const LEGACY_HAIKU: ClientPrice = {
	input: 2.5e-7,
	output: 1.25e-6,
	cacheCreation: 3e-7,
	cacheRead: 3e-8
};
const LEGACY_CLAUDE_IDS: Record<string, ClientPrice> = {
	'claude-3-opus-20240229': LEGACY_OPUS,
	'claude-4-opus-20250514': LEGACY_OPUS,
	'claude-opus-4-20250514': LEGACY_OPUS,
	'claude-opus-4-1': LEGACY_OPUS,
	'claude-opus-4-1-20250805': LEGACY_OPUS,
	'claude-3-haiku-20240307': LEGACY_HAIKU
};

// ── OpenAI / Codex (mirror overrides + static/pricing snapshot) ─────────────────
const GPT56: Record<string, ClientPrice> = {
	'gpt-5.6': { input: 5e-6, output: 3e-5, cacheCreation: 6.25e-6, cacheRead: 5e-7 },
	'gpt-5.6-sol': { input: 5e-6, output: 3e-5, cacheCreation: 6.25e-6, cacheRead: 5e-7 },
	'gpt-5.6-terra': { input: 2.5e-6, output: 1.5e-5, cacheCreation: 3.125e-6, cacheRead: 2.5e-7 },
	'gpt-5.6-luna': { input: 1e-6, output: 6e-6, cacheCreation: 1.25e-6, cacheRead: 1e-7 }
};

// Older OpenAI families have no cache-write billing → cacheCreation = input.
const GPT5: ClientPrice = { input: 1.25e-6, output: 1e-5, cacheCreation: 1.25e-6, cacheRead: 1.25e-7 };
const GPT5_MINI: ClientPrice = { input: 2.5e-7, output: 2e-6, cacheCreation: 2.5e-7, cacheRead: 2.5e-8 };
const GPT5_NANO: ClientPrice = { input: 5e-8, output: 4e-7, cacheCreation: 5e-8, cacheRead: 5e-9 };
// gpt-5.2/5.3 and gpt-5.4/5.5 each shipped at their own per-Mtok rate, distinct from
// the base gpt-5/5.1 tier above — the plain /gpt-5/i match below can't tell these
// apart by name, so the newer point releases are matched first.
const GPT5_2: ClientPrice = { input: 1.75e-6, output: 1.4e-5, cacheCreation: 1.75e-6, cacheRead: 1.75e-7 };
const GPT5_4: ClientPrice = { input: 2.5e-6, output: 1.5e-5, cacheCreation: 2.5e-6, cacheRead: 2.5e-7 };
const GPT5_4_MINI: ClientPrice = {
	input: 7.5e-7,
	output: 4.5e-6,
	cacheCreation: 7.5e-7,
	cacheRead: 7.5e-8
};
const GPT5_4_NANO: ClientPrice = {
	input: 2e-7,
	output: 1.25e-6,
	cacheCreation: 2e-7,
	cacheRead: 2e-8
};
const GPT5_5: ClientPrice = { input: 5e-6, output: 3e-5, cacheCreation: 5e-6, cacheRead: 5e-7 };
const GPT41: ClientPrice = { input: 2e-6, output: 8e-6, cacheCreation: 2e-6, cacheRead: 5e-7 };
const GPT41_MINI: ClientPrice = { input: 4e-7, output: 1.6e-6, cacheCreation: 4e-7, cacheRead: 1e-7 };
const GPT41_NANO: ClientPrice = { input: 1e-7, output: 4e-7, cacheCreation: 1e-7, cacheRead: 2.5e-8 };
const GPT4O: ClientPrice = { input: 2.5e-6, output: 1e-5, cacheCreation: 2.5e-6, cacheRead: 1.25e-6 };
const GPT4O_MINI: ClientPrice = { input: 1.5e-7, output: 6e-7, cacheCreation: 1.5e-7, cacheRead: 7.5e-8 };
const O3: ClientPrice = { input: 2e-6, output: 8e-6, cacheCreation: 2e-6, cacheRead: 5e-7 };
const O3_MINI: ClientPrice = { input: 1.1e-6, output: 4.4e-6, cacheCreation: 1.1e-6, cacheRead: 5.5e-7 };
const O4_MINI: ClientPrice = { input: 1.1e-6, output: 4.4e-6, cacheCreation: 1.1e-6, cacheRead: 2.75e-7 };
const CODEX_MINI: ClientPrice = { input: 1.5e-6, output: 6e-6, cacheCreation: 1.5e-6, cacheRead: 3.75e-7 };

/**
 * Resolve a model id to a client-safe price for DISPLAY. Pattern-matched
 * most-specific-first. Unknown ids → null (the UI flags "price unknown").
 */
export function resolvePriceClient(model: string): ClientPrice | null {
	// Superseded Claude generations, checked by exact id before the family
	// regexes (which only key on the family name, not the price-cut generation).
	if (LEGACY_CLAUDE_IDS[model]) return LEGACY_CLAUDE_IDS[model];

	// Claude families. Fable/Mythos first — nothing else matches those names.
	if (/fable|mythos/i.test(model)) return FABLE;
	if (/opus/i.test(model)) return OPUS;
	if (/claude-sonnet-5/i.test(model)) return SONNET5;
	if (/sonnet/i.test(model)) return SONNET;
	if (/haiku/i.test(model)) return HAIKU;

	if (GPT56[model]) return GPT56[model];
	if (model.startsWith('gpt-5.6-')) return null;

	// OpenAI / Codex families. Match the mini/nano variants BEFORE the bare family
	// so "gpt-5-mini" doesn't get swallowed by the "gpt-5" rule.
	// gpt-5.4's mini/nano price differently than the base gpt-5/5.1 mini/nano tier —
	// check those before the generic mini/nano rules below.
	if (/gpt-5\.4[.\d]*-mini/i.test(model)) return GPT5_4_MINI;
	if (/gpt-5\.4[.\d]*-nano/i.test(model)) return GPT5_4_NANO;
	if (/gpt-5[.\d]*-codex-mini/i.test(model)) return GPT5_MINI;
	if (/gpt-5[.\d]*-nano/i.test(model)) return GPT5_NANO;
	if (/gpt-5[.\d]*-mini/i.test(model)) return GPT5_MINI;
	// gpt-5.2/5.3, then 5.4, then 5.5 each price differently from base gpt-5/5.1 —
	// check the point releases before the generic gpt-5 catch-all.
	if (/gpt-5\.5/i.test(model)) return GPT5_5;
	if (/gpt-5\.4/i.test(model)) return GPT5_4;
	if (/gpt-5\.[23]/i.test(model)) return GPT5_2;
	// gpt-5, gpt-5.1, gpt-5-codex, gpt-5.1-codex(-max), gpt-5-chat, etc.
	if (/gpt-5/i.test(model)) return GPT5;

	if (/gpt-4\.1-nano/i.test(model)) return GPT41_NANO;
	if (/gpt-4\.1-mini/i.test(model)) return GPT41_MINI;
	if (/gpt-4\.1/i.test(model)) return GPT41;
	if (/gpt-4o-mini/i.test(model)) return GPT4O_MINI;
	if (/gpt-4o/i.test(model)) return GPT4O;

	if (/codex-mini/i.test(model)) return CODEX_MINI;
	if (/o4-mini/i.test(model)) return O4_MINI;
	// o3-mini before the bare o3 rule (its cache-read rate differs).
	if (/o3-mini/i.test(model)) return O3_MINI;
	if (/(?:^|[^a-z])o3(?:$|[^a-z])/i.test(model)) return O3;

	return null;
}
