import { Pool, type PoolClient } from 'pg';
import type { UsageRecord } from '../../types';

export interface SyncMachine {
	id: string;
	name: string;
	lastSeen: number;
}

export interface SyncSubscription {
	id: string;
	provider: string;
	name: string;
	account: string;
	tier: string;
	monthlyUsd: number;
}

export interface SyncStatus {
	configured: boolean;
	pool: { id: string; name: string } | null;
	machines: SyncMachine[];
	subscriptions: SyncSubscription[];
	mappings: Record<string, string>;
}

export interface PollResult {
	records: UsageRecord[];
	cursor: number;
}

interface UsageRow {
	cursor: string | number;
	source_key: string;
	machine_id: string;
	subscription_id: string | null;
	provider: string;
	timestamp_ms: string | number;
	day: string | Date;
	model: string;
	input_tokens: string | number;
	output_tokens: string | number;
	cache_creation_tokens: string | number;
	cache_read_tokens: string | number;
	cache_creation_1h: string | number;
	cache_creation_5m: string | number;
	web_search_requests: string | number;
	web_fetch_requests: string | number;
	session_id: string;
	project: string;
	is_sidechain: boolean;
	cost_usd: string | number | null;
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS chaching_pools (
	id text PRIMARY KEY,
	name text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chaching_machines (
	pool_id text NOT NULL REFERENCES chaching_pools(id) ON DELETE CASCADE,
	id text NOT NULL,
	name text NOT NULL,
	last_seen timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pool_id, id)
);
CREATE TABLE IF NOT EXISTS chaching_subscriptions (
	pool_id text NOT NULL REFERENCES chaching_pools(id) ON DELETE CASCADE,
	id text NOT NULL,
	provider text NOT NULL,
	name text NOT NULL,
	account text NOT NULL,
	tier text NOT NULL,
	monthly_usd double precision NOT NULL CHECK (monthly_usd >= 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pool_id, id)
);
CREATE TABLE IF NOT EXISTS chaching_machine_provider_subscriptions (
	pool_id text NOT NULL,
	machine_id text NOT NULL,
	provider text NOT NULL,
	subscription_id text NOT NULL,
	PRIMARY KEY (pool_id, machine_id, provider),
	FOREIGN KEY (pool_id, machine_id) REFERENCES chaching_machines(pool_id, id) ON DELETE CASCADE,
	FOREIGN KEY (pool_id, subscription_id) REFERENCES chaching_subscriptions(pool_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chaching_usage_records (
	cursor bigserial PRIMARY KEY,
	pool_id text NOT NULL,
	machine_id text NOT NULL,
	source_key text NOT NULL,
	subscription_id text,
	provider text NOT NULL,
	timestamp_ms bigint NOT NULL,
	day date NOT NULL,
	model text NOT NULL,
	input_tokens bigint NOT NULL,
	output_tokens bigint NOT NULL,
	cache_creation_tokens bigint NOT NULL,
	cache_read_tokens bigint NOT NULL,
	cache_creation_1h bigint NOT NULL,
	cache_creation_5m bigint NOT NULL,
	web_search_requests integer NOT NULL,
	web_fetch_requests integer NOT NULL,
	session_id text NOT NULL,
	project text NOT NULL,
	is_sidechain boolean NOT NULL,
	cost_usd double precision,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (pool_id, machine_id, source_key),
	FOREIGN KEY (pool_id, machine_id) REFERENCES chaching_machines(pool_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chaching_usage_pool_cursor_idx
	ON chaching_usage_records(pool_id, cursor);
`;

export class PostgresSyncStore {
	private readonly db: Pool;

	constructor(databaseUrl: string) {
		if (!databaseUrl.trim()) throw new Error('sync database URL is not configured');
		this.db = new Pool({ connectionString: databaseUrl, max: 4 });
	}

	async migrate(): Promise<void> {
		await this.withTransaction(async (client) => {
			await client.query(
				"SELECT pg_advisory_xact_lock(hashtext('chaching-sync-schema-v1'))"
			);
			await client.query(MIGRATION_SQL);
		});
	}

	async createPool(
		pool: { id: string; name: string },
		machine: { id: string; name: string }
	): Promise<void> {
		await this.withTransaction(async (client) => {
			await client.query('INSERT INTO chaching_pools (id, name) VALUES ($1, $2)', [
				pool.id,
				pool.name
			]);
			await this.upsertMachine(client, pool.id, machine.id, machine.name);
		});
	}

	async joinPool(poolId: string, machine: { id: string; name: string }): Promise<void> {
		const found = await this.db.query('SELECT 1 FROM chaching_pools WHERE id = $1', [poolId]);
		if (found.rowCount !== 1) throw new Error(`sync pool '${poolId}' does not exist`);
		await this.registerMachine(poolId, machine.id, machine.name);
	}

	async registerMachine(poolId: string, machineId: string, name: string): Promise<void> {
		await this.upsertMachine(this.db, poolId, machineId, name);
	}

	async heartbeat(poolId: string, machineId: string): Promise<void> {
		await this.db.query(
			'UPDATE chaching_machines SET last_seen = now() WHERE pool_id = $1 AND id = $2',
			[poolId, machineId]
		);
	}

	async createSubscription(
		poolId: string,
		subscription: Omit<SyncSubscription, 'monthlyUsd'> & { monthlyUsd: number }
	): Promise<void> {
		await this.db.query(
			`INSERT INTO chaching_subscriptions
				(pool_id, id, provider, name, account, tier, monthly_usd)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				poolId,
				subscription.id,
				subscription.provider,
				subscription.name,
				subscription.account,
				subscription.tier,
				subscription.monthlyUsd
			]
		);
	}

	async mapMachineProvider(
		poolId: string,
		machineId: string,
		provider: string,
		subscriptionId: string | null
	): Promise<void> {
		if (subscriptionId === null) {
			await this.db.query(
				`DELETE FROM chaching_machine_provider_subscriptions
				 WHERE pool_id = $1 AND machine_id = $2 AND provider = $3`,
				[poolId, machineId, provider]
			);
			return;
		}
		await this.db.query(
			`INSERT INTO chaching_machine_provider_subscriptions
				(pool_id, machine_id, provider, subscription_id)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (pool_id, machine_id, provider)
			 DO UPDATE SET subscription_id = EXCLUDED.subscription_id`,
			[poolId, machineId, provider, subscriptionId]
		);
	}

	async insertRecords(poolId: string, machineId: string, records: readonly UsageRecord[]): Promise<number> {
		if (records.length === 0) return 0;
		return this.withTransaction(async (client) => {
			let inserted = 0;
			for (const record of records) {
				const result = await client.query(
					`INSERT INTO chaching_usage_records (
						pool_id, machine_id, source_key, subscription_id, provider,
						timestamp_ms, day, model, input_tokens, output_tokens,
						cache_creation_tokens, cache_read_tokens, cache_creation_1h,
						cache_creation_5m, web_search_requests, web_fetch_requests,
						session_id, project, is_sidechain, cost_usd
					) VALUES (
						$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
					) ON CONFLICT (pool_id, machine_id, source_key) DO NOTHING`,
					[
						poolId,
						machineId,
						record.key,
						record.subscriptionId ?? null,
						record.provider,
						record.timestamp,
						record.day,
						record.model,
						record.tokens.input,
						record.tokens.output,
						record.tokens.cacheCreation,
						record.tokens.cacheRead,
						record.cacheCreation1h,
						record.cacheCreation5m,
						record.webSearchRequests,
						record.webFetchRequests,
						record.sessionId,
						record.project,
						record.isSidechain,
						record.cost
					]
				);
				inserted += result.rowCount ?? 0;
			}
			return inserted;
		});
	}

	async initialLoad(poolId: string): Promise<PollResult> {
		return this.pollSinceCursor(poolId, 0);
	}

	async pollSinceCursor(poolId: string, cursor: number): Promise<PollResult> {
		const result = await this.db.query<UsageRow>(
			`SELECT cursor, source_key, machine_id, subscription_id, provider,
				timestamp_ms, day, model, input_tokens, output_tokens,
				cache_creation_tokens, cache_read_tokens, cache_creation_1h,
				cache_creation_5m, web_search_requests, web_fetch_requests,
				session_id, project, is_sidechain, cost_usd
			 FROM chaching_usage_records
			 WHERE pool_id = $1 AND cursor > $2
			 ORDER BY cursor ASC`,
			[poolId, cursor]
		);
		const records = result.rows.map(usageRecordFromRow);
		const nextCursor =
			result.rows.length === 0 ? cursor : Number(result.rows[result.rows.length - 1].cursor);
		return { records, cursor: nextCursor };
	}

	async status(poolId: string, machineId?: string): Promise<SyncStatus> {
		const [pool, machines, subscriptions, mappings] = await Promise.all([
			this.db.query<{ id: string; name: string }>(
				'SELECT id, name FROM chaching_pools WHERE id = $1',
				[poolId]
			),
			this.db.query<{ id: string; name: string; last_seen_ms: string | number }>(
				`SELECT id, name, extract(epoch from last_seen) * 1000 AS last_seen_ms
				 FROM chaching_machines WHERE pool_id = $1 ORDER BY name, id`,
				[poolId]
			),
			this.db.query<{
				id: string;
				provider: string;
				name: string;
				account: string;
				tier: string;
				monthly_usd: string | number;
			}>(
				`SELECT id, provider, name, account, tier, monthly_usd
				 FROM chaching_subscriptions WHERE pool_id = $1 ORDER BY provider, name`,
				[poolId]
			),
			machineId
				? this.db.query<{ provider: string; subscription_id: string }>(
						`SELECT provider, subscription_id
						 FROM chaching_machine_provider_subscriptions
						 WHERE pool_id = $1 AND machine_id = $2`,
						[poolId, machineId]
					)
				: Promise.resolve({ rows: [] })
		]);
		return {
			configured: pool.rowCount === 1,
			pool: pool.rows[0] ?? null,
			machines: machines.rows.map((row) => ({
				id: row.id,
				name: row.name,
				lastSeen: Number(row.last_seen_ms)
			})),
			subscriptions: subscriptions.rows.map((row) => ({
				id: row.id,
				provider: row.provider,
				name: row.name,
				account: row.account,
				tier: row.tier,
				monthlyUsd: Number(row.monthly_usd)
			})),
			mappings: Object.fromEntries(
				mappings.rows.map((row) => [row.provider, row.subscription_id])
			)
		};
	}

	async close(): Promise<void> {
		await this.db.end();
	}

	private async upsertMachine(
		client: Pick<PoolClient, 'query'> | Pool,
		poolId: string,
		machineId: string,
		name: string
	): Promise<void> {
		await client.query(
			`INSERT INTO chaching_machines (pool_id, id, name, last_seen)
			 VALUES ($1, $2, $3, now())
			 ON CONFLICT (pool_id, id)
			 DO UPDATE SET name = EXCLUDED.name, last_seen = now()`,
			[poolId, machineId, name]
		);
	}

	private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
		const client = await this.db.connect();
		try {
			await client.query('BEGIN');
			const value = await fn(client);
			await client.query('COMMIT');
			return value;
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}
}

export function usageRecordFromRow(row: UsageRow): UsageRecord {
	const day =
		row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
	return {
		key: row.source_key,
		machineId: row.machine_id,
		...(row.subscription_id ? { subscriptionId: row.subscription_id } : {}),
		provider: row.provider,
		timestamp: Number(row.timestamp_ms),
		day,
		model: row.model,
		tokens: {
			input: Number(row.input_tokens),
			output: Number(row.output_tokens),
			cacheCreation: Number(row.cache_creation_tokens),
			cacheRead: Number(row.cache_read_tokens)
		},
		cacheCreation1h: Number(row.cache_creation_1h),
		cacheCreation5m: Number(row.cache_creation_5m),
		webSearchRequests: Number(row.web_search_requests),
		webFetchRequests: Number(row.web_fetch_requests),
		sessionId: row.session_id,
		project: row.project,
		isSidechain: row.is_sidechain,
		cost: row.cost_usd === null ? null : Number(row.cost_usd)
	};
}
