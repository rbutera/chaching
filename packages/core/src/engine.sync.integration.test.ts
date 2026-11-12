import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { type chachingConfig } from './config';
import { createEngine } from './engine';
import { Rollup } from './rollup/rollup';
import type { FrozenAgg } from './rollup/rollup';
import type { SessionSummary, UsageRecord } from '@chaching/shared/types';
import { PostgresSyncStore, cursorAccountScope, machineScope, type PublishScope } from './sync/store';

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

function baseConfig(poolId: string, machineId: string, over: Partial<chachingConfig['providers']['cursor']> = {}): chachingConfig {
	return {
		version: 1, accounts: [], providerAccounts: {},
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		// history OFF so the test isolates the pooled overlay path (local-first history is
		// covered by engine.test.ts B1). The peer overlay is the subject here.
		history: { enabled: false, dbPath: '' },
		tokenmaxx: { enabled: false, dbPath: '' },
		sync: {
			enabled: true,
			databaseUrl: databaseUrl!,
			poolId,
			machineId,
			machineName: 'kinto',
			intervalMinutes: 15,
			publishProjects: 'full',
			projectLabel: ''
		},
		providers: {
			claude: { enabled: false, roots: [] },
			codex: { enabled: false, root: '' },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600, ...over },
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, roots: [] }
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

function claudeAssistantLine(msgId: string, day: string, model = 'claude-opus-4-8'): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: `${day}T09:00:00.000Z`,
		requestId: `req_${msgId}`,
		sessionId: 's1',
		isSidechain: false,
		message: {
			id: msgId,
			model,
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				service_tier: 'standard'
			}
		}
	});
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
	it('egress: an idle burst re-sends no session activity, and a restart reads peers only since its cached watermark', { timeout: 60_000 }, async () => {
		const poolId = randomUUID();
		const kinto = randomUUID();
		const nimbus = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		const root = await mkdtemp(join(tmpdir(), 'chaching-egress-'));
		const clock = () => Date.parse('2026-07-17T08:00:00Z');
		let engine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({ poolId, poolName: 'egress', machineId: nimbus, machineName: 'nimbus', hostname: 'nimbus' });
			await store.joinPool({ poolId, machineId: kinto, machineName: 'kinto', hostname: 'kinto' });
			store.setIdentity(poolId, nimbus);
			const nimbusScope: PublishScope = { sourceScope: machineScope(nimbus), machineId: nimbus };
			await store.publishDayAggregates(nimbusScope, [dayAgg('2026-07-15', { cost: 1 })]);
			await store.publishSessions(nimbusScope, [peerSession('nimbus')]);

			const projectsDir = join(root, 'projects', '-x');
			await mkdir(projectsDir, { recursive: true });
			await writeFile(join(projectsDir, 'session.jsonl'), `${claudeAssistantLine('msg_egress', '2026-07-15')}\n`);
			const cfg = baseConfig(poolId, kinto);
			cfg.providers.claude = { enabled: true, roots: [root] };
			cfg.history = { enabled: true, dbPath: join(root, 'history.db') };

			type Internal = {
				syncStore: PostgresSyncStore | null;
				runSyncBurst: (c: chachingConfig) => Promise<void>;
			};
			engine = createEngine(cfg, clock);
			await engine.ensureStarted();
			const first = engine as unknown as Internal;
			expect(first.syncStore).not.toBeNull();
			const activitySpy = vi.spyOn(first.syncStore!, 'publishSessionActivity');
			await first.runSyncBurst(cfg);
			// Nothing changed locally since the connect publish: no activity rows go back out.
			expect(activitySpy).toHaveBeenCalledTimes(1);
			expect(activitySpy.mock.calls[0][1]).toEqual([]);
			expect(engine.snapshot().dayModel.some((dm) => dm.machineId === nimbus && dm.day === '2026-07-15')).toBe(true);
			engine.dispose();
			engine = null;

			// A peer change while we were down, then a restart against the same history DB.
			await store.publishDayAggregates(nimbusScope, [dayAgg('2026-07-16', { cost: 2 })]);
			const since: (string | null)[] = [];
			const original = PostgresSyncStore.prototype.loadAggregates;
			const loadSpy = vi.spyOn(PostgresSyncStore.prototype, 'loadAggregates').mockImplementation(function (this: PostgresSyncStore, s: string | null) {
				since.push(s);
				return original.call(this, s);
			});
			try {
				engine = createEngine(cfg, clock);
				await engine.ensureStarted();
			} finally {
				loadSpy.mockRestore();
			}
			// The restart read incrementally (a watermark, not null = whole pool) ...
			expect(since.length).toBeGreaterThan(0);
			expect(since[0]).not.toBeNull();
			// ... and still shows both the cached peer day and the new one.
			const peerDays = engine.snapshot().dayModel.filter((dm) => dm.machineId === nimbus).map((dm) => dm.day).sort();
			expect(peerDays).toEqual(['2026-07-15', '2026-07-16']);
			expect(engine.snapshot().sessions.some((s) => s.machineId === nimbus)).toBe(true);
		} finally {
			engine?.dispose();
			await store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

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
			expect(snap.dayModel[0].accountId).toBeNull();

			// Map nimbus/codex to a subscription; a burst re-reads mappings and the read-time
			// join stamps it — no re-scan, no re-import.
			const accountId = randomUUID();
			await store.addAccount({
				id: accountId,
				provider: 'codex',
				name: 'Shared Codex',
				account: 'shared@example.com',
				tier: 'pro',
				monthlyUsd: 200
			});
			await store.mapAccount(nimbus, 'codex', accountId);

			let replaceSeen = false;
			const unsubscribe = engine.subscribe((delta) => {
				replaceSeen ||= Boolean(delta.replace);
			});
			await (engine as unknown as { runSyncBurst: (c: chachingConfig) => Promise<void>; }).runSyncBurst(cfg);
			expect(engine.snapshot().dayModel[0]?.accountId).toBe(accountId);
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
				accountId: null
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

	it('C2 — cold-scan + live claude rows for one day publish as a single machine-stamped row', { timeout: 30_000 }, async () => {
		const poolId = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		const root = await mkdtemp(join(tmpdir(), 'chaching-c2-'));
		let engine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({ poolId, poolName: 'c2', machineId: kinto, machineName: 'kinto', hostname: 'kinto' });
			const projectsDir = join(root, 'projects', '-x');
			await mkdir(projectsDir, { recursive: true });
			const sessionFile = join(projectsDir, 'session.jsonl');
			const day = '2026-07-15';
			// Cold-scan row: written BEFORE the engine starts (and so before connectSync).
			await writeFile(sessionFile, `${claudeAssistantLine('msg_cold', day)}\n`);

			const cfg = baseConfig(poolId, kinto);
			cfg.providers.claude = { enabled: true, roots: [root] };
			engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
			await engine.ensureStarted(); // cold scan runs, THEN connectSync sets syncStore

			// A live claude row for the SAME day lands after connect and is tailed.
			await appendFile(sessionFile, `${claudeAssistantLine('msg_live', day)}\n`);
			await (engine as unknown as { tailFile: (f: string) => Promise<void> }).tailFile(sessionFile);

			// Pre-C2 the cold row was un-stamped and the live row stamped → the machineId-keyed
			// rollup split them into TWO rows for the same (day, provider, model). The fix stamps
			// the cold scan too, so they merge into ONE machine-stamped row.
			const claudeRows = engine
				.snapshot()
				.dayModel.filter((dm) => dm.provider === 'claude' && dm.day === day);
			expect(claudeRows).toHaveLength(1);
			expect(claudeRows[0].machineId).toBe(kinto);
			expect(claudeRows[0].requests).toBe(2);

			// Two same-key rows would make the single-statement upsert hit its conflict target
			// twice ("cannot affect row a second time") and fail the burst; one row publishes clean.
			await (engine as unknown as { runSyncBurst: (c: chachingConfig) => Promise<void>; }).runSyncBurst(cfg);
			expect(engine.stats.providerErrors.sync).toBeFalsy();
		} finally {
			engine?.dispose();
			await store.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it('C8 — a peer day published as partial renders as partial coverage, not frozen', { timeout: 30_000 }, async () => {
		const poolId = randomUUID();
		const nimbus = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		let engine: ReturnType<typeof createEngine> | null = null;
		try {
			await store.createPool({ poolId, poolName: 'c8', machineId: nimbus, machineName: 'nimbus', hostname: 'nimbus' });
			await store.joinPool({ poolId, machineId: kinto, machineName: 'kinto', hostname: 'kinto' });
			store.setIdentity(poolId, nimbus);
			const nimbusScope: PublishScope = { sourceScope: machineScope(nimbus), machineId: nimbus };
			// nimbus publishes an INCOMPLETE past day (its own local scan was partial).
			await store.publishDayAggregates(nimbusScope, [{ ...dayAgg('2026-07-15'), partial: true }]);

			const cfg = baseConfig(poolId, kinto);
			engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
			await engine.ensureStarted();

			const snap = engine.snapshot();
			expect(snap.dayModel.some((dm) => dm.day === '2026-07-15')).toBe(true);
			// The undercount must NOT be presented as authoritative.
			expect(snap.coverage['2026-07-15']).toBe('partial');
		} finally {
			engine?.dispose();
			await store.close();
		}
	});
	it('publishes redacted projects, rewrites rows this machine published earlier, and keeps local paths', { timeout: 30_000 }, async () => {
		const poolId = randomUUID();
		const kinto = randomUUID();
		const store = new PostgresSyncStore(databaseUrl!);
		const root = await mkdtemp(join(tmpdir(), 'chaching-privacy-'));
		const engines: ReturnType<typeof createEngine>[] = [];
		const ownRows = async () => {
			const pg = new Pool({ connectionString: databaseUrl });
			try {
				const result = await pg.query(
					`SELECT payload::text AS t FROM chaching_sync.machine_session_agg WHERE pool_id = $1 AND machine_id = $2
					 UNION ALL SELECT payload::text FROM chaching_sync.machine_session_activity WHERE pool_id = $1 AND machine_id = $2`,
					[poolId, kinto]
				);
				return result.rows.map(row => String(row.t)).join('\n');
			} finally { await pg.end(); }
		};
		const start = async (cfg: chachingConfig) => {
			const engine = createEngine(cfg, () => Date.parse('2026-11-08T08:00:00Z'));
			engines.push(engine);
			await engine.ensureStarted();
			return engine;
		};
		try {
			await store.createPool({ poolId, poolName: 'privacy', machineId: kinto, machineName: 'kinto', hostname: 'kinto' });
			const projectsDir = join(root, 'projects', '-home-coder-conveo-reelport');
			await mkdir(projectsDir, { recursive: true });
			await writeFile(join(projectsDir, 'session.jsonl'), `${claudeAssistantLine('msg_1', '2026-11-07')}\n`);
			const cfg = baseConfig(poolId, kinto);
			cfg.providers.claude = { enabled: true, roots: [root] };

			// Before the setting: the machine publishes its full local path.
			(await start(cfg)).dispose();
			expect(await ownRows()).toContain('/home/coder/conveo/reelport');

			// First start with label mode: the old rows are rewritten and nothing new leaks.
			const labelled = { ...cfg, sync: { ...cfg.sync, publishProjects: 'label' as const, projectLabel: 'Conveo' } };
			const engine = await start(labelled);
			expect(engine.stats.providerErrors.sync).toBeFalsy();
			const rows = await ownRows();
			expect(rows).not.toContain('/home/coder');
			expect(rows).toContain('"project": "Conveo"');
			// The local dashboard keeps the real path.
			expect(engine.snapshot().sessions[0]?.project).toBe('/home/coder/conveo/reelport');

			// A policy change seen by a running engine applies on its next burst.
			await (engine as unknown as { runSyncBurst: (c: chachingConfig) => Promise<void> }).runSyncBurst(
				{ ...labelled, sync: { ...labelled.sync, publishProjects: 'basename' } });
			expect(engine.stats.providerErrors.sync).toBeFalsy();
			const basenamed = await ownRows();
			expect(basenamed).toContain('"project": "reelport"');
			expect(basenamed).not.toContain('Conveo');
		} finally {
			for (const engine of engines) engine.dispose();
			await store.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
