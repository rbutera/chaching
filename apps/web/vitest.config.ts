import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
	define: { __CHACHING_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version), __CHACHING_DEV_ASSET_ROOT__: JSON.stringify(new URL('../../packages/receipt/assets', import.meta.url).pathname) },
	// svelteTesting() wires component cleanup + browser-condition resolution so
	// @testing-library/svelte can mount real Svelte 5 components under vitest.
	plugins: [sveltekit(), svelteTesting()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts,tsx}', 'scripts/**/*.{test,spec}.{js,ts,tsx}'],
		// Default node env keeps the (large) pure-function + CLI suite fast; component
		// tests opt into jsdom per-file via `// @vitest-environment jsdom`.
		environment: 'node',
		setupFiles: ['src/test-setup.ts']
	}
});
