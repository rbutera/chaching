import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { UsageRecord } from '@chaching/shared/types';
import { HistoryStore } from './store';
import { sessionActivity } from './wrapped';

function record(key: string, day: string, cost: number | null = 1): UsageRecord {
	return { key, day, timestamp: Date.parse(`${day}T12:00Z`), provider: 'cursor', sessionId: 'real-bridge', project: '/work/project', model: 'model', tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 }, cacheCreation1h: 0, cacheCreation5m: 0, webSearchRequests: 0, webFetchRequests: 0, isSidechain: false, cost };
}

it('retains actual days across restart and partial rescans, without fabricating days or Admin sessions', () => {
	const root = mkdtempSync(join(tmpdir(), 'wrapped-history-'));
	const store = new HistoryStore();
	try {
		const path = join(root, 'history.db');
		store.open(path);
		const records = [record('opencode:one', '2025-12-31'), record('opencode:two', '2026-01-02'), record('opencode:three', '2026-01-02', null)];
		for (const row of records) store.retainWrappedEvidence(row);
		store.retainWrappedEvidence(record('cursor:admin', '2026-01-01', 10000));
		store.close(); store.open(path);
		store.retainWrappedEvidence(records[1]);
		const saved = store.loadWrappedEvidence();
		expect(saved).toHaveLength(1);
		expect(saved[0].activity).toEqual([
			{ day: '2025-12-31', project: '/work/project', requests: 1, cost: 1, costUnknownRequests: 0 },
			{ day: '2026-01-02', project: '/work/project', requests: 2, cost: 1, costUnknownRequests: 1 }
		]);
		expect([...sessionActivity(records).values()][0]).toEqual(saved[0].activity);
		expect(store.loadAggregates()).toEqual([]);
	} finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
