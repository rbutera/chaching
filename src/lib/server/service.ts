// Singleton ingestion service for the SvelteKit server. One engine per Node process
// (not per request): a thin wrapper around the framework-free core engine that keeps
// a single live instance and lazily starts the cold scan + watchers.

import { createEngine, type Engine } from '$lib/core/engine';

// True module-level singleton (one per Node process / SvelteKit server).
let instance: Engine | null = null;

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

/** Drop the live engine after a persistence/config change; next request rebuilds it. */
export function resetService(): void {
	instance?.dispose();
}
