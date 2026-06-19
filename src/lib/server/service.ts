// Singleton ingestion service for the SvelteKit server. One engine per Node process
// (not per request): a thin wrapper around the framework-free core engine that keeps
// a single live instance and lazily starts the cold scan + watchers.

import { createEngine, type Engine } from '$lib/core/engine';

// True module-level singleton (one per Node process / SvelteKit server).
let instance: Engine | null = null;

export function getService(): Engine {
	if (!instance) instance = createEngine();
	return instance;
}
