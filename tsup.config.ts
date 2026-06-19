import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
	entry: { index: 'src/cli/index.ts' },
	outDir: 'dist/cli',
	format: ['esm'],
	target: 'node24',
	splitting: false,
	sourcemap: false,
	clean: true,
	platform: 'node',
	external: [/^node:/],
	// Ink TUI uses .tsx; compile JSX with the automatic runtime (no `import React`).
	esbuildOptions(options) {
		options.jsx = 'automatic';
		options.jsxImportSource = 'react';
	},
	// Post-build: esbuild strips node: from node:sqlite; restore it.
	async onSuccess() {
		const out = 'dist/cli/index.js';
		let src = readFileSync(out, 'utf8');
		// Rewrite `from "sqlite"` → `from "node:sqlite"` (experimental built-in)
		src = src.replace(/from "sqlite"/g, 'from "node:sqlite"');
		writeFileSync(out, src);
		console.log('[tsup] Restored node:sqlite import in dist/cli/index.js');
	}
});
