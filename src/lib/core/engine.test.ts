import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { chachingConfig } from './config';

// Import the core engine via its relative path only — no SvelteKit $lib alias
// resolution. If this module loaded any framework runtime, this import would fail
// under a plain Node/vitest context.
import { createEngine, runOnce } from './engine';

function disabledConfig(): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178 },
		history: { enabled: false, dbPath: '' },
		providers: {
			claude: { enabled: false, roots: [] },
			codex: { enabled: false, root: '' },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600 },
			opencode: { enabled: false, dbPath: '' }
		}
	};
}

interface ActiveHandleProcess {
	_getActiveHandles?: () => unknown[];
}

function activeHandleCount(): number {
	const get = (process as unknown as ActiveHandleProcess)._getActiveHandles;
	return typeof get === 'function' ? get.call(process).length : 0;
}

const tmpRoots: string[] = [];

afterEach(async () => {
	while (tmpRoots.length > 0) {
		const dir = tmpRoots.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

describe('core engine (no SvelteKit)', () => {
	it('runOnce resolves a snapshot with the core loaded from a relative path', async () => {
		const snapshot = await runOnce(disabledConfig());
		expect(snapshot).toBeTruthy();
		expect(typeof snapshot.generatedAt).toBe('number');
		expect(Array.isArray(snapshot.dayModel)).toBe(true);
		expect(snapshot.totals).toBeTruthy();
	});

	it('runOnce leaves no open handles even with a provider enabled', async () => {
		// Enable claude against a real temp dir so runOnce exercises the scan path;
		// it must still leave NO watchers/timers (watching is off for the one-shot).
		const root = await mkdtemp(join(tmpdir(), 'chaching-runonce-'));
		tmpRoots.push(root);
		await mkdir(join(root, 'projects'), { recursive: true });
		const cfg = disabledConfig();
		cfg.providers.claude = { enabled: true, roots: [root] };

		const before = activeHandleCount();
		await runOnce(cfg);
		expect(activeHandleCount()).toBeLessThanOrEqual(before);
	});

	it('createEngine starts watchers/timers and dispose() tears them all down', async () => {
		// Point the claude provider at a real temp .claude dir so the engine actually
		// opens an fs.watch on a projects dir and starts the mtime-poll timer; then
		// assert dispose() returns the active-handle count to baseline.
		const root = await mkdtemp(join(tmpdir(), 'chaching-engine-'));
		tmpRoots.push(root);
		await mkdir(join(root, 'projects'), { recursive: true });

		const cfg = disabledConfig();
		cfg.providers.claude = { enabled: true, roots: [root] };

		const before = activeHandleCount();
		const engine = createEngine(cfg);
		await engine.ensureStarted();
		expect(activeHandleCount()).toBeGreaterThan(before);

		engine.dispose();
		// watcher.close() releases its libuv handle asynchronously; give the loop a beat.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(activeHandleCount()).toBeLessThanOrEqual(before);
	});

	it('dispose() during an in-flight start leaves no watchers/timers', async () => {
		const root = await mkdtemp(join(tmpdir(), 'chaching-race-'));
		tmpRoots.push(root);
		await mkdir(join(root, 'projects'), { recursive: true });
		const cfg = disabledConfig();
		cfg.providers.claude = { enabled: true, roots: [root] };

		const before = activeHandleCount();
		const engine = createEngine(cfg);
		const started = engine.ensureStarted();
		engine.dispose(); // race: dispose before the cold scan resolves
		await started;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(activeHandleCount()).toBeLessThanOrEqual(before);
	});
});
