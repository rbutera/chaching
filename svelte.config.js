import adapter from '@sveltejs/adapter-node';

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
		adapter: adapter()
	}
};

export default config;
