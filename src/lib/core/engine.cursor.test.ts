import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from './config';
import type { UsageRecord } from '../types';

// A cursor Admin API poll returns a COMPLETE rolling 30-day window every time. Mock it to a
// fixed set so two poll cycles ingest the SAME events.
const cursorRecords: UsageRecord[] = [
	{
		key: 'cursor:evt-1',
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
		cost: 0.5,
		machineId: undefined,
		subscriptionId: null
	},
	{
		key: 'cursor:evt-2',
		provider: 'cursor',
		timestamp: Date.parse('2026-07-16T11:00:00Z'),
		day: '2026-07-16',
		model: 'claude-opus-4-8',
		tokens: { input: 40, output: 10, cacheCreation: 0, cacheRead: 0 },
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: 'cursor-session',
		project: 'shared@example.com',
		isSidechain: false,
		cost: 0.25,
		machineId: undefined,
		subscriptionId: null
	}
];

vi.mock('./providers/cursor/api', () => ({
	fetchCursorUsageRecords: vi.fn(async () => cursorRecords)
}));

import { createEngine } from './engine';
import type { Rollup } from './rollup/rollup';

function pooledCursorConfig(): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		history: { enabled: false, dbPath: '' },
		// Sync configured but pointed at a refused port: connectSync fails and degrades to
		// local-only, but the pooled cursorRollup is created before the connect attempt.
		sync: {
			enabled: true,
			databaseUrl: 'postgresql://u:p@127.0.0.1:1/db',
			poolId: randomUUID(),
			machineId: randomUUID(),
			machineName: 'kinto',
			providerSubscriptions: {},
			intervalMinutes: 15
		},
		providers: {
			claude: { enabled: false, roots: [], subscription: { ...DEFAULT_SUBSCRIPTION } },
			codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
			// email set + a token so the engine's cursor ingest path runs; the fetch is mocked.
			cursor: {
				enabled: true,
				adminApiToken: 'x',
				email: 'shared@example.com',
				pollSeconds: 36_000
			},
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, root: '' }
		}
	};
}

describe('C1 — pooled cursor rollup rebuilds each poll (no monotonic inflation)', () => {
	it('two ingestCursor cycles over the same events yield identical account totals, not doubled', async () => {
		const cfg = pooledCursorConfig();
		const engine = createEngine(cfg, () => Date.parse('2026-07-17T08:00:00Z'));
		const internal = engine as unknown as {
			cursorRollup: Rollup | null;
			ingestCursor: (token: string, email: string | null) => Promise<void>;
		};
		try {
			await engine.ensureStarted(); // start() runs ingestCursor once (cold scan cycle 1)
			expect(internal.cursorRollup).not.toBeNull();

			const totalCost = (rollup: Rollup) =>
				rollup.allDayAggregates().reduce((sum, a) => sum + a.cost, 0);
			const totalRequests = (rollup: Rollup) =>
				rollup.allDayAggregates().reduce((sum, a) => sum + a.requests, 0);

			const costAfterFirst = totalCost(internal.cursorRollup!);
			const requestsAfterFirst = totalRequests(internal.cursorRollup!);

			// A single application of the fixed record set.
			expect(costAfterFirst).toBeCloseTo(0.75);
			expect(requestsAfterFirst).toBe(2);

			// Second poll over the SAME event set — a rebuild, not an accumulation.
			await internal.ingestCursor('x', cfg.providers.cursor.email);

			expect(totalCost(internal.cursorRollup!)).toBeCloseTo(costAfterFirst);
			expect(totalRequests(internal.cursorRollup!)).toBe(requestsAfterFirst);
		} finally {
			engine.dispose();
		}
	});
});
