import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from './config';
import { createEngine } from './engine';
import { Rollup } from './rollup/rollup';
import type { FrozenAgg } from './rollup/rollup';
import type { SessionSummary, UsageRecord } from '../types';
import { PostgresSyncStore, cursorAccountScope, machineScope, type PublishScope } from './sync/store';

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

function baseConfig(poolId: string, machineId: string, over: Partial<chachingConfig['providers']['cursor']> = {}): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		// history OFF so the test isolates the pooled overlay path (local-first history is
		// covered by engine.test.ts B1). The peer overlay is the subject here.
		history: { enabled: false, dbPath: '' },
		sync: {
			enabled: true,
			databaseUrl: databaseUrl!,
			poolId,
			machineId,
			machineName: 'kinto',
			providerSubscriptions: {},
			intervalMinutes: 15
		},
		providers: {
			claude: { enabled: false, roots: [], subscription: { ...DEFAULT_SUBSCRIPTION } },
			codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600, ...over },
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, root: '' }
		}
	};
}

function dayAgg(day: string, over: Partial<FrozenAgg> = {}): FrozenAgg {
	return {
		day,
		provider: 'codex',
		model: 'gpt-5.6-sol',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 40 },
		requests: 1,
		cost: 1.23,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		...over
	};
}

function peerSession(machineIdLabel: string): SessionSummary {
	return {
		sessionId: 'peer-session',
		provider: 'codex',
		project: `/${machineIdLabel}/project`,
		firstTs: Date.parse('2026-07-15T10:00:00Z'),
		lastTs: Date.parse('2026-07-15T11:00:00Z'),
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 40 },
		requests: 1,
		cost: 1.23,
		costUnknownRequests: 0,
		models: ['gpt-5.6-sol']
	};
}

suite('engine PostgreSQL sync mode (v2 aggregate ledger)', () => {
	it('overlays peer aggregates and remaps subscription at read time (replace)', { timeout: 30_000 }, async () => {
		const poolId = randomUUID();
		const nimbus = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		let engine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({ poolId, poolName: 'engine v2', machineId: nimbus, machineName: 'nimbus', hostname: 'nimbus' });
			await store.joinPool({ poolId, machineId: kinto, machineName: 'kinto', hostname: 'kinto' });
			store.setIdentity(poolId, nimbus);
			const nimbusScope: PublishScope = { sourceScope: machineScope(nimbus), machineId: nimbus };
			await store.publishDayAggregates(nimbusScope, [dayAgg('2026-07-15')]);
			await store.publishSessions(nimbusScope, [peerSession('nimbus')]);

			const cfg = baseConfig(poolId, kinto);
			engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
			await engine.ensureStarted();

			const snap = engine.snapshot();
			// Peer row overlaid (kinto has no local data of its own).
			expect(snap.dayModel).toHaveLength(1);
			expect(snap.dayModel[0]).toMatchObject({ machineId: nimbus, provider: 'codex', cost: 1.23 });
			expect(snap.coverage['2026-07-15']).toBe('frozen');
			expect(snap.sessions[0]?.machineId).toBe(nimbus);
			expect(snap.totals.cost).toBeCloseTo(1.23);
			// No subscription mapped yet -> read-time join resolves null.
			expect(snap.dayModel[0].subscriptionId).toBeNull();

			// Map nimbus/codex to a subscription; a burst re-reads mappings and the read-time
			// join stamps it — no re-scan, no re-import.
			const subscriptionId = randomUUID();
			await store.addSubscription({
				id: subscriptionId,
				provider: 'codex',
				name: 'Shared Codex',
				account: 'shared@example.com',
				tier: 'pro',
				monthlyUsd: 200
			});
			await store.mapSubscription(nimbus, 'codex', subscriptionId);

			let replaceSeen = false;
			const unsubscribe = engine.subscribe((delta) => {
				replaceSeen ||= Boolean(delta.replace);
			});
			await (engine as unknown as { runSyncBurst: (c: chachingConfig) => Promise<void> }).runSyncBurst(cfg);
			expect(engine.snapshot().dayModel[0]?.subscriptionId).toBe(subscriptionId);
			expect(replaceSeen).toBe(true);
			unsubscribe();
		} finally {
			engine?.dispose();
			await store.close();
		}
	});

	it('the cursor poller publishes account-scoped spend and renders it once from the overlay', { timeout: 30_000 }, async () => {
		const poolId = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		let engine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({ poolId, poolName: 'cursor once', machineId: kinto, machineName: 'kinto', hostname: 'kinto' });

			// kinto is the cursor poller (email set; adminApiToken empty so no live fetch fires).
			const cfg = baseConfig(poolId, kinto, { enabled: true, email: 'shared@example.com' });
			engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
			await engine.ensureStarted();

			// Simulate a cursor Admin API poll: an account-global record. It must feed ONLY the
			// publish-side cursor rollup, never the local rollup.
			const cursorRecord: UsageRecord = {
				key: 'cursor:cloud-event-1',
				provider: 'cursor',
				timestamp: Date.parse('2026-07-16T10:00:00Z'),
				day: '2026-07-16',
				model: 'claude-opus-4-8',
				tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 },
				cacheCreation1h: 0,
				cacheCreation5m: 0,
				webSearchRequests: 0,
				webFetchRequests: 0,
				sessionId: 'cursor-session',
				project: 'shared@example.com',
				isSidechain: false,
				cost: 0.75,
				machineId: undefined,
				subscriptionId: null
			};
			const internal = engine as unknown as {
				cursorRollup: Rollup | null;
				runSyncBurst: (c: chachingConfig) => Promise<void>;
			};
			expect(internal.cursorRollup).not.toBeNull();
			internal.cursorRollup!.add(cursorRecord);

			// Burst: publishes the account-scoped cursor row and reads it back into the overlay.
			await internal.runSyncBurst(cfg);

			const snap = engine.snapshot();
			const cursorRows = snap.dayModel.filter((dm) => dm.provider === 'cursor' && dm.day === '2026-07-16');
			// Rendered exactly once (from the overlay). The poller did NOT also count it locally.
			expect(cursorRows).toHaveLength(1);
			expect(cursorRows[0].machineId).toBeUndefined();
			expect(cursorRows[0].cost).toBeCloseTo(0.75);
			expect(cursorRows[0].requests).toBe(1);
			expect(snap.totals.cost).toBeCloseTo(0.75);

			// It landed under the account scope, so a peer with a DIFFERENT machine id also sees it.
			const peer = new PostgresSyncStore(databaseUrl!, poolId, randomUUID());
			try {
				const load = await peer.loadAggregates(null);
				const accountRows = load.dayAggregates.filter(
					(d) => d.sourceScope === cursorAccountScope('shared@example.com')
				);
				expect(accountRows).toHaveLength(1);
			} finally {
				await peer.close();
			}
		} finally {
			engine?.dispose();
			await store.close();
		}
	});
});
