import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from './config';

// Import the core engine via its relative path only — no SvelteKit $lib alias
// resolution. If this module loaded any framework runtime, this import would fail
// under a plain Node/vitest context.
import { createEngine, runOnce } from './engine';

function disabledConfig(): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		history: { enabled: false, dbPath: '' },
		providers: {
			claude: { enabled: false, roots: [], subscription: { ...DEFAULT_SUBSCRIPTION } },
			codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600 },
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, root: '' }
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
		cfg.providers.claude = { enabled: true, roots: [root], subscription: { ...DEFAULT_SUBSCRIPTION } };

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
		cfg.providers.claude = { enabled: true, roots: [root], subscription: { ...DEFAULT_SUBSCRIPTION } };

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
		cfg.providers.claude = { enabled: true, roots: [root], subscription: { ...DEFAULT_SUBSCRIPTION } };

		const before = activeHandleCount();
		const engine = createEngine(cfg);
		const started = engine.ensureStarted();
		engine.dispose(); // race: dispose before the cold scan resolves
		await started;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(activeHandleCount()).toBeLessThanOrEqual(before);
	});
});

describe('codex liveness — a session written AFTER the cold scan reaches the rollup', () => {
	it('pollLocalProviders() ingests new codex files and fans a delta', async () => {
		const { writeFile } = await import('node:fs/promises');
		const root = await mkdtemp(join(tmpdir(), 'chaching-codex-live-'));
		tmpRoots.push(root);
		await mkdir(join(root, '2026/07/02'), { recursive: true });

		const cfg = disabledConfig();
		cfg.providers.codex = { enabled: true, root, subscription: { ...DEFAULT_SUBSCRIPTION } };

		const engine = createEngine(cfg);
		try {
			await engine.ensureStarted();
			expect(engine.snapshot().dayModel.length).toBe(0); // cold scan saw an empty tree

			// a codex turn lands while the process is running
			const session = [
				JSON.stringify({
					timestamp: '2026-07-02T09:00:00.000Z',
					type: 'turn_context',
					payload: { model: 'gpt-5.5' }
				}),
				JSON.stringify({
					timestamp: '2026-07-02T09:00:01.000Z',
					type: 'event_msg',
					payload: {
						type: 'token_count',
						info: {
							total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 },
							last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 }
						}
					}
				})
			].join('\n');
			await writeFile(join(root, '2026/07/02/rollout-live.jsonl'), session);

			let deltas = 0;
			engine.subscribe(() => deltas++);

			// Drive the poll body directly (the production interval is 15s — white-box
			// call keeps the test instant; the interval wiring is covered by dispose tests).
			await (engine as unknown as { pollLocalProviders(c: typeof cfg): Promise<void> }).pollLocalProviders(cfg);

			const snap = engine.snapshot();
			const codexRows = snap.dayModel.filter((dm) => dm.provider === 'codex');
			expect(codexRows.length).toBe(1);
			expect(codexRows[0].model).toBe('gpt-5.5');
			expect(codexRows[0].day).toBe('2026-07-02');
			expect(deltas).toBe(1);

			// idempotent: a second poll re-reads the same file (inside the margin) but
			// dedup keeps the rollup unchanged and no delta fires.
			await (engine as unknown as { pollLocalProviders(c: typeof cfg): Promise<void> }).pollLocalProviders(cfg);
			expect(engine.snapshot().dayModel.filter((dm) => dm.provider === 'codex').length).toBe(1);
			expect(engine.snapshot().dayModel.filter((dm) => dm.provider === 'codex')[0].requests).toBe(1);
			expect(deltas).toBe(1);
		} finally {
			engine.dispose();
		}
	});
});
