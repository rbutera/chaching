import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from './config';
import { createEngine } from './engine';
import { PostgresSyncStore } from './sync/store';

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('engine PostgreSQL sync mode', () => {
	it('loads peer records and bypasses the configured SQLite history path', async () => {
		const poolId = randomUUID();
		const nimbus = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		let liveEngine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({
				poolId,
				poolName: 'engine integration',
				machineId: nimbus,
				machineName: 'nimbus',
				hostname: 'nimbus'
			});
			await store.joinPool({
				poolId,
				machineId: kinto,
				machineName: 'kinto',
				hostname: 'kinto'
			});
			await store.setIdentity(poolId, nimbus);
			await store.insertRecords([
				{
					key: 'peer-record',
					provider: 'codex',
					timestamp: Date.parse('2026-07-16T10:00:00Z'),
					day: '2026-07-16',
					model: 'gpt-5.6-sol',
					tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 40 },
					cacheCreation1h: 0,
					cacheCreation5m: 0,
					webSearchRequests: 0,
					webFetchRequests: 0,
					sessionId: 'peer-session',
					project: '/nimbus/project',
					isSidechain: false,
					cost: 1.23,
					machineId: nimbus,
					subscriptionId: null
				}
			]);

			const cfg: chachingConfig = {
				cutoverTs: null,
				server: { host: '127.0.0.1', port: 5178, origin: '' },
				history: { enabled: true, dbPath: '/definitely/not/used/history.db' },
				sync: {
					enabled: true,
					databaseUrl: databaseUrl!,
					poolId,
					machineId: kinto,
					machineName: 'kinto',
					providerSubscriptions: {}
				},
				providers: {
					claude: { enabled: false, roots: [], subscription: { ...DEFAULT_SUBSCRIPTION } },
					codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
					cursor: {
						enabled: false,
						adminApiToken: '',
						email: null,
						pollSeconds: 3600
					},
					opencode: { enabled: false, dbPath: '' },
					pi: { enabled: false, root: '' }
				}
			};

			const engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
			liveEngine = engine;
			await engine.ensureStarted();
			const snap = engine.snapshot();
			expect(snap.dayModel).toHaveLength(1);
			expect(snap.dayModel[0]).toMatchObject({
				machineId: nimbus,
				provider: 'codex',
				model: 'gpt-5.6-sol',
				cost: 1.23
			});
			expect(snap.coverage['2026-07-16']).toBe('frozen');
			expect(snap.sessions[0]?.machineId).toBe(nimbus);
			expect(snap.stats.recordsCounted).toBe(1);

			const subscriptionId = randomUUID();
			await store.addSubscription({
				id: subscriptionId,
				provider: 'codex',
				name: 'Shared Codex',
				account: 'shared@example.com',
				tier: 'pro',
				monthlyUsd: 200
			});
			let replacementSeen = false;
			const unsubscribe = engine.subscribe((delta) => {
				replacementSeen ||= Boolean(delta.replace);
			});
			await store.mapSubscription(nimbus, 'codex', subscriptionId);
			await (
				engine as unknown as { pollSync: (config: chachingConfig) => Promise<void> }
			).pollSync(cfg);
			expect(engine.snapshot().dayModel[0]?.subscriptionId).toBe(subscriptionId);
			expect(replacementSeen).toBe(true);
			unsubscribe();
			engine.dispose();
			liveEngine = null;
		} finally {
			liveEngine?.dispose();
			await store.close();
		}
	});
});
