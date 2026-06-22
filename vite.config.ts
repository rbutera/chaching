import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// The OG/brand PNG pipeline (src/lib/brand/render.ts) is build-time only and
	// imported solely from scripts/*. @resvg/resvg-js is a native .node binding;
	// keep it external so it can never be pulled into the web client/server bundle.
	ssr: {
		external: ['@resvg/resvg-js']
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
