import { isCalendarDay } from '@chaching/shared/view-model';
import { Pool, type PoolClient } from 'pg';
import type { MonetaryComponents } from '@chaching/shared/pricing/catalog';
import { mergeMonetary } from '@chaching/shared/aggregate';
import type { SessionSummary, SessionActivity } from '@chaching/shared/types';
import type { FrozenAgg, HourAgg } from '../rollup/rollup';
import type {
	ProviderQuotaStatus,
	SyncMachine,
	SyncMapping,
	SyncStatus,
	SyncAccount
} from '@chaching/shared/sync-types';

const SCHEMA = 'chaching_sync';
const HOUR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Bump when the DDL in `migrate()` changes. `open()` runs the DDL only when the recorded
 * schema_version differs, so a status GET no longer re-runs full DDL every call (C9). */
export const SCHEMA_VERSION = 6;
/**
 * Incremental peer reads back off the max-watermark by this margin. `updated_at` is stamped at
 * transaction START (`now()`), but a row only becomes visible at COMMIT; a peer whose publish
 * commits slowly can therefore land with an `updated_at` that already sits behind our advanced
 * watermark and be skipped forever. Re-reading a small overlap is free — the overlay replaces by
 * row identity — so we widen the lower bound by this margin (C6).
 */
export const WATERMARK_LOOKBACK_MS = 60_000;

/**
 * The effective lower bound for an incremental peer read: the watermark backed off by the
 * lookback margin. `null` (the first read) stays `null` so the caller reads everything. Exposed
 * for unit testing the effective since-param (C6).
 */
export function watermarkLowerBound(
	since: string | null,
	marginMs = WATERMARK_LOOKBACK_MS
): string | null {
	if (since === null) return null;
	const t = Date.parse(since);
	if (Number.isNaN(t)) return since;
	return new Date(t - marginMs).toISOString();
}

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

/**
 * A peer day aggregate loaded from the ledger, carrying its scope for overlay keying and the
 * publisher's per-day `partial` flag (true = that machine's local scan for the day was
 * incomplete, so the pooled day must render `partial`, not `frozen` — C8).
 */
export type PeerDayAgg = FrozenAgg & { sourceScope: string; partial?: boolean };
/** A day aggregate ready to publish: a rollup aggregate plus the publisher's `partial` flag. */
export type PublishDayAgg = FrozenAgg & { partial?: boolean };
/** A peer hour aggregate loaded from the ledger. */
export type PeerHourAgg = HourAgg & { sourceScope: string; machineId?: string };
/** A peer session summary loaded from the ledger. */
export type PeerSession = SessionSummary & { sourceScope: string };

export interface PeerLoad {
	activity?: SessionActivity[];
	dayAggregates: PeerDayAgg[];
	hourAggregates: PeerHourAgg[];
	sessions: PeerSession[];
	/** Max `updated_at` (ISO) observed across returned peer rows, or the passed-in watermark. */
	watermark: string | null;
}

export function coalesceSessionsForPublish(
	sessions: readonly SessionSummary[],
	machineId: string | null
): SessionSummary[] {
	const byIdentity = new Map<string, SessionSummary>();
	for (const session of sessions) {
		const key = `${session.provider}\u001f${session.sessionId}`;
		const stamped = { ...session, machineId: machineId ?? undefined };
		const existing = byIdentity.get(key);
		if (!existing) {
			byIdentity.set(key, {
				...stamped,
				tokens: { ...stamped.tokens },
				models: [...stamped.models]
			});
			continue;
		}
		byIdentity.set(key, {
			...existing,
			project: existing.project || stamped.project,
			firstTs: Math.min(existing.firstTs, stamped.firstTs),
			lastTs: Math.max(existing.lastTs, stamped.lastTs),
			tokens: {
				input: existing.tokens.input + stamped.tokens.input,
				output: existing.tokens.output + stamped.tokens.output,
				cacheCreation: existing.tokens.cacheCreation + stamped.tokens.cacheCreation,
				cacheRead: existing.tokens.cacheRead + stamped.tokens.cacheRead
			},
			requests: existing.requests + stamped.requests,
			cost: existing.cost + stamped.cost,
			monetary: mergeMonetary(existing.monetary, stamped.monetary),
			costUnknownRequests: existing.costUnknownRequests + stamped.costUnknownRequests,
			models: [...new Set([...existing.models, ...stamped.models])]
		});
	}
	return [...byIdentity.values()];
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

	async readSchemaVersion(): Promise<number | null> {
		return readSchemaVersion(this.pool);
	}

	async open(): Promise<void> {
		if (this.opened) return;
		// Fast path (no lock, no DDL): a status GET opens a fresh store on every dashboard load,
		// so running the full CREATE/DROP DDL under an advisory lock each time is wasteful. If the
		// schema is already at the current version, skip straight through (C9).
		if (await this.schemaIsCurrent()) {
			this.opened = true;
			return;
		}
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
			// Re-check under the lock: another connection may have migrated while we waited, so
			// only run the DDL if the schema is still stale.
			if (!(await schemaVersionAt(client, SCHEMA_VERSION))) {
				await migrate(client);
			}
			await client.query('COMMIT');
			this.opened = true;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	/** True when the recorded schema_version already matches SCHEMA_VERSION (no DDL needed). */
	private async schemaIsCurrent(): Promise<boolean> {
		return schemaVersionAt(this.pool, SCHEMA_VERSION);
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

	/**
	 * Stamp this machine's `last_published_at` after a successful publish burst. Distinct from
	 * the heartbeat's `last_seen_at`: the CLI/panel show "last published" (a real publish) versus
	 * "last seen" (a heartbeat), which the roster previously conflated (C10).
	 */
	async markPublished(): Promise<void> {
		const { poolId, machineId } = this.identity();
		await this.pool.query(
			`UPDATE ${SCHEMA}.machine SET last_published_at = now() WHERE pool_id = $1 AND id = $2`,
			[poolId, machineId]
		);
	}

	async publishProviderQuota(source: string, observedAt: string, accounts: ProviderQuotaStatus['accounts']): Promise<void> {
		const { poolId, machineId } = this.identity();
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_provider_status
			 (pool_id, machine_id, source, observed_at, payload, updated_at)
			 VALUES ($1, $2, $3, $4, $5::jsonb, now())
			 ON CONFLICT (pool_id, machine_id, source) DO UPDATE SET
			 observed_at = EXCLUDED.observed_at, payload = EXCLUDED.payload, updated_at = now()`,
			[poolId, machineId, source, observedAt, JSON.stringify({ accounts })]
		);
	}

	async status(): Promise<SyncStatus> {
		const { poolId, machineId } = this.identity();
		await this.open();
		const [poolResult, machineResult, accountResult, mappingResult, quotaResult] = await Promise.all([
			this.pool.query(`SELECT id, name FROM ${SCHEMA}.pool WHERE id = $1`, [poolId]),
			this.pool.query(
				`SELECT id, name, hostname, last_seen_at, last_published_at
				 FROM ${SCHEMA}.machine WHERE pool_id = $1 ORDER BY name, id`,
				[poolId]
			),
			this.pool.query(
				`SELECT id, provider, name, account, tier, monthly_usd, identity_key, fee_source
				 FROM ${SCHEMA}.account WHERE pool_id = $1 ORDER BY provider, name, id`,
				[poolId]
			),
			this.pool.query(
				`SELECT machine_id, provider, account_id
				 FROM ${SCHEMA}.machine_account WHERE pool_id = $1
				 ORDER BY machine_id, provider`,
				[poolId]
			),
			this.pool.query(
				`SELECT machine_id, source, observed_at, payload
				 FROM ${SCHEMA}.machine_provider_status WHERE pool_id = $1
				 ORDER BY machine_id, source`,
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
			lastPublishedAt: dateString(row.last_published_at),
			current: String(row.id) === machineId
		}));
		const accounts: SyncAccount[] = accountResult.rows.map((row) => ({
			id: String(row.id),
			provider: String(row.provider),
			name: String(row.name),
			account: String(row.account),
			tier: String(row.tier),
			monthlyUsd: row.monthly_usd === null ? null : Number(row.monthly_usd),
			identityKey: row.identity_key == null ? null : String(row.identity_key),
			feeSource: row.fee_source === 'inferred' ? 'inferred' : 'explicit'
		}));
		const mappings: SyncMapping[] = mappingResult.rows.map((row) => ({
			machineId: String(row.machine_id),
			provider: String(row.provider),
			accountId: row.account_id == null ? null : String(row.account_id)
		}));
		const providerQuotas: ProviderQuotaStatus[] = quotaResult.rows.map((row) => {
			const payload = jsonObject(row.payload) as { accounts?: ProviderQuotaStatus['accounts']; };
			return {
				machineId: String(row.machine_id),
				source: String(row.source),
				observedAt: dateString(row.observed_at) ?? '',
				accounts: Array.isArray(payload.accounts) ? payload.accounts : []
			};
		});
		return {
			enabled: true,
			databaseConfigured: true,
			pool: poolRow,
			machine: machines.find((machine) => machine.id === machineId) ?? null,
			machines,
			accounts,
			mappings,
			providerQuotas
		};
	}

	async discoverAccount(account: SyncAccount & { identityKey: string | null }, linkToMachine = true): Promise<string> {
		const { poolId, machineId } = this.identity();
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			// ponytail: serialize discovery per pool; use identity-scoped locks if discovery throughput matters.
			await client.query(`SELECT id FROM ${SCHEMA}.pool WHERE id = $1 FOR UPDATE`, [poolId]);
			const machine = await client.query(`SELECT id FROM ${SCHEMA}.machine WHERE pool_id = $1 AND id = $2 FOR UPDATE`, [poolId, machineId]);
			if (machine.rowCount === 0) throw new Error('Machine does not exist in this pool');
			const existing = await client.query(
				`SELECT id, provider, identity_key FROM ${SCHEMA}.account
				 WHERE pool_id = $1 AND (id = $2 OR (provider = $3 AND identity_key = $4)) FOR UPDATE`,
				[poolId, account.id, account.provider, account.identityKey]
			);
			if (existing.rows.length > 1) throw new Error('Discovered identity matches two Account bills; resolve the Account match before syncing');
			const row = existing.rows[0];
			if (row && (row.provider !== account.provider || (account.identityKey && row.identity_key && row.identity_key !== account.identityKey)))
				throw new Error('Account ID is already bound to a different provider identity');
			const id = row ? String(row.id) : account.id;
			await client.query(
				`INSERT INTO ${SCHEMA}.account AS saved (pool_id, id, provider, name, account, tier, monthly_usd, identity_key, fee_source)
				 VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8)
				 ON CONFLICT (pool_id, id) DO UPDATE SET identity_key = COALESCE(EXCLUDED.identity_key, saved.identity_key),
				 tier = CASE WHEN saved.fee_source = 'explicit' THEN saved.tier ELSE EXCLUDED.tier END,
				 monthly_usd = CASE WHEN saved.fee_source = 'explicit' THEN saved.monthly_usd ELSE EXCLUDED.monthly_usd END,
				 fee_source = CASE WHEN saved.fee_source = 'explicit' THEN saved.fee_source ELSE EXCLUDED.fee_source END`,
				[poolId, id, account.provider, account.name, account.tier, account.monthlyUsd, account.identityKey, account.feeSource ?? 'inferred']
			);
			if (linkToMachine) await client.query(
				`INSERT INTO ${SCHEMA}.machine_account (pool_id, machine_id, provider, account_id)
				 VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [poolId, machineId, account.provider, id]
			);
			await client.query('COMMIT');
			return id;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally { client.release(); }
	}

	async updateAccountDetails(account: Pick<SyncAccount, 'id' | 'provider'> & Partial<Pick<SyncAccount, 'name' | 'tier' | 'monthlyUsd' | 'feeSource'>>): Promise<void> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`UPDATE ${SCHEMA}.account SET name=COALESCE($3,name), tier=COALESCE($4,tier),
			 monthly_usd=CASE WHEN $8 THEN $5 ELSE monthly_usd END,
			 fee_source=CASE WHEN $8 THEN $6 ELSE fee_source END
			 WHERE pool_id=$1 AND id=$2 AND provider=$7`,
			[poolId, account.id, account.name, account.tier, account.monthlyUsd, account.feeSource ?? 'explicit', account.provider, account.monthlyUsd !== undefined]
		);
		if (result.rowCount !== 1) throw new Error('Account does not exist in this pool for that provider');
	}

	async addAccount(subscription: SyncAccount): Promise<void> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`INSERT INTO ${SCHEMA}.account
			 (id, pool_id, provider, name, account, tier, monthly_usd, identity_key, fee_source)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (pool_id, id) DO UPDATE SET id = EXCLUDED.id
			 WHERE account.provider = EXCLUDED.provider`,
			[
				subscription.id,
				poolId,
				subscription.provider,
				subscription.name,
				subscription.account,
				subscription.tier,
				subscription.monthlyUsd,
				subscription.identityKey ?? null,
				subscription.feeSource ?? 'explicit'
			]
		);
		if (result.rowCount !== 1) throw new Error('Account ID already belongs to another provider in this pool');
	}

	/**
	 * Set (or clear) a machine/provider -> subscription mapping. Attribution is now a
	 * READ-TIME join (the engine resolves accountId onto every day/session row from
	 * the mapping when it builds a snapshot), so this is a single idempotent upsert of the
	 * mapping row — there are no stored per-record subscription columns to sweep, and the
	 * engine's mapping-fingerprint watch makes a remap retroactive on the next burst.
	 */
	async mapAccount(
		targetMachineId: string,
		provider: string,
		accountId: string | null
	): Promise<void> {
		const { poolId } = this.identity();
		if (accountId) {
			const match = await this.pool.query(
				`SELECT 1 FROM ${SCHEMA}.account
				 WHERE pool_id = $1 AND id = $2 AND provider = $3`,
				[poolId, accountId, provider]
			);
			if (match.rowCount === 0)
				throw new Error('Subscription does not exist in this pool for that provider');
		}
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const machine = await client.query(`SELECT id FROM ${SCHEMA}.machine WHERE pool_id = $1 AND id = $2 FOR UPDATE`, [poolId, targetMachineId]);
			if (machine.rowCount === 0) throw new Error('Machine does not exist in this pool');
			await client.query(`DELETE FROM ${SCHEMA}.machine_account WHERE pool_id = $1 AND machine_id = $2 AND provider = $3`, [poolId, targetMachineId, provider]);
			if (accountId) await client.query(
				`INSERT INTO ${SCHEMA}.machine_account (pool_id, machine_id, provider, account_id) VALUES ($1, $2, $3, $4)`,
				[poolId, targetMachineId, provider, accountId]
			);
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally { client.release(); }
	}

	async linkAccount(machineId: string, provider: string, accountId: string): Promise<void> {
		const { poolId } = this.identity();
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_account (pool_id, machine_id, provider, account_id)
			 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
			[poolId, machineId, provider, accountId]
		);
	}

	async mappedAccounts(
		machineId = this.identity().machineId
	): Promise<Record<string, string | null>> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT provider, CASE WHEN count(*) = 1 THEN min(account_id) ELSE NULL END AS account_id FROM ${SCHEMA}.machine_account
			 WHERE pool_id = $1 AND machine_id = $2 GROUP BY provider`,
			[poolId, machineId]
		);
		return Object.fromEntries(
			result.rows.map((row) => [
				String(row.provider),
				row.account_id == null ? null : String(row.account_id)
			])
		);
	}

	/** All (machineId, provider) -> accountId mappings in the pool, for read-time attribution. */
	async allMappings(): Promise<SyncMapping[]> {
		const { poolId } = this.identity();
		const result = await this.pool.query(
			`SELECT machine_id, provider, account_id FROM ${SCHEMA}.machine_account
			 WHERE pool_id = $1 ORDER BY machine_id, provider`,
			[poolId]
		);
		return result.rows.map((row) => ({
			machineId: String(row.machine_id),
			provider: String(row.provider),
			accountId: row.account_id == null ? null : String(row.account_id)
		}));
	}

	async mappingFingerprint(): Promise<string> {
		const mappings = await this.allMappings();
		return JSON.stringify(
			mappings.map((mapping) => [mapping.machineId, mapping.provider, mapping.accountId])
		);
	}

	/**
	 * Replace this scope's day aggregates with the supplied full rows. Idempotent
	 * last-writer-wins: each row is the machine's current TOTAL for (day, provider, model),
	 * so a failed burst simply republishes the same rows next time (self-healing — the
	 * dirty-day set is derived from the local rollup, there is no in-memory outbox to lose).
	 */
	async publishDayAggregates(
		scope: PublishScope,
		aggregates: readonly PublishDayAgg[]
	): Promise<void> {
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
			monetary: a.monetary ?? null,
			cost_unknown_requests: a.costUnknownRequests,
			// A day is partial when the publisher's own local scan for it was incomplete; peers
			// must render it `partial`, never `frozen` (C8). A raw aggregate with no flag is
			// authoritative (false), so direct publishers stay correct.
			partial: a.partial ?? false
		}));
		await this.pool.query(
			`INSERT INTO ${SCHEMA}.machine_day_agg (
				pool_id, source_scope, machine_id, day, provider, model,
				input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
				requests, cost, cost_unknown_requests, monetary, partial, updated_at
			)
			SELECT $1, $2, $3, x.day, x.provider, x.model,
				x.input_tokens, x.output_tokens, x.cache_creation_tokens, x.cache_read_tokens,
				x.cache_creation_1h, x.cache_creation_5m, x.web_search_requests, x.web_fetch_requests,
				x.requests, x.cost, x.cost_unknown_requests, x.monetary, x.partial, now()
			FROM jsonb_to_recordset($4::jsonb) AS x(
				day text, provider text, model text,
				input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint,
				cache_read_tokens bigint, cache_creation_1h bigint, cache_creation_5m bigint,
				web_search_requests integer, web_fetch_requests integer,
				requests integer, cost double precision, cost_unknown_requests integer,
				monetary jsonb, partial boolean
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
				monetary = EXCLUDED.monetary,
				partial = EXCLUDED.partial,
				updated_at = now()`,
			[poolId, scope.sourceScope, scope.machineId, JSON.stringify(payload)]
		);
	}

	/**
	 * Replace this scope's recent hour aggregates, then prune this scope's rows older than
	 * the 7-day retention window (cheap DELETE on the hour_ts index). Callers publish only
	 * the last ~48h of local hour buckets, so the ledger never grows unbounded.
	 */
	async publishHourAggregates(scope: PublishScope, hours: readonly HourAgg[]): Promise<void> {
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
		// Retention cutoff is computed SERVER-SIDE from `now()` (hour_ts is epoch-ms), never a
		// client timestamp: a forward-skewed machine must not delete recent hour rows that other
		// machines still need, including shared cursor-account rows (C7).
		await this.pool.query(
			`DELETE FROM ${SCHEMA}.machine_hour_agg
			 WHERE pool_id = $1 AND source_scope = $2
			   AND hour_ts < (extract(epoch from now()) * 1000 - $3)`,
			[poolId, scope.sourceScope, HOUR_RETENTION_MS]
		);
	}

	/** Replace this scope's session summaries with the supplied full payloads (LWW). */
	async publishSessions(scope: PublishScope, sessions: readonly SessionSummary[]): Promise<void> {
		if (sessions.length === 0) return;
		const { poolId } = this.identity();
		const payload = coalesceSessionsForPublish(sessions, scope.machineId).map((s) => ({
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

	async publishSessionActivity(scope: PublishScope, rows: readonly SessionActivity[]): Promise<void> {
		if (!scope.machineId || !rows.length) return;
		const { poolId } = this.identity();
		await this.pool.query(`INSERT INTO ${SCHEMA}.machine_session_activity
			(pool_id, source_scope, machine_id, provider, session_id, payload, updated_at)
			SELECT $1, $2, $3, x.provider, x."sessionId", x.payload, now()
			FROM jsonb_to_recordset($4::jsonb) AS x(provider text, "sessionId" text, payload jsonb)
			ON CONFLICT(pool_id, source_scope, provider, session_id) DO UPDATE SET
				payload = EXCLUDED.payload || jsonb_build_object('activity', COALESCE((
					SELECT jsonb_agg(fragment) FROM (
						SELECT DISTINCT ON (fragment->>'day', fragment->>'project') fragment
						FROM jsonb_array_elements(COALESCE(machine_session_activity.payload->'activity', '[]'::jsonb) ||
							COALESCE(EXCLUDED.payload->'activity', '[]'::jsonb)) WITH ORDINALITY AS evidence(fragment, ordinal)
						ORDER BY fragment->>'day', fragment->>'project', (fragment->>'requests')::bigint DESC, ordinal DESC
					) retained
				), '[]'::jsonb)),
				updated_at = now()`, [poolId, scope.sourceScope, scope.machineId,
			JSON.stringify(rows.map(row => ({ provider: row.provider, sessionId: row.sessionId, payload: row })))]);
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
		// Widen the lower bound by the lookback margin so a slow-to-commit peer publish isn't
		// skipped (C6); the overlay replaces by row identity, so any re-read is idempotent.
		const lowerBound = watermarkLowerBound(since);
		const params = lowerBound === null ? [poolId, ownScope] : [poolId, ownScope, lowerBound];
		const clause =
			lowerBound === null
				? `pool_id = $1 AND source_scope <> $2`
				: `pool_id = $1 AND source_scope <> $2 AND updated_at >= $3`;
		const [dayResult, hourResult, sessionResult, activityResult] = await Promise.all([
			this.pool.query(
				`SELECT source_scope, machine_id, day, provider, model,
					input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
					cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
					requests, cost, cost_unknown_requests, monetary, partial, updated_at
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
			),
			this.pool.query(`SELECT machine_id, payload, updated_at FROM ${SCHEMA}.machine_session_activity WHERE ${clause}`, params)
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
				webFetchRequests: Number(row.web_fetch_requests),
				monetary: parseMonetary(row.monetary),
				partial: Boolean(row.partial)
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
				monetary: parseMonetary(payload.monetary),
				sourceScope: String(row.source_scope),
				machineId: row.machine_id == null ? undefined : String(row.machine_id)
			};
		});
		const activity = activityResult.rows.map(row => {
			advance(row.updated_at);
			const payload = jsonObject(row.payload);
			return parseSessionActivity(payload, String(row.machine_id));
		});
		return { dayAggregates, hourAggregates, sessions, activity, watermark };
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

async function migrate(client: PoolClient): Promise<void> {
	const version = await readSchemaVersion(client);
	if (version === 4 || version === 5) {
		if (version === 4) await client.query(`ALTER TABLE ${SCHEMA}.machine_day_agg ADD COLUMN monetary jsonb`);
		await createActivityTable(client);
		await client.query(`UPDATE ${SCHEMA}.schema_version SET version = $1 WHERE id = 1`, [SCHEMA_VERSION]);
		return;
	}
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
			last_published_at timestamptz,
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
			partial boolean NOT NULL DEFAULT false,
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
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_provider_status (
			pool_id text NOT NULL,
			machine_id text NOT NULL,
			source text NOT NULL,
			observed_at timestamptz NOT NULL,
			payload jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, machine_id, source),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_version (
			id integer PRIMARY KEY,
			version integer NOT NULL
		);
	`);
	await client.query(`
		ALTER TABLE ${SCHEMA}.subscription RENAME TO account;
		ALTER TABLE ${SCHEMA}.account
			ALTER COLUMN monthly_usd DROP NOT NULL,
			ADD COLUMN identity_key text,
			ADD COLUMN fee_source text NOT NULL DEFAULT 'explicit' CHECK (fee_source IN ('explicit', 'inferred')),
			ADD CONSTRAINT account_explicit_fee CHECK (fee_source <> 'explicit' OR monthly_usd IS NOT NULL),
			ADD CONSTRAINT account_provider_key UNIQUE (pool_id, provider, id),
			ADD CONSTRAINT account_identity_key UNIQUE (pool_id, provider, identity_key);
		CREATE TABLE ${SCHEMA}.machine_account (
			pool_id text NOT NULL,
			machine_id text NOT NULL,
			provider text NOT NULL,
			account_id text NOT NULL,
			PRIMARY KEY (pool_id, machine_id, provider, account_id),
			FOREIGN KEY (pool_id, machine_id) REFERENCES ${SCHEMA}.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, provider, account_id) REFERENCES ${SCHEMA}.account(pool_id, provider, id) ON DELETE CASCADE
		);
		INSERT INTO ${SCHEMA}.machine_account (pool_id, machine_id, provider, account_id)
			SELECT pool_id, machine_id, provider, subscription_id FROM ${SCHEMA}.machine_subscription WHERE subscription_id IS NOT NULL;
		DROP TABLE ${SCHEMA}.machine_subscription;
		ALTER TABLE ${SCHEMA}.schema_version ADD CONSTRAINT account_schema_min_version CHECK (version >= 4) NOT VALID;
	`);
	await client.query(`ALTER TABLE ${SCHEMA}.machine_day_agg ADD COLUMN IF NOT EXISTS monetary jsonb`);
	// Record the version last, inside the same migration transaction, so the fast path in
	// open() can skip the DDL entirely next time (C9).
	await client.query(
		`INSERT INTO ${SCHEMA}.schema_version (id, version) VALUES (1, $1)
		 ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version`,
		[SCHEMA_VERSION]
	);
	await client.query(`ALTER TABLE ${SCHEMA}.schema_version VALIDATE CONSTRAINT account_schema_min_version`);
	await createActivityTable(client);
}

/**
 * True when the recorded schema_version equals `version` (checked under the migration lock).
 * Uses `to_regclass` (which returns NULL, never an error, for a missing relation) so probing a
 * not-yet-created table cannot abort the surrounding migration transaction.
 */
async function schemaVersionAt(client: PoolClient | Pool, version: number): Promise<boolean> {
	const recorded = await readSchemaVersion(client);
	if (recorded !== null && recorded > version) throw new Error(`Unsupported pool schema version ${recorded}; this chaching supports ${version}. Upgrade chaching.`);
	return recorded === version;
}

async function readSchemaVersion(client: PoolClient | Pool): Promise<number | null> {
	const exists = await client.query(`SELECT to_regclass('${SCHEMA}.schema_version') AS reg`);
	if (!exists.rows[0]?.reg) return null;
	const result = await client.query(`SELECT version FROM ${SCHEMA}.schema_version WHERE id = 1`);
	return result.rows[0] ? Number(result.rows[0].version) : null;
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

function parseMonetary(value: unknown): MonetaryComponents | undefined {
	if (!value || typeof value !== 'object' || !('input' in value) || !('output' in value) || !('cacheCreation' in value) || !('cacheRead' in value) || !('tools' in value)) return;
	const {input, output, cacheCreation, cacheRead, tools} = value;
	if (typeof input !== 'number' || typeof output !== 'number' || typeof cacheCreation !== 'number' || typeof cacheRead !== 'number' || typeof tools !== 'number' || ![input, output, cacheCreation, cacheRead, tools].every(n => Number.isFinite(n) && n >= 0)) return;
	return {input, output, cacheCreation, cacheRead, tools, cacheReadUncached: 'cacheReadUncached' in value && typeof value.cacheReadUncached === 'number' && Number.isFinite(value.cacheReadUncached) && value.cacheReadUncached >= 0 ? value.cacheReadUncached : undefined};
}

async function createActivityTable(client: PoolClient): Promise<void> {
	await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.machine_session_activity (
		pool_id text NOT NULL REFERENCES ${SCHEMA}.pool(id) ON DELETE CASCADE,
		source_scope text NOT NULL, machine_id text NOT NULL, provider text NOT NULL,
		session_id text NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY(pool_id, source_scope, provider, session_id)
	);
	CREATE INDEX IF NOT EXISTS machine_session_activity_pool_updated ON ${SCHEMA}.machine_session_activity(pool_id, updated_at)`);
}

function parseSessionActivity(payload: Record<string, unknown>, machineId: string): SessionActivity {
	if (typeof payload.provider !== 'string' || typeof payload.sessionId !== 'string' || !Array.isArray(payload.activity)) throw new Error('Invalid pooled session activity');
	const activity = payload.activity.map((row: unknown) => {
		if (!row || typeof row !== 'object' || !('day' in row) || typeof row.day !== 'string' || !isCalendarDay(row.day) || !('project' in row) || typeof row.project !== 'string' || !('requests' in row) || typeof row.requests !== 'number' || !Number.isSafeInteger(row.requests) || row.requests <= 0 || !('cost' in row) || typeof row.cost !== 'number' || !Number.isFinite(row.cost) || row.cost < 0 || !('costUnknownRequests' in row) || typeof row.costUnknownRequests !== 'number' || !Number.isSafeInteger(row.costUnknownRequests) || row.costUnknownRequests < 0 || row.costUnknownRequests > row.requests) throw new Error('Invalid pooled session activity');
		return { day: row.day, project: row.project, requests: row.requests, cost: row.cost, costUnknownRequests: row.costUnknownRequests };
	});
	return { provider: payload.provider, sessionId: payload.sessionId, machineId, activity };
}
