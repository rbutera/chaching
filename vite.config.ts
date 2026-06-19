import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
