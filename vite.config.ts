import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// The OG/brand PNG pipeline (src/lib/brand/render.ts) is build-time only and
	// imported solely from scripts/*. @resvg/resvg-js is a native .node binding;
	// keep it external so it can never be pulled into the web client/server bundle.
	ssr: {
		external: ['@resvg/resvg-js'],
		// @number-flow/svelte ships raw `.svelte` files in its dist; if SSR externalises
		// it, Node's ESM loader hits the `.svelte` extension directly and 500s ("Unknown
		// file extension .svelte"). noExternal makes Vite compile it through the Svelte
		// plugin for the SSR build too (dev + adapter-node). It stays a plain runtime
		// dependency — this is bundling, not the external/optional dance satori/resvg need.
		noExternal: ['@number-flow/svelte']
	},
	server: {
		// Bind on all interfaces so `tailscale serve` / phone access works in dev.
		host: true,
		port: 5178
	},
	preview: {
		host: true,
		port: 5178
	}
});
