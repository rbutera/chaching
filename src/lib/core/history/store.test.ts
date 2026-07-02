import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryStore } from './store';
import type { FrozenAgg } from '../rollup/rollup';
import type { SessionSummary } from '../../types';

const dirs: string[] = [];

afterEach(async () => {
	while (dirs.length > 0) {
		const d = dirs.pop();
		if (d) await rm(d, { recursive: true, force: true });
	}
});

async function tmpDb(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'chaching-history-'));
	dirs.push(dir);
	return join(dir, 'history.db');
}

function agg(day: string, model: string, requests: number, cost: number): FrozenAgg {
	return {
		day,
		provider: 'claude',
		model,
		tokens: { input: 100, output: 50, cacheCreation: 10, cacheRead: 5 },
		requests,
		cost,
		costUnknownRequests: 0,
		cacheCreation1h: 3,
		cacheCreation5m: 7,
		webSearchRequests: 2,
		webFetchRequests: 1
	};
}

function session(id: string, lastTs: number): SessionSummary {
	return {
		sessionId: id,
		provider: 'claude',
		project: '/proj',
		firstTs: lastTs - 1000,
		lastTs,
		tokens: { input: 100, output: 50, cacheCreation: 10, cacheRead: 5 },
		requests: 3,
		cost: 1.23,
		costUnknownRequests: 0,
		models: ['claude-opus-4-8', 'claude-sonnet-4-5']
	};
}

describe('HistoryStore', () => {
	it('round-trips frozen aggregates: freeze -> reopen -> loadAggregates equal', async () => {
		const dbPath = await tmpDb();
		const a = agg('2026-06-01', 'claude-opus-4-8', 12, 4.56);

		const w = new HistoryStore();
		w.open(dbPath);
		w.freezeDays(['2026-06-01'], [a], []);
		w.close();

		const r = new HistoryStore();
		r.open(dbPath);
		const loaded = r.loadAggregates();
		r.close();

		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toEqual(a);
	});

	it('round-trips sessions including the models array', async () => {
		const dbPath = await tmpDb();
		const s = session('sess-1', Date.UTC(2026, 5, 1, 10));

		const w = new HistoryStore();
		w.open(dbPath);
		w.freezeDays(['2026-06-01'], [], [s]);
		w.close();

		const r = new HistoryStore();
		r.open(dbPath);
		const loaded = r.loadSessions();
		r.close();

		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toEqual(s);
	});

	it('reports frozen days and upserts idempotently (no duplicate rows)', async () => {
		const dbPath = await tmpDb();
		const store = new HistoryStore();
		store.open(dbPath);

		store.freezeDays(['2026-06-01'], [agg('2026-06-01', 'm', 5, 1)], []);
		// Re-freeze the same day with a new value: INSERT OR REPLACE => one row, latest value.
		store.freezeDays(['2026-06-01'], [agg('2026-06-01', 'm', 9, 2)], []);

		expect([...store.frozenDays()]).toEqual(['2026-06-01']);
		const loaded = store.loadAggregates();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].requests).toBe(9);
		expect(loaded[0].cost).toBe(2);
		store.close();
	});

	it('persists across two separate process-like opens (survives close)', async () => {
		const dbPath = await tmpDb();
		const a = new HistoryStore();
		a.open(dbPath);
		a.freezeDays(['2026-05-30', '2026-05-31'], [agg('2026-05-30', 'm', 1, 1), agg('2026-05-31', 'm', 2, 2)], []);
		a.close();

		const b = new HistoryStore();
		b.open(dbPath);
		expect([...b.frozenDays()].sort()).toEqual(['2026-05-30', '2026-05-31']);
		b.close();
	});
});

describe('HistoryStore.openReadOnly — diagnostic reads must not mutate', () => {
	it('does NOT create the db (or parent dirs) when the file is absent', async () => {
		const dbPath = await tmpDb();
		const missing = join(dbPath, '..', 'nope', 'history.db');
		const store = new HistoryStore();
		expect(() => store.openReadOnly(missing)).toThrow();
		const { existsSync } = await import('node:fs');
		expect(existsSync(missing)).toBe(false);
		store.close();
	});

	it('reads frozen days from an existing db and rejects writes', async () => {
		const dbPath = await tmpDb();
		const writer = new HistoryStore();
		writer.open(dbPath);
		writer.freezeDays(new Set(['2026-06-01']), [agg('2026-06-01', 'claude-opus-4-8', 3, 12)], []);
		writer.close();

		const ro = new HistoryStore();
		ro.openReadOnly(dbPath);
		expect([...ro.frozenDays()]).toEqual(['2026-06-01']);
		// the read-only connection must refuse mutation
		expect(() =>
			ro.freezeDays(new Set(['2026-06-02']), [agg('2026-06-02', 'claude-opus-4-8', 1, 5)], [])
		).toThrow();
		ro.close();
	});
});
