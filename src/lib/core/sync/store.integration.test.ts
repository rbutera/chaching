import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../../types';
import { PostgresSyncStore } from './store';

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

function record(machineId: string): UsageRecord {
	return {
		key: 'same-local-source-key',
		provider: 'codex',
		timestamp: Date.parse('2026-07-17T08:00:00Z'),
		day: '2026-07-17',
		model: 'gpt-5.6-sol',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 40 },
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: 'session-1',
		project: '/tmp/project',
		isSidechain: false,
		cost: 0.00114,
		machineId,
		subscriptionId: null
	};
}

suite('PostgresSyncStore', () => {
	it('deduplicates within a machine but keeps the same source key from a peer', async () => {
		const poolId = randomUUID();
		const firstMachine = randomUUID();
		const secondMachine = randomUUID();
		const first = new PostgresSyncStore(databaseUrl!);
		const second = new PostgresSyncStore(databaseUrl!);
		try {
			await first.createPool({
				poolId,
				poolName: 'integration pool',
				machineId: firstMachine,
				machineName: 'kinto',
				hostname: 'kinto'
			});
			await second.joinPool({
				poolId,
				machineId: secondMachine,
				machineName: 'nimbus',
				hostname: 'nimbus'
			});
			await first.insertRecords([record(firstMachine), record(firstMachine)]);
			await second.insertRecords([record(secondMachine)]);
			await first.insertRecords([
				{ ...record(firstMachine), key: 'cursor:cloud-event-1', provider: 'cursor' }
			]);
			await second.insertRecords([
				{ ...record(secondMachine), key: 'cursor:cloud-event-1', provider: 'cursor' }
			]);
			const cursorAggregate = {
				day: '2026-07-16',
				provider: 'cursor',
				model: 'claude-opus-4-8',
				tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
				cacheCreation1h: 0,
				cacheCreation5m: 0,
				webSearchRequests: 0,
				webFetchRequests: 0,
				requests: 1,
				cost: 0.1,
				costUnknownRequests: 0
			};
			const cursorScope = { cursor: 'cursor-account:shared@example.com' };
			await first.importFrozenHistory([cursorAggregate], [], cursorScope);
			await second.importFrozenHistory([cursorAggregate], [], cursorScope);
			await first.insertRecords([
				{
					...record(firstMachine),
					key: 'cursor:covered-by-import',
					provider: 'cursor',
					day: '2026-07-16',
					model: 'claude-opus-4-8',
					project: 'shared@example.com'
				}
			]);

			const loaded = await first.loadAllRecords();
			expect(loaded.records).toHaveLength(3);
			expect(
				new Set(
					loaded.records
						.filter(({ record: item }) => item.provider === 'codex')
						.map(({ record: item }) => item.machineId)
				)
			).toEqual(
				new Set([firstMachine, secondMachine])
			);
			expect(
				loaded.records.filter(({ record: item }) => item.key === 'cursor:cloud-event-1')
			).toHaveLength(1);
			expect(
				loaded.records.filter(({ record: item }) => item.key === 'cursor:covered-by-import')
			).toHaveLength(0);
			expect((await first.loadImportedHistory()).aggregates).toHaveLength(1);
			expect(await first.recordsSince(loaded.cursor)).toEqual([]);

			const raw = new Pool({ connectionString: databaseUrl! });
			const migrator = new PostgresSyncStore(databaseUrl!, poolId, firstMachine);
			try {
				await raw.query('DROP INDEX chaching_sync.usage_record_pool_cursor_event');
				await raw.query(
					`INSERT INTO chaching_sync.usage_record (
						pool_id, machine_id, source_key, provider, ts, day, model,
						input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
						cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
						session_id, project, is_sidechain, cost, subscription_id
					)
					SELECT pool_id, $1, source_key, provider, ts, day, model,
						input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
						cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
						session_id, project, is_sidechain, cost, subscription_id
					FROM chaching_sync.usage_record WHERE source_key = 'cursor:cloud-event-1'`,
					[secondMachine]
				);
				await migrator.open();
				const count = await raw.query(
					`SELECT count(*)::int AS count FROM chaching_sync.usage_record
					 WHERE source_key = 'cursor:cloud-event-1'`
				);
				expect(count.rows[0]?.count).toBe(1);
			} finally {
				await migrator.close();
				await raw.end();
			}
		} finally {
			await first.close();
			await second.close();
		}
	});

	it('stores one shared subscription mapping for multiple machines', async () => {
		const poolId = randomUUID();
		const firstMachine = randomUUID();
		const secondMachine = randomUUID();
		const subscriptionId = randomUUID();
		const replacementId = randomUUID();
		const first = new PostgresSyncStore(databaseUrl!);
		const second = new PostgresSyncStore(databaseUrl!);
		try {
			await first.createPool({
				poolId,
				poolName: 'subscriptions',
				machineId: firstMachine,
				machineName: 'kinto',
				hostname: 'kinto'
			});
			await second.joinPool({
				poolId,
				machineId: secondMachine,
				machineName: 'latios',
				hostname: 'latios'
			});
			await first.addSubscription({
				id: subscriptionId,
				provider: 'claude',
				name: 'Work Claude Max',
				account: 'work@example.com',
				tier: 'max-20x',
				monthlyUsd: 200
			});
			await first.importFrozenHistory(
				[
					{
						day: '2026-07-01',
						provider: 'claude',
						model: 'claude-opus-4-8',
						tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
						cacheCreation1h: 0,
						cacheCreation5m: 0,
						webSearchRequests: 0,
						webFetchRequests: 0,
						requests: 1,
						cost: 0.1,
						costUnknownRequests: 0
					}
				],
				[]
			);
			await first.mapSubscription(firstMachine, 'claude', subscriptionId);
			await first.mapSubscription(secondMachine, 'claude', subscriptionId);
			await first.addSubscription({
				id: replacementId,
				provider: 'claude',
				name: 'Replacement Claude',
				account: 'replacement@example.com',
				tier: 'max-20x',
				monthlyUsd: 200
			});
			await Promise.all([
				first.mapSubscription(firstMachine, 'claude', replacementId),
				first.insertRecords([
					{
						...record(firstMachine),
						key: 'concurrent-claude-record',
						provider: 'claude',
						subscriptionId
					}
				])
			]);

			const status = await first.status();
			expect(status.subscriptions).toHaveLength(2);
			expect(status.mappings.filter((mapping) => mapping.subscriptionId === subscriptionId)).toHaveLength(
				1
			);
			expect((await first.loadImportedHistory()).aggregates[0]?.subscriptionId).toBe(replacementId);
			expect(
				(await first.loadAllRecords()).records.find(
					({ record: item }) => item.key === 'concurrent-claude-record'
				)?.record.subscriptionId
			).toBe(replacementId);
		} finally {
			await first.close();
			await second.close();
		}
	});
});
