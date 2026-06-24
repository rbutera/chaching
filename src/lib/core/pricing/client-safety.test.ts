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

	// The models.dev resolver is node-only (file IO via node:fs / node:url, like
	// cost.ts). The browser price path must stay limited to pricing-client.ts —
	// the resolver and its file-IO imports must never reach the client bundle.
	it('modelsdev.ts is node-only file-IO and the client price path never imports it', () => {
		// Sanity: the resolver really is the node-only kind we must keep out of the client.
		const resolver = stripComments(read('./modelsdev.ts'));
		expect(resolver, 'modelsdev must use node:fs').toMatch(/from\s+['"]node:fs['"]/);
		expect(resolver, 'modelsdev must use node:url').toMatch(/from\s+['"]node:url['"]/);

		// The browser-facing price path is pricing-client.ts — it must NOT import the
		// node resolver (static OR dynamic, with or without a .ts/.js extension).
		const client = stripComments(read('../../pricing-client.ts'));
		expect(client, 'pricing-client must not import modelsdev').not.toMatch(
			/from\s+['"][^'"]*\/modelsdev(?:\.[tj]s)?['"]/
		);
		expect(client, 'pricing-client must not dynamic-import modelsdev').not.toMatch(
			/import\(\s*['"][^'"]*\/modelsdev(?:\.[tj]s)?['"]\s*\)/
		);
		// And it stays node-free itself (no file-IO machinery sneaking in via the resolver).
		expect(client, 'pricing-client must not import node:fs').not.toMatch(/from\s+['"]node:fs['"]/);
		expect(client, 'pricing-client must not import node:url').not.toMatch(
			/from\s+['"]node:url['"]/
		);

		// The client dashboard store must not import the node resolver either
		// (static OR dynamic, with or without a .ts/.js extension).
		const dash = stripComments(read('../../client/dashboard.svelte.ts'));
		expect(dash, 'dashboard must not import modelsdev').not.toMatch(
			/from\s+['"][^'"]*\/modelsdev(?:\.[tj]s)?['"]/
		);
		expect(dash, 'dashboard must not dynamic-import modelsdev').not.toMatch(
			/import\(\s*['"][^'"]*\/modelsdev(?:\.[tj]s)?['"]\s*\)/
		);
	});
});
