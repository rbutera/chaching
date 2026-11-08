// Singleton ingestion service for the SvelteKit server. One engine per Node process
// (not per request): a thin wrapper around the framework-free core engine that keeps
// a single live instance. The server warms it at boot (hooks.server.ts), so the cold
// scan, watchers and sync scheduler run even when nobody ever opens the dashboard.

import { createEngine, type Engine } from '@chaching/core/engine';

// True module-level singleton (one per Node process / SvelteKit server).
let instance: Engine | null = null;
/** Set once the server has asked for an always-warm engine (see warmService). */
let keepWarm = false;
/** In-flight shutdown, so repeated signals share one. */
let stopping: Promise<void> | null = null;
/** Cleanups for long-lived responses (SSE feeds) that must end before the server can close. */
const shutdownHooks = new Set<() => void>();

export function getService(): Engine {
	if (!instance) {
		const engine = createEngine();
		// If anything disposes the singleton, drop it so the next getService() rebuilds
		// a fresh engine rather than handing back a dead one.
		const dispose = engine.dispose.bind(engine);
		engine.dispose = () => {
			dispose();
			if (instance === engine) instance = null;
		};
		instance = engine;
	}
	return instance;
}

/**
 * Start the engine now instead of on the first request: cold scan, watchers, history
 * freezing and the sync scheduler. Never blocks the caller; a failed start is logged and
 * left for the next request to surface, exactly as a lazy start would have.
 */
export function warmService(): void {
	keepWarm = true;
	if (stopping) return;
	getService()
		.ensureStarted()
		.catch((error: unknown) => {
			console.error(`chaching: background start failed: ${error instanceof Error ? error.message : String(error)}`);
		});
}

/** Drop the live engine after a persistence/config change, then re-warm it if the server keeps one warm. */
export function resetService(): void {
	instance?.dispose();
	if (keepWarm) warmService();
}

/** Register a cleanup to run when the server shuts down. Returns the unregister function. */
export function onServiceShutdown(fn: () => void): () => void {
	shutdownHooks.add(fn);
	return () => shutdownHooks.delete(fn);
}

/**
 * Stop for good: end long-lived responses, then release every engine resource (watchers,
 * pollers, history DB, sync pool). Resolves once the sync pool has closed.
 */
export function shutdownService(): Promise<void> {
	stopping ??= (async () => {
		keepWarm = false;
		for (const fn of [...shutdownHooks]) {
			try {
				fn();
			} catch {
				// a broken stream must not stop the rest of the shutdown
			}
		}
		shutdownHooks.clear();
		const engine = instance;
		instance = null;
		await engine?.shutdown();
	})();
	return stopping;
}
