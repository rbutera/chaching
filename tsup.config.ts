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
	// Keep node: builtins external; also keep the PNG renderer deps external so the
	// native @resvg/resvg-js binding is never bundled. They are optionalDependencies,
	// lazily `import()`-ed only on `receipt --png`, and resolved from node_modules at
	// runtime — bundling them would (a) try to load a native .node at build time and
	// (b) force them into the base install. external = stays a runtime require.
	external: [/^node:/, 'satori', '@resvg/resvg-js'],
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
