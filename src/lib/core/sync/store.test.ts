import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { UsageRecord } from '../../types';
import { usageRecordDedupKey } from '../ingest/dedup';
import { Rollup } from '../rollup/rollup';
import { PostgresSyncStore, usageRecordFromRow } from './store';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
	return {
		key: 'message:request',
		provider: 'claude',
		timestamp: 1_700_000_000_000,
		day: '2023-11-14',
		model: 'claude-opus-4-8',
		tokens: { input: 10, output: 2, cacheCreation: 3, cacheRead: 4 },
		cacheCreation1h: 1,
		cacheCreation5m: 2,
		webSearchRequests: 3,
		webFetchRequests: 4,
		sessionId: 'same-session',
		project: 'project',
		isSidechain: false,
		cost: null,
		...overrides
	};
}

describe('sync usage records', () => {
	it('maps every persisted field and preserves unknown cost honestly', () => {
		const mapped = usageRecordFromRow({
			cursor: '9',
			source_key: 'source',
			machine_id: 'machine-a',
			subscription_id: 'sub-a',
			provider: 'codex',
			timestamp_ms: '1700000000000',
			day: '2023-11-14',
			model: 'gpt-5.6',
			input_tokens: '10',
			output_tokens: '2',
			cache_creation_tokens: '3',
			cache_read_tokens: '4',
			cache_creation_1h: '1',
			cache_creation_5m: '2',
			web_search_requests: 3,
			web_fetch_requests: 4,
			session_id: 'session',
			project: 'project',
			is_sidechain: true,
			cost_usd: null
		});
		expect(mapped).toEqual({
			key: 'source',
			machineId: 'machine-a',
			subscriptionId: 'sub-a',
			provider: 'codex',
			timestamp: 1_700_000_000_000,
			day: '2023-11-14',
			model: 'gpt-5.6',
			tokens: { input: 10, output: 2, cacheCreation: 3, cacheRead: 4 },
			cacheCreation1h: 1,
			cacheCreation5m: 2,
			webSearchRequests: 3,
			webFetchRequests: 4,
			sessionId: 'session',
			project: 'project',
			isSidechain: true,
			cost: null
		});
	});

	it('deduplicates a machine reread without colliding across machines', () => {
		expect(usageRecordDedupKey(record({ machineId: 'a' }))).toBe(
			usageRecordDedupKey(record({ machineId: 'a' }))
		);
		expect(usageRecordDedupKey(record({ machineId: 'a' }))).not.toBe(
			usageRecordDedupKey(record({ machineId: 'b' }))
		);
	});

	it('keeps pooled aggregate and session rows separate by machine and subscription', () => {
		const rollup = new Rollup();
		rollup.add(record({ machineId: 'a', subscriptionId: 'sub-a', cost: 1 }));
		rollup.add(record({ machineId: 'b', subscriptionId: 'sub-b', cost: 2 }));
		const snapshot = rollup.snapshot();
		expect(snapshot.dayModel).toHaveLength(2);
		expect(snapshot.sessions).toHaveLength(2);
		expect(snapshot.dayModel.map((row) => row.machineId).sort()).toEqual(['a', 'b']);
		expect(snapshot.sessions.map((row) => row.subscriptionId).sort()).toEqual(['sub-a', 'sub-b']);
	});
});

const testDatabaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
describe.skipIf(!testDatabaseUrl)('PostgreSQL sync integration', () => {
	it('migrates, registers metadata, inserts idempotently, and polls by cursor', async () => {
		const databaseUrl = testDatabaseUrl!;
		const poolId = randomUUID();
		const machineId = randomUUID();
		const subscriptionId = randomUUID();
		const store = new PostgresSyncStore(databaseUrl);
		try {
			await store.migrate();
			await store.createPool(
				{ id: poolId, name: 'integration' },
				{ id: machineId, name: 'test-machine' }
			);
			await store.createSubscription(poolId, {
				id: subscriptionId,
				provider: 'claude',
				name: 'test',
				account: 'test@example.com',
				tier: 'test',
				monthlyUsd: 10
			});
			await store.mapMachineProvider(poolId, machineId, 'claude', subscriptionId);
			const event = record({ machineId, subscriptionId });
			expect(await store.insertRecords(poolId, machineId, [event, event])).toBe(1);
			const loaded = await store.initialLoad(poolId);
			expect(loaded.records).toHaveLength(1);
			expect((await store.pollSinceCursor(poolId, loaded.cursor)).records).toHaveLength(0);
			const status = await store.status(poolId, machineId);
			expect(status.machines).toHaveLength(1);
			expect(status.mappings).toEqual({ claude: subscriptionId });
			expect(JSON.stringify(status)).not.toContain(databaseUrl);
		} finally {
			await store.close();
			const cleanup = new Pool({ connectionString: databaseUrl });
			await cleanup.query('DELETE FROM chaching_pools WHERE id = $1', [poolId]).catch(() => {});
			await cleanup.end();
		}
	});
});
