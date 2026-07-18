// Client-bundle safety guard for the whatif math core (mirrors the pricing
// client-safety test). The scenario MATH must stay importable in the browser —
// pricing resolution (cost.ts / modelsdev.ts, both node:url file IO) is injected
// by the server-side engine, never imported by the pure core. These assertions
// read the SOURCE, so the guard runs no server-only code.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function read(rel: string): string {
	return stripComments(readFileSync(join(here, rel), 'utf8'));
}

const PURE_MODULES = ['./types.ts', './aggregate.ts', './scenarios.ts'];

describe('whatif client-bundle safety', () => {
	for (const mod of PURE_MODULES) {
		it(`${mod} imports no Node-only price path (cost.ts / modelsdev.ts / node:*)`, () => {
			const src = read(mod);
			expect(src, `${mod} must not import ./cost or pricing/cost`).not.toMatch(
				/from\s+['"][^'"]*pricing\/cost(?:\.[tj]s)?['"]/
			);
			expect(src, `${mod} must not import modelsdev`).not.toMatch(
				/from\s+['"][^'"]*modelsdev(?:\.[tj]s)?['"]/
			);
			expect(src, `${mod} must not import ./resolve (the node wiring)`).not.toMatch(
				/from\s+['"]\.\/resolve(?:\.[tj]s)?['"]/
			);
			expect(src, `${mod} must not import node:fs`).not.toMatch(/from\s+['"]node:fs['"]/);
			expect(src, `${mod} must not import node:url`).not.toMatch(/from\s+['"]node:url['"]/);
			expect(src, `${mod} must not call fileURLToPath`).not.toContain('fileURLToPath(');
		});
	}
});
