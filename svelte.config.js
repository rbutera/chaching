import adapter from '@sveltejs/adapter-node';
import { normalizeBasePath } from './src/lib/core/base-path.js';

// Base path (subpath) is baked in at BUILD time — SvelteKit has no runtime base.
// Serve chaching under a subpath by building with CHACHING_BASE_PATH set, e.g.
//   CHACHING_BASE_PATH=/chaching pnpm build
// The runtime public origin is separate and IS configurable at runtime via the
// adapter-node ORIGIN env var (or the `server.origin` config field).
const base = normalizeBasePath(process.env.CHACHING_BASE_PATH);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-node bundles everything NOT in package.json `dependencies` and
		// externalizes what IS. @resvg/resvg-js (a native .node binding rollup can't
		// parse) + satori are listed in `dependencies` so the /api/receipt.png route's
		// lazy render import resolves at runtime instead of being bundled. They remain
		// `optionalDependencies` too, so a CLI-only install can still skip the native
		// renderer.
		adapter: adapter(),
		// Subpath mount (e.g. behind a reverse proxy at /chaching). Empty = root.
		// Build-time only; see CHACHING_BASE_PATH above.
		paths: { base }
	}
};

export default config;
