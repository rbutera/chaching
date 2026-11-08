// Server lifecycle for `chaching serve` (adapter-node).
//
// Boot: warm the ingestion engine immediately rather than on the first request. A
// headless serve that nobody browses must still cold-scan, freeze past days and run the
// sync scheduler; before this it never published to the pool after a restart.
//
// Shutdown: adapter-node's own SIGTERM/SIGINT handler only closes the HTTP server and
// emits `sveltekit:shutdown`; it never exits. The live engine's fs watchers, pollers and
// sync pool sockets then kept the process alive until the supervisor's SIGKILL.

import { building, dev } from '$app/environment';
import type { ServerInit } from '@sveltejs/kit';
import { shutdownService, warmService } from '$lib/server/service';

/** Hard ceiling on a graceful stop: whatever is still pending after this, the process exits. */
const SHUTDOWN_GRACE_MS = 10_000;

export const init: ServerInit = () => {
	if (building) return;
	// Fire and forget: init is awaited before the server listens, so never await the scan.
	warmService();
	// Vite's dev server owns its own signals and has no adapter `sveltekit:shutdown` event.
	if (!dev) installShutdown();
};

let installed = false;

function installShutdown(): void {
	if (installed) return;
	installed = true;
	// Registered now, before any signal, so the adapter's close can't finish unobserved.
	const serverClosed = new Promise<void>((resolve) => process.once('sveltekit:shutdown', () => resolve()));
	const stop = (signal: NodeJS.Signals) => {
		const deadline = setTimeout(() => {
			console.error(`chaching: still shutting down ${SHUTDOWN_GRACE_MS / 1000}s after ${signal}; exiting now.`);
			process.exit(0);
		}, SHUTDOWN_GRACE_MS);
		deadline.unref();
		// The adapter closes the HTTP server on the same signal; we end the SSE feeds (which
		// would otherwise hold that close open) and release the engine, then exit once both
		// are done rather than waiting for every stray handle to drain.
		void Promise.allSettled([shutdownService(), serverClosed]).then(() => process.exit(0));
	};
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
}
