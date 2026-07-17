import { Pool, type PoolClient } from 'pg';
import type { SessionSummary, UsageRecord } from '../../types';
import type { FrozenAgg } from '../rollup/rollup';
import type { SyncMachine, SyncMapping, SyncStatus, SyncSubscription } from './types';

const SCHEMA = 'chaching_sync';
const INSERT_CHUNK = 250;

export interface StoredUsageRecord {
	cursor: number;
	record: UsageRecord;
}

export class PostgresSyncStore {
	private pool: Pool;
	private opened = false;

	constructor(
		databaseUrl: string,
		private poolId: string | null = null,
		private machineId: string | null = null
	) {
		this.pool = new Pool({
			connectionString: databaseUrl,
			max: 4,
			application_name: 'chaching-sync'
		});
	}

	async open(): Promise<void> {
		if (this.opened) return;
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(
				`SELECT pg_advisory_xact_lock(hashtextextended('chaching-sync-schema-v1', 0))`
			);
			await migrate(client);
			await client.query('COMMIT');
			this.opened = true;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	setIdentity(poolId: string, machineId: string): void {
		this.poolId = poolId;
		this.machineId = machineId;
	}

	private identity(): { poolId: string; machineId: string } {
		if (!this.poolId || !this.machineId) throw new Error('Sync pool identity is not configured');
		return { poolId: this.poolId, machineId: this.machineId };
	}

	async createPool(input: {
		poolId: string;
		poolName: string;
		machineId: string;
		machineName: string;
		hostname: string;
	}): Promise<void> {
		await this.open();
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(
				`INSERT INTO ${SCHEMA}.pool (id, name) VALUES ($1, $2)
				 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
				[input.poolId, input.poolName]
			);
			await upsertMachine(client, input.poolId, input.machineId, input.machineName, input.hostname);
			await client.query('COMMIT');
			this.setIdentity(input.poolId, input.machineId);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	async joinPool(input: {
		poolId: string;
		machineId: string;
		machineName: string;
		hostname: string;
	}): Promise<void> {
		await this.open();
		const found = await this.pool.query(`SELECT 1 FROM ${SCHEMA}.pool WHERE id = $1`, [
			input.poolId
		]);
		if (found.rowCount === 0) throw new Error(`Sync pool '${input.poolId}' does not exist`);
		await upsertMachine(this.pool, input.poolId, input.machineId, input.machineName, input.hostname);
		this.setIdentity(input.poolId, input.machineId);
	}

	async heartbeat(machineName?: string, hostname?: string): Promise<void> {
		const { poolId, machineId } = this.identity();
		await this.pool.query(
			`UPDATE ${SCHEMA}.machine
			 SET last_seen_at = now(),
			     name = COALESCE(NULLIF($3, ''), name),
			     hostname = COALESCE(NULLIF($4, ''), hostname)
			 WHERE pool_id = $1 AND id = $2`,
			[poolId, machineId, machineName ?? '', hostname ?? '']
		);
	}

	async status(): Promise<SyncStatus> {
		const { poolId, machineId } = this.identity();
		await this.open();
		const [poolResult, machineResult, subscriptionResult, mappingResult] = await Promise.all([
			this.pool.query(`SELECT id, name FROM ${SCHEMA}.pool WHERE id = $1`, [poolId]),
			this.pool.query(
				`SELECT id, name, hostname, last_seen_at
				 FROM ${SCHEMA}.machine WHERE pool_id = $1 ORDER BY name, id`,
				[poolId]
			),
			this.pool.query(
				`SELECT id, provider, name, account, tier, monthly_usd
				 FROM ${SCHEMA}.subscription WHERE pool_id = $1 ORDER BY provider, name, id`,
				[poolId]
			),
			this.pool.query(
				`SELECT machine_id, provider, subscription_id
				 FROM ${SCHEMA}.machine_subscription WHERE pool_id = $1
				 ORDER BY machine_id, provider`,
				[poolId]
			)
		]);
		const poolRow = poolResult.rows[0] as { id: string; name: string } | undefined;
		if (!poolRow) throw new Error(`Sync pool '${poolId}' does not exist`);
		const machines: SyncMachine[] = machineResult.rows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			hostname: String(row.hostname),
			lastSeenAt: dateString(row.last_seen_at),
			current: String(row.id) === machineId
		}));
		const subscriptions: SyncSubscription[] = subscriptionResult.rows.map((row) => ({
			id: String(row.id),
			provider: String(row.provider),
			name: String(row.name),
			account: String(row.account),
			tier: String(row.tier),
			monthlyUsd: Number(row.monthly_usd)
		}));
		const mappings: SyncMapping[] = mappingResult.rows.map((row) => ({
			machineId: String(row.machine_id),
			provider: String(row.provider),
			subscriptionId: row.subscription_id == null ? null : String(row.subscription_id)
		}));
		return {
			enabled: true,
			databaseConfigured: true,
			pool: poolRow,
			machine: machines.find((machine) => machine.id === machineId) ?? null,
			machines,
			subscriptions,
			mappings
		};
	}

	async addSubscription(subscription: SyncSubscription): Promise<void> {
		const { poolId } = this.identity();
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.subscription
			 (id, pool_id, provider, name, account, tier, monthly_usd)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				subscription.id,
				poolId,
				subscription.provider,
				subscription.name,
				subscription.account,
				subscription.tier,
				subscription.monthlyUsd
			]
		);
	}

	async mapSubscription(
		targetMachineId: string,
		provider: string,
		subscriptionId: string | null
	): Promise<void> {
		const { poolId } = this.identity();
		if (subscriptionId) {
			const match = await this.pool.query(
				`SELECT 1 FROM ${SCHEMA}.subscription
				 WHERE pool_id = $1 AND id = $2 AND provider = $3`,
				[poolId, subscriptionId, provider]
			);
			if (match.rowCount === 0)
				throw new Error('Subscription does not exist in this pool for that provider');
		}
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await lockMapping(client, poolId, targetMachineId, provider);
			await client.query(
				`INSERT INTO ${SCHEMA}.machine_subscription
				 (pool_id, machine_id, provider, subscription_id)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (pool_id, machine_id, provider)
				 DO UPDATE SET subscription_id = EXCLUDED.subscription_id`,
				[poolId, targetMachineId, provider, subscriptionId]
			);
			for (const table of ['usage_record', 'imported_day_model', 'imported_session']) {
				await client.query(
					`UPDATE ${SCHEMA}.${table} SET subscription_id = $4
					 WHERE pool_id = $1 AND machine_id = $2 AND provider = $3`,
					[poolId, targetMachineId, provider, subscriptionId]
				);
			}
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	async mappedSubscriptions(machineId = this.identity().machineId): Promise<Record<string, string | null>> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT provider, subscription_id FROM ${SCHEMA}.machine_subscription
			 WHERE pool_id = $1 AND machine_id = $2`,
			[poolId, machineId]
		);
		return Object.fromEntries(
			result.rows.map((row) => [
				String(row.provider),
				row.subscription_id == null ? null : String(row.subscription_id)
			])
		);
	}

	async mappingFingerprint(): Promise<string> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT machine_id, provider, subscription_id
			 FROM ${SCHEMA}.machine_subscription
			 WHERE pool_id = $1 ORDER BY machine_id, provider`,
			[poolId]
		);
		return JSON.stringify(
			result.rows.map((row) => [
				String(row.machine_id),
				String(row.provider),
				row.subscription_id == null ? null : String(row.subscription_id)
			])
		);
	}

	async insertRecords(records: readonly UsageRecord[]): Promise<void> {
		if (records.length === 0) return;
		const { poolId, machineId } = this.identity();
		for (let start = 0; start < records.length; start += INSERT_CHUNK) {
			const payload = records.slice(start, start + INSERT_CHUNK).map((record) => ({
				source_key: record.key,
				provider: record.provider,
				ts: record.timestamp,
				day: record.day,
				model: record.model,
				input_tokens: record.tokens.input,
				output_tokens: record.tokens.output,
				cache_creation_tokens: record.tokens.cacheCreation,
				cache_read_tokens: record.tokens.cacheRead,
				cache_creation_1h: record.cacheCreation1h,
				cache_creation_5m: record.cacheCreation5m,
				web_search_requests: record.webSearchRequests,
				web_fetch_requests: record.webFetchRequests,
				session_id: record.sessionId,
				project: record.project,
				is_sidechain: record.isSidechain,
				cost: record.cost,
				subscription_id: record.subscriptionId ?? null
			}));
			const client = await this.pool.connect();
			try {
				await client.query('BEGIN');
				for (const provider of [...new Set(payload.map((record) => record.provider))].sort())
					await lockMapping(client, poolId, machineId, provider);
				await client.query(
					`INSERT INTO ${SCHEMA}.usage_record (
					pool_id, machine_id, source_key, provider, ts, day, model,
					input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
					cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
					session_id, project, is_sidechain, cost, subscription_id
				)
				SELECT $1, $2, x.source_key, x.provider, x.ts, x.day, x.model,
					x.input_tokens, x.output_tokens, x.cache_creation_tokens, x.cache_read_tokens,
					x.cache_creation_1h, x.cache_creation_5m, x.web_search_requests,
					x.web_fetch_requests, x.session_id, x.project, x.is_sidechain, x.cost,
					mapping.subscription_id
				FROM jsonb_to_recordset($3::jsonb) AS x(
					source_key text, provider text, ts bigint, day text, model text,
					input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint,
					cache_read_tokens bigint, cache_creation_1h bigint, cache_creation_5m bigint,
					web_search_requests integer, web_fetch_requests integer, session_id text,
					project text, is_sidechain boolean, cost double precision, subscription_id text
				)
				LEFT JOIN ${SCHEMA}.machine_subscription AS mapping
					ON mapping.pool_id = $1
					AND mapping.machine_id = $2
					AND mapping.provider = x.provider
				WHERE NOT (
					x.source_key LIKE 'cursor:%'
					AND EXISTS (
						SELECT 1 FROM ${SCHEMA}.imported_day_model AS imported
						WHERE imported.pool_id = $1
							AND imported.day = x.day
							AND imported.provider = x.provider
							AND imported.model = x.model
							AND imported.source_scope IN (
								'machine:' || $2,
								'cursor-account:' || lower(x.project)
							)
					)
				)
				ON CONFLICT DO NOTHING`,
					[poolId, machineId, JSON.stringify(payload)]
				);
				await client.query('COMMIT');
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		}
	}

	async importFrozenHistory(
		aggregates: readonly FrozenAgg[],
		sessions: readonly SessionSummary[],
		sourceScopes: Readonly<Record<string, string>> = {}
	): Promise<void> {
		const { poolId, machineId } = this.identity();
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const providers = [
				...new Set([
					...aggregates.map((aggregate) => aggregate.provider),
					...sessions.map((session) => session.provider)
				])
			].sort();
			for (const provider of providers) await lockMapping(client, poolId, machineId, provider);
			const mappingRows = await client.query(
				`SELECT provider, subscription_id FROM ${SCHEMA}.machine_subscription
				 WHERE pool_id = $1 AND machine_id = $2`,
				[poolId, machineId]
			);
			const mappings = Object.fromEntries(
				mappingRows.rows.map((row) => [
					String(row.provider),
					row.subscription_id == null ? null : String(row.subscription_id)
				])
			);
			for (const aggregate of aggregates) {
				const sourceScope =
					sourceScopes[aggregate.provider] ?? `machine:${machineId}`;
				await client.query(
					`INSERT INTO ${SCHEMA}.imported_day_model
					 (pool_id, machine_id, day, provider, model, source_scope, subscription_id, payload)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
					 ON CONFLICT DO NOTHING`,
					[
						poolId,
						machineId,
						aggregate.day,
						aggregate.provider,
						aggregate.model,
						sourceScope,
						mappings[aggregate.provider] ?? null,
						JSON.stringify(aggregate)
					]
				);
			}
			for (const session of sessions) {
				const sourceScope = sourceScopes[session.provider] ?? `machine:${machineId}`;
				await client.query(
					`INSERT INTO ${SCHEMA}.imported_session
					 (pool_id, machine_id, provider, session_id, source_scope, subscription_id, payload)
					 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
					 ON CONFLICT DO NOTHING`,
					[
						poolId,
						machineId,
						session.provider,
						session.sessionId,
						sourceScope,
						mappings[session.provider] ?? null,
						JSON.stringify(session)
					]
				);
			}
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	async loadImportedHistory(): Promise<{
		aggregates: FrozenAgg[];
		sessions: SessionSummary[];
	}> {
		const { poolId } = this.identity();
		const [aggregateResult, sessionResult] = await Promise.all([
			this.pool.query(
				`SELECT machine_id, subscription_id, payload FROM ${SCHEMA}.imported_day_model
				 WHERE pool_id = $1 ORDER BY day, provider, model, machine_id`,
				[poolId]
			),
			this.pool.query(
				`SELECT machine_id, subscription_id, payload FROM ${SCHEMA}.imported_session
				 WHERE pool_id = $1 ORDER BY provider, session_id, machine_id`,
				[poolId]
			)
		]);
		return {
			aggregates: aggregateResult.rows.map((row) => {
				const payload = jsonObject(row.payload) as unknown as FrozenAgg;
				return {
					...payload,
					machineId: payload.provider === 'cursor' ? undefined : String(row.machine_id),
					subscriptionId: row.subscription_id == null ? null : String(row.subscription_id)
				};
			}),
			sessions: sessionResult.rows.map((row) => {
				const payload = jsonObject(row.payload) as unknown as SessionSummary;
				return {
					...payload,
					machineId: payload.provider === 'cursor' ? undefined : String(row.machine_id),
					subscriptionId: row.subscription_id == null ? null : String(row.subscription_id)
				};
			})
		};
	}

	async loadAllRecords(): Promise<{ records: StoredUsageRecord[]; cursor: number }> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT * FROM ${SCHEMA}.usage_record WHERE pool_id = $1 ORDER BY id`,
			[poolId]
		);
		const records = result.rows.map(rowToStoredRecord);
		return { records, cursor: records.at(-1)?.cursor ?? 0 };
	}

	async recordsSince(cursor: number): Promise<StoredUsageRecord[]> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT * FROM ${SCHEMA}.usage_record
			 WHERE pool_id = $1 AND id > $2 ORDER BY id LIMIT 5000`,
			[poolId, cursor]
		);
		return result.rows.map(rowToStoredRecord);
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

async function migrate(client: PoolClient): Promise<void> {
	await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
	await client.query(`
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.pool (
			id text PRIMARY KEY,
			name text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			id text NOT NULL,
			name text NOT NULL,
			hostname text NOT NULL,
			last_seen_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, id)
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.subscription (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			id text NOT NULL,
			provider text NOT NULL,
			name text NOT NULL,
			account text NOT NULL DEFAULT '',
			tier text NOT NULL,
			monthly_usd double precision NOT NULL CHECK (monthly_usd >= 0),
			PRIMARY KEY (pool_id, id)
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_subscription (
			pool_id text NOT NULL,
			machine_id text NOT NULL,
			provider text NOT NULL,
			subscription_id text,
			PRIMARY KEY (pool_id, machine_id, provider),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, subscription_id)
				REFERENCES ${SCHEMA}.subscription(pool_id, id) ON DELETE SET NULL (subscription_id)
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.usage_record (
			id bigserial PRIMARY KEY,
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			machine_id text NOT NULL,
			source_key text NOT NULL,
			provider text NOT NULL,
			ts bigint NOT NULL,
			day text NOT NULL,
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
			cost double precision,
			subscription_id text,
			created_at timestamptz NOT NULL DEFAULT now(),
			UNIQUE (pool_id, machine_id, source_key),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, subscription_id)
				REFERENCES ${SCHEMA}.subscription(pool_id, id) ON DELETE SET NULL (subscription_id)
		);
		CREATE INDEX IF NOT EXISTS usage_record_pool_cursor
			ON ${SCHEMA}.usage_record(pool_id, id);
		CREATE INDEX IF NOT EXISTS usage_record_pool_day
			ON ${SCHEMA}.usage_record(pool_id, day);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.imported_day_model (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			machine_id text NOT NULL,
			day text NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			source_scope text NOT NULL DEFAULT '',
			subscription_id text,
			payload jsonb NOT NULL,
			PRIMARY KEY (pool_id, machine_id, day, provider, model),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, subscription_id)
				REFERENCES ${SCHEMA}.subscription(pool_id, id) ON DELETE SET NULL (subscription_id)
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.imported_session (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			machine_id text NOT NULL,
			provider text NOT NULL,
			session_id text NOT NULL,
			source_scope text NOT NULL DEFAULT '',
			subscription_id text,
			payload jsonb NOT NULL,
			PRIMARY KEY (pool_id, machine_id, provider, session_id),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, subscription_id)
				REFERENCES ${SCHEMA}.subscription(pool_id, id) ON DELETE SET NULL (subscription_id)
		);
		DELETE FROM ${SCHEMA}.usage_record AS duplicate
			USING ${SCHEMA}.usage_record AS keeper
			WHERE duplicate.source_key LIKE 'cursor:%'
				AND duplicate.pool_id = keeper.pool_id
				AND duplicate.source_key = keeper.source_key
				AND duplicate.id > keeper.id;
		ALTER TABLE ${SCHEMA}.imported_day_model
			ADD COLUMN IF NOT EXISTS source_scope text NOT NULL DEFAULT '';
		ALTER TABLE ${SCHEMA}.imported_session
			ADD COLUMN IF NOT EXISTS source_scope text NOT NULL DEFAULT '';
		UPDATE ${SCHEMA}.imported_day_model
			SET source_scope = 'machine:' || machine_id
			WHERE source_scope = '';
		UPDATE ${SCHEMA}.imported_session
			SET source_scope = 'machine:' || machine_id
			WHERE source_scope = '';
		DROP INDEX IF EXISTS ${SCHEMA}.imported_day_model_pool_cursor;
		DROP INDEX IF EXISTS ${SCHEMA}.imported_session_pool_cursor;
		CREATE UNIQUE INDEX IF NOT EXISTS usage_record_pool_cursor_event
			ON ${SCHEMA}.usage_record(pool_id, source_key)
			WHERE source_key LIKE 'cursor:%';
		CREATE UNIQUE INDEX IF NOT EXISTS imported_day_model_pool_cursor
			ON ${SCHEMA}.imported_day_model(pool_id, source_scope, day, provider, model)
			WHERE provider = 'cursor';
		CREATE UNIQUE INDEX IF NOT EXISTS imported_session_pool_cursor
			ON ${SCHEMA}.imported_session(pool_id, source_scope, provider, session_id)
			WHERE provider = 'cursor';
	`);
}

async function upsertMachine(
	client: Pick<PoolClient, 'query'> | Pool,
	poolId: string,
	machineId: string,
	machineName: string,
	hostname: string
): Promise<void> {
	await client.query(
		`INSERT INTO ${SCHEMA}.machine (pool_id, id, name, hostname)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (pool_id, id) DO UPDATE
		 SET name = EXCLUDED.name, hostname = EXCLUDED.hostname, last_seen_at = now()`,
		[poolId, machineId, machineName, hostname]
	);
}

async function lockMapping(
	client: PoolClient,
	poolId: string,
	machineId: string,
	provider: string
): Promise<void> {
	// Serialize attribution changes with inserts for one machine/provider. A row
	// lock cannot cover the "no mapping row yet" case, so use a transaction-scoped
	// advisory lock derived from the identity.
	await client.query(
		`SELECT pg_advisory_xact_lock(
			hashtextextended($1 || chr(31) || $2 || chr(31) || $3, 0)
		)`,
		[poolId, machineId, provider]
	);
}

function rowToStoredRecord(row: Record<string, unknown>): StoredUsageRecord {
	const timestamp = Number(row.ts);
	const key = String(row.source_key);
	return {
		cursor: Number(row.id),
		record: {
			key,
			provider: String(row.provider),
			timestamp,
			day: String(row.day),
			model: String(row.model),
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
			sessionId: String(row.session_id),
			project: String(row.project),
			isSidechain: Boolean(row.is_sidechain),
			cost: row.cost == null ? null : Number(row.cost),
			machineId: key.startsWith('cursor:') ? undefined : String(row.machine_id),
			subscriptionId: row.subscription_id == null ? null : String(row.subscription_id)
		}
	};
}

function dateString(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return new Date(value).toISOString();
	return null;
}

function jsonObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
	throw new Error('Invalid JSON payload in sync history');
}
