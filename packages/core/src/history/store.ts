// Durable local history: finalized aggregates plus record-level monetary evidence.
// Current-day contributions are retained before publication; frozen legacy aggregates
// remain authoritative when they have no proven record identities.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SessionSummary, TokenCounts, UsageRecord } from '@chaching/shared/types';
import type { FrozenAgg } from '../rollup/rollup';

const SCHEMA_VERSION = 3;

/**
 * A writable SQLite store of frozen past-day aggregates + finalized sessions.
 * `open()` creates the schema on first use; everything else reads/writes the
 * already-open handle. Always `close()` to release the file handle.
 */
export class HistoryStore {
	private db: DatabaseSync | null = null;

	/**
	 * Open an EXISTING DB strictly read-only: no mkdir, no PRAGMA, no schema DDL.
	 * For diagnostic reads (`chaching doctor`) that must not mutate anything —
	 * `open()` would set WAL mode and run `CREATE TABLE IF NOT EXISTS` even on an
	 * existing file. Throws when the file is absent/unreadable (a read-only
	 * connection to a WAL db can also fail while no writer holds the -shm);
	 * callers catch and report honestly rather than fall back to a writable open.
	 */
	openReadOnly(dbPath: string): void {
		if (this.db) return;
		this.db = new DatabaseSync(dbPath, { readOnly: true });
	}

	/** Open (and create + migrate) the DB at `dbPath`. Creates parent dirs. */
	open(dbPath: string): void {
		if (this.db) return;
		mkdirSync(dirname(dbPath), { recursive: true });
		const db = new DatabaseSync(dbPath, { readOnly: false });
		try {
			db.exec('PRAGMA journal_mode = WAL');
			db.exec('PRAGMA foreign_keys = ON');
			this.createSchema(db);
		} catch (err) {
			// Don't leak the handle if PRAGMA/schema setup fails before we adopt it.
			try {
				db.close();
			} catch {
				// already closed / nothing to release
			}
			throw err;
		}
		this.db = db;
	}

	private createSchema(db: DatabaseSync): void {
		db.exec(`
			CREATE TABLE IF NOT EXISTS wrapped_evidence (
                provider TEXT NOT NULL, record_key TEXT NOT NULL, day TEXT NOT NULL,
                session_id TEXT NOT NULL, project TEXT NOT NULL, cost REAL,
                PRIMARY KEY (provider, record_key)
            );
            CREATE TABLE IF NOT EXISTS valuation (
                scope_key TEXT PRIMARY KEY,
                day TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                session_id TEXT NOT NULL,
                record TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pricing_publication (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                generation INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS day_model_agg (
				day TEXT NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				input INTEGER NOT NULL,
				output INTEGER NOT NULL,
				cache_creation INTEGER NOT NULL,
				cache_read INTEGER NOT NULL,
				cache_creation_1h INTEGER NOT NULL,
				cache_creation_5m INTEGER NOT NULL,
				web_search_requests INTEGER NOT NULL,
				web_fetch_requests INTEGER NOT NULL,
				requests INTEGER NOT NULL,
				cost REAL NOT NULL,
				cost_unknown_requests INTEGER NOT NULL,
				PRIMARY KEY (day, provider, model)
			);
			CREATE TABLE IF NOT EXISTS session (
				session_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				project TEXT NOT NULL,
				first_ts INTEGER NOT NULL,
				last_ts INTEGER NOT NULL,
				input INTEGER NOT NULL,
				output INTEGER NOT NULL,
				cache_creation INTEGER NOT NULL,
				cache_read INTEGER NOT NULL,
				requests INTEGER NOT NULL,
				cost REAL NOT NULL,
				cost_unknown_requests INTEGER NOT NULL,
				models TEXT NOT NULL,
				PRIMARY KEY (session_id, provider)
			);
		`);
		db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
			String(SCHEMA_VERSION)
		);
	}

	private require(): DatabaseSync {
		if (!this.db) throw new Error('HistoryStore not open');
		return this.db;
	}

	/** The set of days (YYYY-MM-DD UTC) that have already been frozen into the DB. */
	frozenDays(): Set<string> {
		const rows = this.require().prepare(`SELECT DISTINCT day FROM day_model_agg`).all();
		const days = new Set<string>();
		for (const r of rows) {
			const day = (r as Record<string, unknown>).day;
			if (typeof day === 'string') days.add(day);
		}
		return days;
	}

	/** All frozen per-(day, provider, model) aggregates (with persisted-only extras). */
	loadAggregates(): FrozenAgg[] {
		const rows = this.require().prepare(`SELECT * FROM day_model_agg`).all();
		return rows.map((r) => rowToAgg(r as Record<string, unknown>));
	}

	/** All finalized (past-day) session summaries. */
	loadSessions(): SessionSummary[] {
		const rows = this.require().prepare(`SELECT * FROM session`).all();
		return rows.map((r) => rowToSession(r as Record<string, unknown>));
	}

	hasRevision(revision: string): boolean {
		const row = this.require().prepare(`SELECT value FROM meta WHERE key = ?`).get(revision);
		return row !== undefined;
	}

	/**
	 * One-time provider backfill for a newly discovered source. Existing rows only
	 * move forward when the fresh scan has at least as many requests, so pruned
	 * source files cannot reduce durable history.
	 */
	backfillProviderHistory(
		revision: string,
		provider: string,
		aggregates: readonly FrozenAgg[],
		sessions: readonly SessionSummary[]
	): boolean {
		const db = this.require();
		if (this.hasRevision(revision)) return false;

		const upsertAgg = db.prepare(`
			INSERT INTO day_model_agg (
				day, provider, model, input, output, cache_creation, cache_read,
				cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
				requests, cost, cost_unknown_requests
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (day, provider, model) DO UPDATE SET
				input = excluded.input,
				output = excluded.output,
				cache_creation = excluded.cache_creation,
				cache_read = excluded.cache_read,
				cache_creation_1h = excluded.cache_creation_1h,
				cache_creation_5m = excluded.cache_creation_5m,
				web_search_requests = excluded.web_search_requests,
				web_fetch_requests = excluded.web_fetch_requests,
				requests = excluded.requests,
				cost = excluded.cost,
				cost_unknown_requests = excluded.cost_unknown_requests
			WHERE excluded.requests >= day_model_agg.requests
		`);
		const upsertSession = db.prepare(`
			INSERT INTO session (
				session_id, provider, project, first_ts, last_ts,
				input, output, cache_creation, cache_read, requests, cost, cost_unknown_requests, models
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (session_id, provider) DO UPDATE SET
				project = excluded.project,
				first_ts = excluded.first_ts,
				last_ts = excluded.last_ts,
				input = excluded.input,
				output = excluded.output,
				cache_creation = excluded.cache_creation,
				cache_read = excluded.cache_read,
				requests = excluded.requests,
				cost = excluded.cost,
				cost_unknown_requests = excluded.cost_unknown_requests,
				models = excluded.models
			WHERE excluded.requests >= session.requests
		`);

		db.exec('BEGIN');
		try {
			for (const aggregate of aggregates) {
				if (aggregate.provider !== provider) continue;
				upsertAgg.run(
					aggregate.day,
					aggregate.provider,
					aggregate.model,
					aggregate.tokens.input,
					aggregate.tokens.output,
					aggregate.tokens.cacheCreation,
					aggregate.tokens.cacheRead,
					aggregate.cacheCreation1h,
					aggregate.cacheCreation5m,
					aggregate.webSearchRequests,
					aggregate.webFetchRequests,
					aggregate.requests,
					aggregate.cost,
					aggregate.costUnknownRequests
				);
			}
			for (const session of sessions) {
				if (session.provider !== provider) continue;
				upsertSession.run(
					session.sessionId,
					session.provider,
					session.project,
					session.firstTs,
					session.lastTs,
					session.tokens.input,
					session.tokens.output,
					session.tokens.cacheCreation,
					session.tokens.cacheRead,
					session.requests,
					session.cost,
					session.costUnknownRequests,
					JSON.stringify(session.models)
				);
			}
			db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(revision, 'complete');
			db.exec('COMMIT');
			return true;
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	}

	/** Persist aggregate corrections for already-frozen days without ever reducing history. */
	reconcileProviderHistory(
		provider: string,
		aggregates: readonly FrozenAgg[],
		sessions: readonly SessionSummary[]
	): void {
		const db = this.require();
		const upsertAgg = db.prepare(`
			INSERT INTO day_model_agg (
				day, provider, model, input, output, cache_creation, cache_read,
				cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
				requests, cost, cost_unknown_requests
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (day, provider, model) DO UPDATE SET
				input = MAX(input, excluded.input),
				output = MAX(output, excluded.output),
				cache_creation = MAX(cache_creation, excluded.cache_creation),
				cache_read = MAX(cache_read, excluded.cache_read),
				cache_creation_1h = MAX(cache_creation_1h, excluded.cache_creation_1h),
				cache_creation_5m = MAX(cache_creation_5m, excluded.cache_creation_5m),
				web_search_requests = MAX(web_search_requests, excluded.web_search_requests),
				web_fetch_requests = MAX(web_fetch_requests, excluded.web_fetch_requests),
				requests = MAX(requests, excluded.requests),
				cost = MAX(cost, excluded.cost),
				cost_unknown_requests = MAX(cost_unknown_requests, excluded.cost_unknown_requests)
		`);
		const upsertSession = db.prepare(`
			INSERT INTO session (
				session_id, provider, project, first_ts, last_ts,
				input, output, cache_creation, cache_read, requests, cost, cost_unknown_requests, models
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (session_id, provider) DO UPDATE SET
				last_ts = MAX(last_ts, excluded.last_ts),
				input = MAX(input, excluded.input),
				output = MAX(output, excluded.output),
				cache_creation = MAX(cache_creation, excluded.cache_creation),
				cache_read = MAX(cache_read, excluded.cache_read),
				requests = MAX(requests, excluded.requests),
				cost = MAX(cost, excluded.cost),
				cost_unknown_requests = MAX(cost_unknown_requests, excluded.cost_unknown_requests),
				models = excluded.models
		`);

		db.exec('BEGIN');
		try {
			for (const aggregate of aggregates) {
				if (aggregate.provider !== provider) continue;
				upsertAgg.run(
					aggregate.day, aggregate.provider, aggregate.model,
					aggregate.tokens.input, aggregate.tokens.output,
					aggregate.tokens.cacheCreation, aggregate.tokens.cacheRead,
					aggregate.cacheCreation1h, aggregate.cacheCreation5m,
					aggregate.webSearchRequests, aggregate.webFetchRequests,
					aggregate.requests, aggregate.cost, aggregate.costUnknownRequests
				);
			}
			for (const session of sessions) {
				if (session.provider !== provider || session.project !== '(Tokenmaxx background)') continue;
				upsertSession.run(
					session.sessionId, session.provider, session.project,
					session.firstTs, session.lastTs,
					session.tokens.input, session.tokens.output,
					session.tokens.cacheCreation, session.tokens.cacheRead,
					session.requests, session.cost, session.costUnknownRequests,
					JSON.stringify(session.models)
				);
			}
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}

	/**
	 * Freeze a batch of newly-complete past days in a single transaction. `days` is the
	 * set of days being frozen; `aggregates` / `sessions` are the rows to upsert (callers
	 * pass only the rows belonging to those days). Upsert (INSERT OR REPLACE) keeps this
	 * idempotent if a day is somehow re-frozen.
	 */
	freezeDays(
		days: Iterable<string>,
		aggregates: readonly FrozenAgg[],
		sessions: readonly SessionSummary[]
	): void {
		const db = this.require();
		const dayList = [...days];
		if (dayList.length === 0) return;

		const upsertAgg = db.prepare(`
			INSERT OR REPLACE INTO day_model_agg (
				day, provider, model, input, output, cache_creation, cache_read,
				cache_creation_1h, cache_creation_5m, web_search_requests, web_fetch_requests,
				requests, cost, cost_unknown_requests
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const upsertSession = db.prepare(`
			INSERT OR REPLACE INTO session (
				session_id, provider, project, first_ts, last_ts,
				input, output, cache_creation, cache_read, requests, cost, cost_unknown_requests, models
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		db.exec('BEGIN');
		try {
			for (const a of aggregates) {
				upsertAgg.run(
					a.day,
					a.provider,
					a.model,
					a.tokens.input,
					a.tokens.output,
					a.tokens.cacheCreation,
					a.tokens.cacheRead,
					a.cacheCreation1h,
					a.cacheCreation5m,
					a.webSearchRequests,
					a.webFetchRequests,
					a.requests,
					a.cost,
					a.costUnknownRequests
				);
			}
			for (const s of sessions) {
				upsertSession.run(
					s.sessionId,
					s.provider,
					s.project,
					s.firstTs,
					s.lastTs,
					s.tokens.input,
					s.tokens.output,
					s.tokens.cacheCreation,
					s.tokens.cacheRead,
					s.requests,
					s.cost,
					s.costUnknownRequests,
					JSON.stringify(s.models)
				);
			}
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	}

	/** The record itself is the durable contribution; restart replays it exactly once. */
	retainValuation(record: UsageRecord): void {
		this.require().prepare(`INSERT OR IGNORE INTO valuation
			(scope_key, day, provider, model, session_id, record) VALUES (?, ?, ?, ?, ?, ?)`)
			.run(`${record.provider}\u001f${record.key}`, record.day, record.provider, record.model, record.sessionId, JSON.stringify(record));
	}

	retainWrappedEvidence(record: UsageRecord): void {
		if (record.key.startsWith('cursor:') || !record.sessionId) return;
		this.require().prepare(`INSERT INTO wrapped_evidence
			(provider, record_key, day, session_id, project, cost) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(provider, record_key) DO NOTHING`)
			.run(record.provider, record.key, record.day, record.sessionId, record.project, record.cost);
	}

	loadWrappedEvidence(): { provider: string; sessionId: string; activity: import('@chaching/shared/types').SessionDay[] }[] {
		const groups = new Map<string, { provider: string; sessionId: string; activity: import('@chaching/shared/types').SessionDay[] }>();
		for (const row of this.require().prepare(`SELECT provider, session_id, day, project,
			COUNT(*) AS requests, COALESCE(SUM(cost), 0) AS cost, SUM(cost IS NULL) AS unknown
			FROM wrapped_evidence GROUP BY provider, session_id, day, project`).all()) {
			const provider = stringValue(row.provider), sessionId = stringValue(row.session_id);
			const key = JSON.stringify([provider, sessionId]);
			const group = groups.get(key) ?? { provider, sessionId, activity: [] };
			group.activity.push({ day: stringValue(row.day), project: stringValue(row.project), requests: numberValue(row.requests), cost: numberValue(row.cost), costUnknownRequests: numberValue(row.unknown) });
			groups.set(key, group);
		}
		return [...groups.values()];
	}

	loadValuations(): UsageRecord[] {
		return this.require().prepare('SELECT record FROM valuation ORDER BY day, scope_key').all().map(row => {
			if (typeof row.record !== 'string') throw new Error('Invalid durable valuation');
			const value: unknown = JSON.parse(row.record);
			if (!isUsageRecord(value)) throw new Error('Invalid durable valuation');
			return value;
		});
	}

	pendingPricingPublication(): number | null {
		const row = this.require().prepare('SELECT generation FROM pricing_publication WHERE id = 1').get();
		return row && typeof row.generation === 'number' ? row.generation : null;
	}

	acknowledgePricingPublication(generation: number): void {
		this.require().prepare('DELETE FROM pricing_publication WHERE id = 1 AND generation = ?').run(generation);
	}

	/** Compare-and-replace eligibility and frozen money in the same commit. */
	correctValuations(repairs: readonly { before: UsageRecord; after: UsageRecord }[]): void {
		if (repairs.length === 0) return;
		const db = this.require();
		db.exec('BEGIN IMMEDIATE');
		try {
			for (const { before, after } of repairs) {
				const result = db.prepare("UPDATE valuation SET record = ? WHERE scope_key = ? AND json_extract(record, '$.valuation') = ? AND json_extract(record, '$.valuation.kind') IN ('missing', 'estimated')")
					.run(JSON.stringify(after), `${before.provider}\u001f${before.key}`, JSON.stringify(before.valuation));
				if (result.changes !== 1) throw new Error('Valuation changed during correction');
				db.prepare('UPDATE wrapped_evidence SET cost = ? WHERE provider = ? AND record_key = ?').run(after.cost, after.provider, after.key);
				const delta = (after.cost ?? 0) - (before.cost ?? 0);
				const unknown = Number(after.cost == null) - Number(before.cost == null);
				db.prepare(`UPDATE day_model_agg SET cost = cost + ?, cost_unknown_requests = cost_unknown_requests + ?
					WHERE day = ? AND provider = ? AND model = ?`).run(delta, unknown, before.day, before.provider, before.model);
				db.prepare(`UPDATE session SET cost = cost + ?, cost_unknown_requests = cost_unknown_requests + ?
					WHERE session_id = ? AND provider = ? AND last_ts >= ?`).run(delta, unknown, before.sessionId, before.provider, before.timestamp);
			}
			db.prepare(`INSERT INTO meta (key, value) VALUES ('pricing_generation', '1')
				ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run();
			db.prepare(`INSERT INTO pricing_publication SELECT 1, CAST(value AS INTEGER) FROM meta WHERE key = 'pricing_generation'
				ON CONFLICT(id) DO UPDATE SET generation = excluded.generation`).run();
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}

	close(): void {
		if (!this.db) return;
		try {
			this.db.close();
		} finally {
			this.db = null;
		}
	}
}

function rowToAgg(row: Record<string, unknown>): FrozenAgg {
	const tokens: TokenCounts = {
		input: numberValue(row.input),
		output: numberValue(row.output),
		cacheCreation: numberValue(row.cache_creation),
		cacheRead: numberValue(row.cache_read)
	};
	return {
		day: stringValue(row.day),
		provider: stringValue(row.provider),
		model: stringValue(row.model),
		tokens,
		requests: numberValue(row.requests),
		cost: numberValue(row.cost),
		costUnknownRequests: numberValue(row.cost_unknown_requests),
		cacheCreation1h: numberValue(row.cache_creation_1h),
		cacheCreation5m: numberValue(row.cache_creation_5m),
		webSearchRequests: numberValue(row.web_search_requests),
		webFetchRequests: numberValue(row.web_fetch_requests)
	};
}

function rowToSession(row: Record<string, unknown>): SessionSummary {
	const tokens: TokenCounts = {
		input: numberValue(row.input),
		output: numberValue(row.output),
		cacheCreation: numberValue(row.cache_creation),
		cacheRead: numberValue(row.cache_read)
	};
	return {
		sessionId: stringValue(row.session_id),
		provider: stringValue(row.provider),
		project: stringValue(row.project),
		firstTs: numberValue(row.first_ts),
		lastTs: numberValue(row.last_ts),
		tokens,
		requests: numberValue(row.requests),
		cost: numberValue(row.cost),
		costUnknownRequests: numberValue(row.cost_unknown_requests),
		models: parseModels(row.models)
	};
}

function parseModels(raw: unknown): string[] {
	if (typeof raw !== 'string') return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.filter((m): m is string => typeof m === 'string');
		return [];
	} catch {
		return [];
	}
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function isUsageRecord(value: unknown): value is UsageRecord {
	if (typeof value !== 'object' || value === null) return false;
	for (const key of ['key', 'provider', 'day', 'model', 'sessionId', 'project']) {
		if (!(key in value) || typeof Reflect.get(value, key) !== 'string') return false;
	}
	for (const key of ['timestamp', 'cacheCreation1h', 'cacheCreation5m', 'webSearchRequests', 'webFetchRequests']) {
		const item: unknown = Reflect.get(value, key);
		if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) return false;
	}
	if (!('tokens' in value) || typeof value.tokens !== 'object' || value.tokens === null) return false;
	for (const key of ['input', 'output', 'cacheCreation', 'cacheRead']) {
		const item: unknown = Reflect.get(value.tokens, key);
		if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) return false;
	}
	if (!('cost' in value) || !(value.cost === null || (typeof value.cost === 'number' && Number.isFinite(value.cost) && value.cost >= 0))) return false;
	for (const key of ['billingProvider', 'machineId', 'accountId']) {
		const item: unknown = Reflect.get(value, key);
		if (item !== undefined && item !== null && typeof item !== 'string') return false;
	}
	if ('promptTokens' in value && !(typeof value.promptTokens === 'number' && Number.isFinite(value.promptTokens) && value.promptTokens >= 0)) return false;
	if ('reportedCost' in value && typeof value.reportedCost !== 'boolean') return false;
	if ('valuation' in value && !isValuation(value.valuation)) return false;
	return 'isSidechain' in value && typeof value.isSidechain === 'boolean';
}

function isValuation(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	for (const key of ['revision', 'provider', 'model']) if (typeof Reflect.get(value, key) !== 'string') return false;
	if (!('kind' in value) || !('cost' in value)) return false;
	if (value.kind === 'missing') return value.cost === null;
	if (value.kind !== 'exact' && value.kind !== 'estimated') return false;
	if (typeof value.cost !== 'number' || !Number.isFinite(value.cost) || value.cost < 0) return false;
	if (!('source' in value) || !['override', 'litellm', 'modelsdev'].includes(String(value.source))) return false;
	for (const [key, fields] of [
		['components', ['input', 'output', 'cacheCreation', 'cacheRead', 'tools']],
		['price', ['input_cost_per_token', 'output_cost_per_token', 'cache_creation_input_token_cost', 'cache_read_input_token_cost']]
	] satisfies [string, string[]][]) {
		const row: unknown = Reflect.get(value, key);
		if (typeof row !== 'object' || row === null) return false;
		for (const field of fields) {
			const amount: unknown = Reflect.get(row, field);
			if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return false;
		}
	}
	return true;
}
