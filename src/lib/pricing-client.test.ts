// Client-safe price resolver — display-only rates for the web cache panel +
// DetailSheet. Covers the Claude classes AND the widened Codex/GPT families, plus
// the unknown → null contract. Rates mirror the server table (overrides.ts /
// the vendored LiteLLM snapshot).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolvePriceClient } from './pricing-client';

describe('resolvePriceClient — Claude families', () => {
	it('prices Opus / Sonnet / Haiku by family pattern', () => {
		expect(resolvePriceClient('claude-opus-4-8')!.input).toBe(5e-6);
		expect(resolvePriceClient('claude-sonnet-4-6')!.input).toBe(3e-6);
		expect(resolvePriceClient('claude-haiku-4-5')!.input).toBe(1e-6);
	});

	it('prices Fable 5 / Mythos 5 ($10/$50 per MTok, cache-write $12.50, read $1)', () => {
		expect(resolvePriceClient('claude-fable-5')).toEqual({
			input: 1e-5,
			output: 5e-5,
			cacheCreation: 1.25e-5,
			cacheRead: 1e-6
		});
		expect(resolvePriceClient('claude-mythos-5')!.input).toBe(1e-5);
	});
});

describe('resolvePriceClient — Codex / GPT families (widened P2)', () => {
	it('prices the gpt-5 family (incl. codex / chat variants)', () => {
		expect(resolvePriceClient('gpt-5')).toMatchObject({ input: 1.25e-6, output: 1e-5 });
		expect(resolvePriceClient('gpt-5-codex')).toMatchObject({ input: 1.25e-6, output: 1e-5 });
		expect(resolvePriceClient('gpt-5.1-codex')).toMatchObject({ input: 1.25e-6 });
		expect(resolvePriceClient('gpt-5.1-codex-max')).toMatchObject({ input: 1.25e-6 });
	});

	it('matches mini/nano BEFORE the bare family', () => {
		expect(resolvePriceClient('gpt-5-mini')).toMatchObject({ input: 2.5e-7 });
		expect(resolvePriceClient('gpt-5-nano')).toMatchObject({ input: 5e-8 });
		expect(resolvePriceClient('gpt-5.1-codex-mini')).toMatchObject({ input: 2.5e-7 });
	});

	it('prices gpt-4.1 / gpt-4o families', () => {
		expect(resolvePriceClient('gpt-4.1')).toMatchObject({ input: 2e-6 });
		expect(resolvePriceClient('gpt-4.1-mini')).toMatchObject({ input: 4e-7 });
		expect(resolvePriceClient('gpt-4o')).toMatchObject({ input: 2.5e-6 });
		expect(resolvePriceClient('gpt-4o-mini')).toMatchObject({ input: 1.5e-7 });
	});

	it('prices the reasoning + codex-mini ids', () => {
		expect(resolvePriceClient('o3')).toMatchObject({ input: 2e-6, cacheRead: 5e-7 });
		expect(resolvePriceClient('o4-mini')).toMatchObject({ input: 1.1e-6 });
		expect(resolvePriceClient('codex-mini-latest')).toMatchObject({ input: 1.5e-6 });
	});

	it('o3-mini matches before bare o3 (distinct cache-read rate)', () => {
		expect(resolvePriceClient('o3-mini')).toMatchObject({ input: 1.1e-6, cacheRead: 5.5e-7 });
	});

	it('OpenAI cacheCreation equals input (no cache-write billing)', () => {
		const p = resolvePriceClient('gpt-5')!;
		expect(p.cacheCreation).toBe(p.input);
	});
});

describe('resolvePriceClient — unknown', () => {
	it('returns null for an unrecognised model', () => {
		expect(resolvePriceClient('totally-unknown-model')).toBeNull();
	});
});

// ── Client-bundle safety: this module must stay Node-free ──────────────────────
describe('pricing-client is browser-safe', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const src = readFileSync(join(here, 'pricing-client.ts'), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');

	it('has no Node imports (node:url / fileURLToPath / cost.ts)', () => {
		expect(src).not.toMatch(/from\s+['"]node:/);
		expect(src).not.toContain('fileURLToPath(');
		expect(src).not.toMatch(/from\s+['"][^'"]*\/cost(?:\.[tj]s)?['"]/);
	});
});
