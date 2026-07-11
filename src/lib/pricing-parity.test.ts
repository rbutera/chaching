// Pricing parity guard — the client display map (pricing-client.ts) must never
// silently drift from the server truth (overrides.ts + the vendored LiteLLM
// snapshot). This is a TEST file, so it may use Node imports freely; the module
// under test (pricing-client.ts) must stay Node-free — see client-safety.test.ts
// and the "browser-safe" describe block in pricing-client.test.ts.
//
// Regression this guards against: claude-fable-5 was priced correctly server-side
// (overrides.ts) while pricing-client.ts had no fable/mythos branch, so the client
// silently showed "price unknown" for real usage. That's one flavor of drift.
// There's a second, sneakier flavor this file also catches: a client family regex
// that DOES match an id but returns the WRONG (stale) rate for it — worse than
// null because nothing flags it. Both are asserted here, data-driven, so a future
// new/repriced model id fails CI instead of shipping quietly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PRICE_OVERRIDES } from './core/pricing/overrides';
import { resolvePriceClient } from './pricing-client';

interface SnapshotEntry {
	input_cost_per_token: number;
	output_cost_per_token: number;
	cache_creation_input_token_cost?: number;
	cache_read_input_token_cost?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
	readFileSync(join(here, '../../static/pricing/litellm-prices.json'), 'utf8')
) as { prices: Record<string, SnapshotEntry> };

describe('pricing parity — PRICE_OVERRIDES (server) vs resolvePriceClient', () => {
	// Rule: every exact id in the hand-maintained override table must resolve on
	// the client and match input / output / cache_creation (5m) / cache_read
	// exactly. This is literally the rule that would have caught the Fable 5 gap.
	const ids = Object.keys(PRICE_OVERRIDES);
	expect(ids.length).toBeGreaterThan(0); // sanity: fixture isn't empty

	for (const id of ids) {
		it(`${id} matches its override exactly`, () => {
			const entry = PRICE_OVERRIDES[id];
			const client = resolvePriceClient(id);
			expect(client, `resolvePriceClient('${id}') returned null`).not.toBeNull();
			expect(client!.input).toBe(entry.input_cost_per_token);
			expect(client!.output).toBe(entry.output_cost_per_token);
			expect(client!.cacheCreation).toBe(entry.cache_creation_input_token_cost);
			expect(client!.cacheRead).toBe(entry.cache_read_input_token_cost);
		});
	}
});

describe('pricing parity — bare claude-* snapshot keys vs resolvePriceClient', () => {
	// Scoping rule: every snapshot key that starts with "claude-" and carries no
	// provider/region prefix (no "eu.anthropic.", "apac.anthropic.", "us.anthropic.",
	// "au.anthropic.", "jp.anthropic.", "global.anthropic.", "us-gov.anthropic.", no
	// "azure_ai/" — none of those contain a slash or start with "claude-"). These
	// bare ids are what Claude Code itself writes into its usage logs, so they're
	// exactly what the client has to price.
	const bareClaudeKeys = Object.keys(snapshot.prices).filter((k) => k.startsWith('claude-'));
	expect(bareClaudeKeys.length).toBeGreaterThan(10); // sanity: fixture isn't broken/empty

	for (const id of bareClaudeKeys) {
		it(`${id} matches the snapshot`, () => {
			const entry = snapshot.prices[id];
			const client = resolvePriceClient(id);
			expect(client, `resolvePriceClient('${id}') returned null`).not.toBeNull();
			expect(client!.input).toBe(entry.input_cost_per_token);
			expect(client!.output).toBe(entry.output_cost_per_token);
			expect(client!.cacheRead).toBe(entry.cache_read_input_token_cost);
			if (entry.cache_creation_input_token_cost != null) {
				expect(client!.cacheCreation).toBe(entry.cache_creation_input_token_cost);
			}
		});
	}
});

describe('pricing parity — OpenAI/Codex family ids vs resolvePriceClient', () => {
	// Scoping rule: chaching's codex provider only ever ingests ids Codex CLI
	// itself emits for text/coding usage — the gpt-5 family, gpt-4.1 family,
	// gpt-4o family, o3/o3-mini/o4-mini, and codex-mini. It never sees other
	// OpenAI products (audio/realtime/transcribe/tts/image/search/deep-research/
	// pro endpoints — separate billing surfaces, not something a coding CLI
	// reports), and it never sees a dated "-YYYY-MM-DD" pin (Codex CLI reports the
	// live alias, e.g. "gpt-5-codex", not a dated snapshot id). So: take every bare
	// snapshot key in those families, drop the excluded surfaces and dated pins,
	// and require every surviving id to resolve on the client to the exact
	// snapshot rate — this is the rule that would catch e.g. a new gpt-5.x point
	// release shipping at a different price than the existing gpt-5 family regex
	// assumes.
	const FAMILY_PREFIXES = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o3', 'o4-mini', 'codex-mini'];
	const EXCLUDED_SURFACE = /audio|realtime|transcribe|tts|image|search|deep-research|-pro(-|$)/;
	const DATED_PIN = /-\d{4}-\d{2}-\d{2}$/;

	const candidates = Object.keys(snapshot.prices).filter(
		(k) =>
			!k.includes('/') &&
			FAMILY_PREFIXES.some((p) => k.startsWith(p)) &&
			!EXCLUDED_SURFACE.test(k) &&
			!DATED_PIN.test(k)
	);
	expect(candidates.length).toBeGreaterThan(10); // sanity: fixture isn't broken/empty

	for (const id of candidates) {
		it(`${id} matches the snapshot`, () => {
			const entry = snapshot.prices[id];
			const client = resolvePriceClient(id);
			expect(client, `resolvePriceClient('${id}') returned null`).not.toBeNull();
			expect(client!.input).toBe(entry.input_cost_per_token);
			expect(client!.output).toBe(entry.output_cost_per_token);
			if (entry.cache_read_input_token_cost != null) {
				expect(client!.cacheRead).toBe(entry.cache_read_input_token_cost);
			}
			if (entry.cache_creation_input_token_cost != null) {
				expect(client!.cacheCreation).toBe(entry.cache_creation_input_token_cost);
			} else {
				expect(client!.cacheCreation).toBe(client!.input);
			}
		});
	}
});

describe('resolvePriceClient — negative + family-intent cases (review hardening)', () => {
	it('returns null for foreign / unknown model families (never a fabricated rate)', () => {
		for (const id of ['gpt-5.6-mars', 'gemini-2.5-pro', 'grok-4', 'mistral-large-2', 'deepseek-r2', 'llama-4-70b']) {
			expect(resolvePriceClient(id), id).toBeNull();
		}
	});

	it('keeps each exact GPT-5.6 tier distinct from the generic GPT-5 family', () => {
		for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
			expect(resolvePriceClient(id), id).not.toEqual(resolvePriceClient('gpt-5'));
		}
	});

	it('documents family-tier intent for codex variants of the gpt-5 point releases', () => {
		// A -codex suffix rides its generation's tier (same as the server family map).
		expect(resolvePriceClient('gpt-5.5-codex')).toEqual(resolvePriceClient('gpt-5.5'));
		expect(resolvePriceClient('gpt-5.4-codex')).toEqual(resolvePriceClient('gpt-5.4'));
		// KNOWN LIMITATION (latent, no such id ships today): a future generation-specific
		// codex-mini (e.g. gpt-5.4-codex-mini) currently falls through to the base
		// codex-mini tier. The snapshot-iteration suites above fail CI the moment such
		// an id lands in the snapshot with its own rate — revisit the ordering then.
		expect(resolvePriceClient('gpt-5.4-codex-mini')).toEqual(resolvePriceClient('gpt-5-codex-mini'));
	});
});
