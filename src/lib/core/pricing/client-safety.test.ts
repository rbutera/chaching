// Client-bundle safety guard.
//
// Regression: the client dashboard store once imported `cache-breakdown.ts`,
// which pulls in `cost.ts` (Node `fileURLToPath` / `node:url`). That dragged a
// server-only Node API into the BROWSER bundle, crashing the dashboard on render
// (it looked like a stuck cold-scan). The fix split a pure, price-agnostic
// `cache-breakdown-core.ts` (no `cost.ts`, no `node:url`) with an injected rate
// resolver — the server injects `resolvePrice`, the client injects
// `resolvePriceClient`.
//
// These assertions fail fast if anyone re-introduces the bad import edge. They
// read the SOURCE (not the module graph) so the guard is deterministic and does
// not itself execute any server-only code.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function read(relFromHere: string): string {
	return readFileSync(join(here, relFromHere), 'utf8');
}

// Strip line + block comments so the assertions match real code edges, not the
// prose that legitimately names the very APIs this module is designed to avoid.
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('client-bundle safety', () => {
	it('cache-breakdown-core.ts is pure: no cost.ts import, no node:url / fileURLToPath', () => {
		const core = stripComments(read('./cache-breakdown-core.ts'));
		// Must NOT import the Node-side price table (which uses node:url) — static
		// OR dynamic, with or without a .ts/.js extension.
		expect(core, 'core must not import ./cost').not.toMatch(/from\s+['"]\.\/cost(?:\.[tj]s)?['"]/);
		expect(core, 'core must not dynamic-import ./cost').not.toMatch(
			/import\(\s*['"]\.\/cost(?:\.[tj]s)?['"]\s*\)/
		);
		// Must NOT import any Node-only URL machinery, nor call fileURLToPath.
		expect(core, 'core must not import node:url').not.toMatch(/from\s+['"]node:url['"]/);
		expect(core, 'core must not call fileURLToPath').not.toContain('fileURLToPath(');
	});

	it('client dashboard store imports the pure core, never the server breakdown', () => {
		const dash = read('../../client/dashboard.svelte.ts');
		// Must import from the pure core…
		expect(dash, 'dashboard must import cache-breakdown-core').toMatch(
			/from\s+['"][^'"]*cache-breakdown-core['"]/
		);
		// …and must NOT import the server breakdown module (which imports cost.ts).
		expect(dash, 'dashboard must not import the server cache-breakdown').not.toMatch(
			/from\s+['"][^'"]*\/cache-breakdown['"]/
		);
	});
});
