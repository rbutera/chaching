// Local SQLite historical store. Persists finalized PAST-day aggregates + sessions so
// they survive the source logs being pruned (Claude Code prunes ~30 days). Uses the
// freeze-past-days model: a day < today (UTC) is frozen into the DB exactly once, when
// it first appears as a complete past day. Past-day logs never change, so freezing is
// safe and the DB copy is authoritative thereafter (later logs may be pruned/partial).
//
// Built on Node's built-in `node:sqlite` (matches the OpenCode provider). chaching
// requires Node `>=24.16.0`. WAL mode for crash-safety on the writer.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionSummary, TokenCounts } from '../../types';
import type { FrozenAgg } from '../rollup/rollup';

const SCHEMA_VERSION = 1;

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
		db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)`).run(
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
