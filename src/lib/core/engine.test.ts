import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from './config';

// Import the core engine via its relative path only — no SvelteKit $lib alias
// resolution. If this module loaded any framework runtime, this import would fail
// under a plain Node/vitest context.
import { createEngine, runOnce } from './engine';
import { HistoryStore } from './history/store';
import type { FrozenAgg } from './rollup/rollup';
import type { UsageRecord } from '../types';

function syncConfiguredConfig(databaseUrl = 'postgresql://u:p@127.0.0.1:1/db'): chachingConfig {
	const cfg = disabledConfig();
	cfg.sync = {
		enabled: true,
		databaseUrl,
		poolId: randomUUID(),
		machineId: randomUUID(),
		machineName: 'test-machine',
		providerSubscriptions: {}
	};
	return cfg;
}

function disabledConfig(): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		history: { enabled: false, dbPath: '' },
		sync: {
			enabled: false,
			databaseUrl: '',
			poolId: null,
			machineId: null,
			machineName: '',
			providerSubscriptions: {}
		},
		providers: {
			claude: { enabled: false, roots: [], subscription: { ...DEFAULT_SUBSCRIPTION } },
			codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600 },
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, root: '' }
		}
	};
}

function usage(key: string): UsageRecord {
	return {
		key,
		provider: 'codex',
		timestamp: Date.parse('2026-07-17T08:00:00Z'),
		day: '2026-07-17',
		model: 'gpt-5.6-sol',
		tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: 'session',
		project: 'project',
		isSidechain: false,
		cost: 0.01
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

	it('serializes concurrent sync flushes without dropping records appended in flight', async () => {
		const engine = createEngine(disabledConfig());
		let releaseFirst!: () => void;
		const firstInsert = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const writes: string[][] = [];
		const fakeStore = {
			insertRecords: async (records: readonly UsageRecord[]) => {
				writes.push(records.map((record) => record.key));
				if (writes.length === 1) await firstInsert;
			}
		};
		const internal = engine as unknown as {
			syncStore: typeof fakeStore | null;
			syncQueue: UsageRecord[];
			flushSyncQueue: () => Promise<void>;
		};
		internal.syncStore = fakeStore;
		internal.syncQueue.push(usage('a'));
		const first = internal.flushSyncQueue();
		await vi.waitFor(() => expect(writes).toEqual([['a']]));
		const concurrent = internal.flushSyncQueue();
		internal.syncQueue.push(usage('b'));
		releaseFirst();
		await Promise.all([first, concurrent]);

		expect(writes).toEqual([['a'], ['b']]);
		expect(internal.syncQueue).toEqual([]);
		internal.syncStore = null;
		engine.dispose();
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

describe('B1 — sync configured but unreachable falls back to local frozen history', () => {
	function frozenAgg(day: string): FrozenAgg {
		return {
			day,
			provider: 'claude',
			model: 'claude-opus-4-8',
			tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 },
			requests: 3,
			cost: 1.5,
			costUnknownRequests: 0,
			cacheCreation1h: 0,
			cacheCreation5m: 0,
			webSearchRequests: 0,
			webFetchRequests: 0
		};
	}

	it('seeds the retained SQLite history and blocks new freezes when PG is down', async () => {
		const root = await mkdtemp(join(tmpdir(), 'chaching-b1-'));
		tmpRoots.push(root);

		// A past day already frozen in local SQLite (the copy that must survive PG being down).
		const frozenDay = '2026-07-10';
		const historyPath = join(root, 'history.db');
		const seed = new HistoryStore();
		seed.open(historyPath);
		seed.freezeDays([frozenDay], [frozenAgg(frozenDay)], []);
		seed.close();

		// A different past day that is scanned live (codex) but NOT yet frozen.
		const codexRoot = join(root, 'codex');
		const codexDay = '2026-07-11';
		await mkdir(join(codexRoot, '2026/07/11'), { recursive: true });
		await writeFile(
			join(codexRoot, '2026/07/11/rollout.jsonl'),
			[
				JSON.stringify({
					timestamp: '2026-07-11T09:00:00.000Z',
					type: 'turn_context',
					payload: { model: 'gpt-5.5' }
				}),
				JSON.stringify({
					timestamp: '2026-07-11T09:00:01.000Z',
					type: 'event_msg',
					payload: {
						type: 'token_count',
						info: {
							total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 },
							last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 }
						}
					}
				})
			].join('\n')
		);

		// Sync configured, but the URL points at a refused port so loadSync throws.
		const cfg = syncConfiguredConfig();
		cfg.history = { enabled: true, dbPath: historyPath };
		cfg.providers.codex = { enabled: true, root: codexRoot, subscription: { ...DEFAULT_SUBSCRIPTION } };

		const engine = createEngine(cfg, () => Date.parse('2026-07-17T12:00:00Z'));
		try {
			await engine.ensureStarted();
			const snap = engine.snapshot();

			// FALLBACK: the local frozen day is present. On the old code (no loadHistory in
			// the loadSync catch) this row is absent and this assertion fails.
			const frozenRow = snap.dayModel.find((dm) => dm.day === frozenDay);
			expect(frozenRow).toBeTruthy();
			expect(frozenRow?.cost).toBeCloseTo(1.5);
			expect(snap.coverage[frozenDay]).toBe('frozen');

			// The live codex past-day was still scanned.
			expect(snap.dayModel.some((dm) => dm.day === codexDay && dm.provider === 'codex')).toBe(true);

			// The sync provider error is recorded.
			expect(engine.stats.providerErrors.sync).toBeTruthy();

			// NO NEW FREEZE: the sync error keeps scanIsPartial() true, so the freshly-scanned
			// codex day must NOT have been frozen into SQLite this run.
			const check = new HistoryStore();
			check.openReadOnly(historyPath);
			const frozen = check.frozenDays();
			check.close();
			expect(frozen.has(frozenDay)).toBe(true);
			expect(frozen.has(codexDay)).toBe(false);
		} finally {
			engine.dispose();
		}
	});
});

describe('M5 — pollSync reliability', () => {
	it('does not interleave overlapping ticks (in-flight guard)', async () => {
		const engine = createEngine(disabledConfig());
		const cfg = syncConfiguredConfig();
		let mappedCalls = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fakeStore = {
			mappedSubscriptions: async () => {
				mappedCalls++;
				await gate;
				return {};
			},
			mappingFingerprint: async () => '[]',
			recordsSince: async () => [],
			heartbeat: async () => {}
		};
		const internal = engine as unknown as {
			syncStore: typeof fakeStore | null;
			pollSync: (c: chachingConfig) => Promise<void>;
		};
		internal.syncStore = fakeStore;
		const first = internal.pollSync(cfg);
		const second = internal.pollSync(cfg); // must bail on the in-flight guard
		await vi.waitFor(() => expect(mappedCalls).toBe(1));
		await second; // the second tick returned immediately, it does not wait on the gate
		expect(mappedCalls).toBe(1);
		release();
		await first;
		expect(mappedCalls).toBe(1);
		internal.syncStore = null;
		engine.dispose();
	});

	it('leaves sync status errored after a failed queue drain', async () => {
		const engine = createEngine(disabledConfig());
		const cfg = syncConfiguredConfig();
		const fakeStore = {
			insertRecords: async () => {
				throw new Error('pg unreachable mid-drain');
			},
			mappedSubscriptions: async () => ({}),
			mappingFingerprint: async () => '[]',
			recordsSince: async () => [],
			heartbeat: async () => {}
		};
		const internal = engine as unknown as {
			syncStore: typeof fakeStore | null;
			syncQueue: UsageRecord[];
			pollSync: (c: chachingConfig) => Promise<void>;
		};
		internal.syncStore = fakeStore;
		internal.syncQueue.push(usage('unsent'));
		await internal.pollSync(cfg);
		// The rest of the tick succeeded, but the drain failed: old code called
		// providerStatus.clear('sync') unconditionally and wiped this.
		expect(engine.stats.providerErrors.sync).toBeTruthy();
		// The record stays queued for idempotent retry.
		expect(internal.syncQueue.map((record) => record.key)).toEqual(['unsent']);
		internal.syncStore = null;
		engine.dispose();
	});
});
