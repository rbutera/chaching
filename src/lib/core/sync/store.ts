import { Pool, type PoolClient } from 'pg';
import type { SessionSummary } from '../../types';
import type { FrozenAgg, HourAgg } from '../rollup/rollup';
import type { SyncMachine, SyncMapping, SyncStatus, SyncSubscription } from './types';

const SCHEMA = 'chaching_sync';
const HOUR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Which scope a published aggregate belongs to. Machine-local data publishes under
 * `machine:<id>` with `machineId` set; account-global cursor data publishes under
 * `cursor-account:<email>` with `machineId` null (every machine sees the same account
 * facts, so last-writer-wins is idempotent-correct — see the engine's cursor handling).
 */
export interface PublishScope {
	sourceScope: string;
	machineId: string | null;
}

export function machineScope(machineId: string): string {
	return `machine:${machineId}`;
}

export function cursorAccountScope(email: string): string {
	return `cursor-account:${email.trim().toLowerCase()}`;
}

/** A peer day aggregate loaded from the ledger, carrying its scope for overlay keying. */
export type PeerDayAgg = FrozenAgg & { sourceScope: string };
/** A peer hour aggregate loaded from the ledger. */
export type PeerHourAgg = HourAgg & { sourceScope: string; machineId?: string };
/** A peer session summary loaded from the ledger. */
export type PeerSession = SessionSummary & { sourceScope: string };

export interface PeerLoad {
	dayAggregates: PeerDayAgg[];
	hourAggregates: PeerHourAgg[];
	sessions: PeerSession[];
	/** Max `updated_at` (ISO) observed across returned peer rows, or the passed-in watermark. */
	watermark: string | null;
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
			application_name: 'chaching-sync',
			// A blackholed host must not hang status/burst requests forever; fail the
			// connect attempt after ~5s so callers degrade instead of stalling.
			connectionTimeoutMillis: 5000
		});
	}

	async open(): Promise<void> {
		if (this.opened) return;
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			// Schema DDL is the one place that mutates shared structure, so it stays under an
			// advisory lock. Aggregate upserts do NOT take this (or any mapping) lock: each
			// machine only ever writes its OWN source_scope rows and cursor-account rows are
			// last-writer-wins idempotent, so there is nothing to serialize.
			await client.query(
				`SELECT pg_advisory_xact_lock(hashtextextended('chaching-sync-schema-v2', 0))`
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

	/**
	 * Set (or clear) a machine/provider -> subscription mapping. Attribution is now a
	 * READ-TIME join (the engine resolves subscriptionId onto every day/session row from
	 * the mapping when it builds a snapshot), so this is a single idempotent upsert of the
	 * mapping row — there are no stored per-record subscription columns to sweep, and the
	 * engine's mapping-fingerprint watch makes a remap retroactive on the next burst.
	 */
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
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_subscription
			 (pool_id, machine_id, provider, subscription_id)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (pool_id, machine_id, provider)
			 DO UPDATE SET subscription_id = EXCLUDED.subscription_id`,
			[poolId, targetMachineId, provider, subscriptionId]
		);
	}

	async mappedSubscriptions(
		machineId = this.identity().machineId
	): Promise<Record<string, string | null>> {
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

	/** All (machineId, provider) -> subscriptionId mappings in the pool, for read-time attribution. */
	async allMappings(): Promise<SyncMapping[]> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT machine_id, provider, subscription_id FROM ${SCHEMA}.machine_subscription
			 WHERE pool_id = $1 ORDER BY machine_id, provider`,
			[poolId]
		);
		return result.rows.map((row) => ({
			machineId: String(row.machine_id),
			provider: String(row.provider),
			subscriptionId: row.subscription_id == null ? null : String(row.subscription_id)
		}));
	}

	async mappingFingerprint(): Promise<string> {
		const mappings = await this.allMappings();
		return JSON.stringify(
			mappings.map((mapping) => [mapping.machineId, mapping.provider, mapping.subscriptionId])
		);
	}

	/**
	 * Replace this scope's day aggregates with the supplied full rows. Idempotent
	 * last-writer-wins: each row is the machine's current TOTAL for (day, provider, model),
	 * so a failed burst simply republishes the same rows next time (self-healing — the
	 * dirty-day set is derived from the local rollup, there is no in-memory outbox to lose).
	 */
	async publishDayAggregates(scope: PublishScope, aggregates: readonly FrozenAgg[]): Promise<void> {
		if (aggregates.length === 0) return;
		const { poolId } = this.identity();
		const payload = aggregates.map((a) => ({
			day: a.day,
			provider: a.provider,
			model: a.model,
			input_tokens: a.tokens.input,
			output_tokens: a.tokens.output,
			cache_creation_tokens: a.tokens.cacheCreation,
			cache_read_tokens: a.tokens.cacheRead,
			cache_creation_1h: a.cacheCreation1h,
			cache_creation_5m: a.cacheCreation5m,
			web_search_requests: a.webSearchRequests,
			web_fetch_requests: a.webFetchRequests,
			requests: a.requests,
			cost: a.cost,
			cost_unknown_requests: a.costUnknownRequests
		}));
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_day_agg (
				pool_id, source_scope, machine_id, day, provider, model,
				input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
				requests, cost, cost_unknown_requests, updated_at
			)
			SELECT $1, $2, $3, x.day, x.provider, x.model,
				x.input_tokens, x.output_tokens, x.cache_creation_tokens, x.cache_read_tokens,
				x.cache_creation_1h, x.cache_creation_5m, x.web_search_requests, x.web_fetch_requests,
				x.requests, x.cost, x.cost_unknown_requests, now()
			FROM jsonb_to_recordset($4::jsonb) AS x(
				day text, provider text, model text,
				input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint,
				cache_read_tokens bigint, cache_creation_1h bigint, cache_creation_5m bigint,
				web_search_requests integer, web_fetch_requests integer,
				requests integer, cost double precision, cost_unknown_requests integer
			)
			ON CONFLICT (pool_id, source_scope, day, provider, model) DO UPDATE SET
				machine_id = EXCLUDED.machine_id,
				input_tokens = EXCLUDED.input_tokens,
				output_tokens = EXCLUDED.output_tokens,
				cache_creation_tokens = EXCLUDED.cache_creation_tokens,
				cache_read_tokens = EXCLUDED.cache_read_tokens,
				cache_creation_1h = EXCLUDED.cache_creation_1h,
				cache_creation_5m = EXCLUDED.cache_creation_5m,
				web_search_requests = EXCLUDED.web_search_requests,
				web_fetch_requests = EXCLUDED.web_fetch_requests,
				requests = EXCLUDED.requests,
				cost = EXCLUDED.cost,
				cost_unknown_requests = EXCLUDED.cost_unknown_requests,
				updated_at = now()`,
			[poolId, scope.sourceScope, scope.machineId, JSON.stringify(payload)]
		);
	}

	/**
	 * Replace this scope's recent hour aggregates, then prune this scope's rows older than
	 * the 7-day retention window (cheap DELETE on the hour_ts index). Callers publish only
	 * the last ~48h of local hour buckets, so the ledger never grows unbounded.
	 */
	async publishHourAggregates(scope: PublishScope, hours: readonly HourAgg[], now: number): Promise<void> {
		const { poolId } = this.identity();
		if (hours.length > 0) {
			const payload = hours.map((h) => ({
				hour_ts: h.hourTs,
				provider: h.provider,
				model: h.model,
				input_tokens: h.tokens.input,
				output_tokens: h.tokens.output,
				cache_creation_tokens: h.tokens.cacheCreation,
				cache_read_tokens: h.tokens.cacheRead,
				requests: h.requests,
				cost: h.cost,
				cost_unknown_requests: h.costUnknownRequests
			}));
			await this.pool.query(
				`INSERT INTO ${SCHEMA}.machine_hour_agg (
					pool_id, source_scope, machine_id, hour_ts, provider, model,
					input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
					requests, cost, cost_unknown_requests, updated_at
				)
				SELECT $1, $2, $3, x.hour_ts, x.provider, x.model,
					x.input_tokens, x.output_tokens, x.cache_creation_tokens, x.cache_read_tokens,
					x.requests, x.cost, x.cost_unknown_requests, now()
				FROM jsonb_to_recordset($4::jsonb) AS x(
					hour_ts bigint, provider text, model text,
					input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint,
					cache_read_tokens bigint, requests integer, cost double precision,
					cost_unknown_requests integer
				)
				ON CONFLICT (pool_id, source_scope, hour_ts, provider, model) DO UPDATE SET
					machine_id = EXCLUDED.machine_id,
					input_tokens = EXCLUDED.input_tokens,
					output_tokens = EXCLUDED.output_tokens,
					cache_creation_tokens = EXCLUDED.cache_creation_tokens,
					cache_read_tokens = EXCLUDED.cache_read_tokens,
					requests = EXCLUDED.requests,
					cost = EXCLUDED.cost,
					cost_unknown_requests = EXCLUDED.cost_unknown_requests,
					updated_at = now()`,
				[poolId, scope.sourceScope, scope.machineId, JSON.stringify(payload)]
			);
		}
		await this.pool.query(
			`DELETE FROM ${SCHEMA}.machine_hour_agg
			 WHERE pool_id = $1 AND source_scope = $2 AND hour_ts < $3`,
			[poolId, scope.sourceScope, now - HOUR_RETENTION_MS]
		);
	}

	/** Replace this scope's session summaries with the supplied full payloads (LWW). */
	async publishSessions(scope: PublishScope, sessions: readonly SessionSummary[]): Promise<void> {
		if (sessions.length === 0) return;
		const { poolId } = this.identity();
		const payload = sessions.map((s) => ({
			provider: s.provider,
			session_id: s.sessionId,
			payload: s
		}));
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_session_agg (
				pool_id, source_scope, machine_id, provider, session_id, payload, updated_at
			)
			SELECT $1, $2, $3, x.provider, x.session_id, x.payload, now()
			FROM jsonb_to_recordset($4::jsonb) AS x(
				provider text, session_id text, payload jsonb
			)
			ON CONFLICT (pool_id, source_scope, provider, session_id) DO UPDATE SET
				machine_id = EXCLUDED.machine_id,
				payload = EXCLUDED.payload,
				updated_at = now()`,
			[poolId, scope.sourceScope, scope.machineId, JSON.stringify(payload)]
		);
	}

	/**
	 * Load peer aggregates whose `updated_at >= since` (all rows on the first call, when
	 * `since` is null), EXCLUDING this machine's own `machine:<id>` rows — those are already
	 * present in the local rollup and overlaying them would double-count. Account-scoped
	 * cursor rows are always included (every machine, including the one that polls the
	 * Cursor Admin API, renders cursor spend from this overlay, never from its local rollup).
	 * The `>=` boundary is safe because the caller keys the overlay by row identity and a
	 * re-read simply replaces the same key.
	 */
	async loadAggregates(since: string | null): Promise<PeerLoad> {
		const { poolId, machineId } = this.identity();
		const ownScope = machineScope(machineId);
		const params = since === null ? [poolId, ownScope] : [poolId, ownScope, since];
		const clause =
			since === null
				? `pool_id = $1 AND source_scope <> $2`
				: `pool_id = $1 AND source_scope <> $2 AND updated_at >= $3`;
		const [dayResult, hourResult, sessionResult] = await Promise.all([
			this.pool.query(
				`SELECT source_scope, machine_id, day, provider, model,
					input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
					cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
					requests, cost, cost_unknown_requests, updated_at
				 FROM ${SCHEMA}.machine_day_agg WHERE ${clause}`,
				params
			),
			this.pool.query(
				`SELECT source_scope, machine_id, hour_ts, provider, model,
					input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
					requests, cost, cost_unknown_requests, updated_at
				 FROM ${SCHEMA}.machine_hour_agg WHERE ${clause}`,
				params
			),
			this.pool.query(
				`SELECT source_scope, machine_id, payload, updated_at
				 FROM ${SCHEMA}.machine_session_agg WHERE ${clause}`,
				params
			)
		]);
		let watermark = since;
		const advance = (value: unknown) => {
			const iso = dateString(value);
			if (iso && (watermark === null || iso > watermark)) watermark = iso;
		};
		const dayAggregates: PeerDayAgg[] = dayResult.rows.map((row) => {
			advance(row.updated_at);
			return {
				sourceScope: String(row.source_scope),
				machineId: row.machine_id == null ? undefined : String(row.machine_id),
				day: String(row.day),
				provider: String(row.provider),
				model: String(row.model),
				tokens: {
					input: Number(row.input_tokens),
					output: Number(row.output_tokens),
					cacheCreation: Number(row.cache_creation_tokens),
					cacheRead: Number(row.cache_read_tokens)
				},
				requests: Number(row.requests),
				cost: Number(row.cost),
				costUnknownRequests: Number(row.cost_unknown_requests),
				cacheCreation1h: Number(row.cache_creation_1h),
				cacheCreation5m: Number(row.cache_creation_5m),
				webSearchRequests: Number(row.web_search_requests),
				webFetchRequests: Number(row.web_fetch_requests)
			};
		});
		const hourAggregates: PeerHourAgg[] = hourResult.rows.map((row) => {
			advance(row.updated_at);
			return {
				sourceScope: String(row.source_scope),
				machineId: row.machine_id == null ? undefined : String(row.machine_id),
				hourTs: Number(row.hour_ts),
				provider: String(row.provider),
				model: String(row.model),
				tokens: {
					input: Number(row.input_tokens),
					output: Number(row.output_tokens),
					cacheCreation: Number(row.cache_creation_tokens),
					cacheRead: Number(row.cache_read_tokens)
				},
				requests: Number(row.requests),
				cost: Number(row.cost),
				costUnknownRequests: Number(row.cost_unknown_requests)
			};
		});
		const sessions: PeerSession[] = sessionResult.rows.map((row) => {
			advance(row.updated_at);
			const payload = jsonObject(row.payload) as unknown as SessionSummary;
			return {
				...payload,
				sourceScope: String(row.source_scope),
				machineId: row.machine_id == null ? undefined : String(row.machine_id)
			};
		});
		return { dayAggregates, hourAggregates, sessions, watermark };
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

async function migrate(client: PoolClient): Promise<void> {
	await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
	// v1 (never shipped) stored raw usage records + a join-time frozen-history import. The
	// v2 aggregate ledger replaces that outright, so drop the v1 tables instead of migrating.
	await client.query(`
		DROP TABLE IF EXISTS ${SCHEMA}.usage_record CASCADE;
		DROP TABLE IF EXISTS ${SCHEMA}.imported_day_model CASCADE;
		DROP TABLE IF EXISTS ${SCHEMA}.imported_session CASCADE;
	`);
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
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_day_agg (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			day text NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			input_tokens bigint NOT NULL,
			output_tokens bigint NOT NULL,
			cache_creation_tokens bigint NOT NULL,
			cache_read_tokens bigint NOT NULL,
			cache_creation_1h bigint NOT NULL,
			cache_creation_5m bigint NOT NULL,
			web_search_requests integer NOT NULL,
			web_fetch_requests integer NOT NULL,
			requests integer NOT NULL,
			cost double precision NOT NULL,
			cost_unknown_requests integer NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, day, provider, model),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_day_agg_pool_updated
			ON ${SCHEMA}.machine_day_agg(pool_id, updated_at);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_hour_agg (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			hour_ts bigint NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			input_tokens bigint NOT NULL,
			output_tokens bigint NOT NULL,
			cache_creation_tokens bigint NOT NULL,
			cache_read_tokens bigint NOT NULL,
			requests integer NOT NULL,
			cost double precision NOT NULL,
			cost_unknown_requests integer NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, hour_ts, provider, model),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_hour_agg_pool_updated
			ON ${SCHEMA}.machine_hour_agg(pool_id, updated_at);
		CREATE INDEX IF NOT EXISTS machine_hour_agg_pool_hour
			ON ${SCHEMA}.machine_hour_agg(pool_id, hour_ts);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_session_agg (
			pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			provider text NOT NULL,
			session_id text NOT NULL,
			payload jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, provider, session_id),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_session_agg_pool_updated
			ON ${SCHEMA}.machine_session_agg(pool_id, updated_at);
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

function dateString(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return new Date(value).toISOString();
	return null;
}

function jsonObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
	throw new Error('Invalid JSON payload in sync session');
}
