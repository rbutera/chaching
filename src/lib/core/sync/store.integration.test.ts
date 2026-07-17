import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { FrozenAgg, HourAgg } from '../rollup/rollup';
import type { SessionSummary } from '../../types';
import { PostgresSyncStore, cursorAccountScope, machineScope, type PublishScope } from './store';

// Integration tests run only when a disposable PostgreSQL is provided. Every test uses a fresh
// random poolId so parallel runs against ONE shared database stay row-isolated (no global DDL).
const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

function dayAgg(day: string, over: Partial<FrozenAgg> = {}): FrozenAgg {
	return {
		day,
		provider: 'codex',
		model: 'gpt-5.6-sol',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 40 },
		requests: 1,
		cost: 0.5,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		...over
	};
}

function hourAgg(hourTs: number, over: Partial<HourAgg> = {}): HourAgg {
	return {
		hourTs,
		provider: 'codex',
		model: 'gpt-5.6-sol',
		tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 0.1,
		costUnknownRequests: 0,
		...over
	};
}

function session(provider: string, sessionId: string): SessionSummary {
	return {
		sessionId,
		provider,
		project: 'project',
		firstTs: Date.parse('2026-07-16T10:00:00Z'),
		lastTs: Date.parse('2026-07-16T11:00:00Z'),
		tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 0.1,
		costUnknownRequests: 0,
		models: ['gpt-5.6-sol']
	};
}

function scopeFor(machineId: string): PublishScope {
	return { sourceScope: machineScope(machineId), machineId };
}

async function pooledPair(): Promise<{
	poolId: string;
	a: string;
	b: string;
	storeA: PostgresSyncStore;
	storeB: PostgresSyncStore;
}> {
	const poolId = randomUUID();
	const a = randomUUID();
	const b = randomUUID();
	const storeA = new PostgresSyncStore(databaseUrl!);
	const storeB = new PostgresSyncStore(databaseUrl!);
	await storeA.createPool({ poolId, poolName: 'agg pool', machineId: a, machineName: 'kinto', hostname: 'kinto' });
	await storeB.joinPool({ poolId, machineId: b, machineName: 'nimbus', hostname: 'nimbus' });
	return { poolId, a, b, storeA, storeB };
}

suite('PostgresSyncStore v2 aggregate ledger', () => {
	it('loads peer machine day aggregates and excludes own rows, incrementally', { timeout: 30_000 }, async () => {
		const { a, b, storeA, storeB } = await pooledPair();
		try {
			await storeA.publishDayAggregates(scopeFor(a), [dayAgg('2026-07-15', { cost: 1 })]);
			await storeB.publishDayAggregates(scopeFor(b), [dayAgg('2026-07-15', { cost: 2 })]);

			const first = await storeA.loadAggregates(null);
			// A sees only B's row (own machine:<a> scope excluded), stamped with B's machineId.
			expect(first.dayAggregates).toHaveLength(1);
			expect(first.dayAggregates[0]).toMatchObject({ machineId: b, day: '2026-07-15', cost: 2 });
			expect(first.watermark).toBeTruthy();

			// Incremental: a later B publish for a new day surfaces on the next read.
			await storeB.publishDayAggregates(scopeFor(b), [dayAgg('2026-07-16', { cost: 3 })]);
			const next = await storeA.loadAggregates(first.watermark);
			expect(next.dayAggregates.some((d) => d.day === '2026-07-16' && d.cost === 3)).toBe(true);
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('single-counts account-scoped cursor rows written by every machine (LWW)', { timeout: 30_000 }, async () => {
		const { storeA, storeB } = await pooledPair();
		const cursorScope: PublishScope = { sourceScope: cursorAccountScope('Shared@Example.com'), machineId: null };
		try {
			const agg = dayAgg('2026-07-14', { provider: 'cursor', model: 'claude-opus-4-8', cost: 0.9 });
			await storeA.publishDayAggregates(cursorScope, [agg]);
			await storeB.publishDayAggregates(cursorScope, [agg]);

			const load = await storeA.loadAggregates(null);
			const cursorRows = load.dayAggregates.filter((d) => d.sourceScope.startsWith('cursor-account:'));
			// Both machines wrote the SAME account-scoped key -> exactly one surviving row.
			expect(cursorRows).toHaveLength(1);
			expect(cursorRows[0].machineId).toBeUndefined();
			expect(cursorRows[0].cost).toBeCloseTo(0.9);
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('full-replacement upsert: republishing a key replaces it, never accumulates', { timeout: 30_000 }, async () => {
		const { a, storeA, storeB } = await pooledPair();
		try {
			await storeA.publishDayAggregates(scopeFor(a), [dayAgg('2026-07-13', { requests: 1, cost: 0.5 })]);
			await storeA.publishDayAggregates(scopeFor(a), [dayAgg('2026-07-13', { requests: 5, cost: 2.5 })]);
			const load = await storeB.loadAggregates(null);
			const rows = load.dayAggregates.filter((d) => d.day === '2026-07-13' && d.machineId === a);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ requests: 5, cost: 2.5 });
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('publishes sessions and prunes hour rows older than the retention window', { timeout: 30_000 }, async () => {
		const { a, storeA, storeB } = await pooledPair();
		try {
			// C7: the retention cutoff is computed SERVER-SIDE from now() (no client timestamp is
			// passed), so anchor the buckets to the real clock. A forward-skewed client can no
			// longer influence which rows are deleted.
			const now = Date.now();
			const recent = Math.floor((now - 3_600_000) / 3_600_000) * 3_600_000;
			const stale = Math.floor((now - 8 * 24 * 3_600_000) / 3_600_000) * 3_600_000;
			await storeA.publishHourAggregates(scopeFor(a), [hourAgg(recent), hourAgg(stale)]);
			await storeA.publishSessions(scopeFor(a), [session('codex', 'sess-1')]);

			const load = await storeB.loadAggregates(null);
			const hours = load.hourAggregates.filter((h) => h.machineId === a);
			// The 8-day-old bucket was inserted then immediately pruned (server clock); only the
			// recent one remains.
			expect(hours.map((h) => h.hourTs)).toEqual([recent]);
			expect(load.sessions.some((s) => s.sessionId === 'sess-1' && s.machineId === a)).toBe(true);
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('C8 — round-trips the per-day partial flag', { timeout: 30_000 }, async () => {
		const { a, storeA, storeB } = await pooledPair();
		try {
			await storeA.publishDayAggregates(scopeFor(a), [
				{ ...dayAgg('2026-07-12'), partial: true },
				{ ...dayAgg('2026-07-11'), partial: false }
			]);
			const load = await storeB.loadAggregates(null);
			const partialRow = load.dayAggregates.find((d) => d.day === '2026-07-12' && d.machineId === a);
			const cleanRow = load.dayAggregates.find((d) => d.day === '2026-07-11' && d.machineId === a);
			expect(partialRow?.partial).toBe(true);
			expect(cleanRow?.partial).toBe(false);
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('C10 — markPublished stamps last_published_at, distinct from the heartbeat last_seen', { timeout: 30_000 }, async () => {
		const { a, storeA, storeB } = await pooledPair();
		try {
			const before = await storeA.status();
			expect(before.machines.find((m) => m.id === a)?.lastPublishedAt ?? null).toBeNull();

			await storeA.markPublished();

			const after = await storeA.status();
			const machine = after.machines.find((m) => m.id === a);
			expect(machine?.lastPublishedAt).toBeTruthy();
			expect(machine?.lastSeenAt).toBeTruthy();
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});

	it('C9 — records schema_version and a fresh open succeeds via the version fast-path', { timeout: 30_000 }, async () => {
		const store1 = new PostgresSyncStore(databaseUrl!, randomUUID(), randomUUID());
		const store2 = new PostgresSyncStore(databaseUrl!, randomUUID(), randomUUID());
		const probe = new Pool({ connectionString: databaseUrl! });
		try {
			await store1.open(); // migrates (or no-ops) and records the version row
			const first = await probe.query(
				`SELECT version FROM chaching_sync.schema_version WHERE id = 1`
			);
			expect(first.rowCount).toBe(1);
			expect(Number(first.rows[0].version)).toBe(2);

			// A second, independent store opens against the already-migrated schema without error:
			// the fast-path SELECT sees the current version and skips the DDL + advisory lock.
			await store2.open();
			const second = await probe.query(
				`SELECT count(*)::int AS n FROM chaching_sync.schema_version`
			);
			expect(second.rows[0].n).toBe(1); // still exactly one version row
		} finally {
			await store1.close();
			await store2.close();
			await probe.end();
		}
	});

	it('maps subscriptions as pool rows with no stored per-record attribution', { timeout: 30_000 }, async () => {
		const { a, b, storeA, storeB } = await pooledPair();
		const subscriptionId = randomUUID();
		try {
			await storeA.addSubscription({
				id: subscriptionId,
				provider: 'claude',
				name: 'Work Claude',
				account: 'work@example.com',
				tier: 'max-20x',
				monthlyUsd: 200
			});
			await storeA.mapSubscription(a, 'claude', subscriptionId);
			await storeA.mapSubscription(b, 'claude', subscriptionId);
			const before = await storeA.mappingFingerprint();
			const mappings = await storeA.allMappings();
			expect(mappings.filter((m) => m.subscriptionId === subscriptionId)).toHaveLength(2);

			// Clearing a mapping is a plain upsert; the fingerprint changes (remap is retroactive
			// at read time), and there are no usage rows to sweep.
			await storeA.mapSubscription(a, 'claude', null);
			expect(await storeA.mappingFingerprint()).not.toBe(before);
			const cleared = (await storeA.allMappings()).find((m) => m.machineId === a && m.provider === 'claude');
			expect(cleared?.subscriptionId).toBeNull();
		} finally {
			await storeA.close();
			await storeB.close();
		}
	});
});
