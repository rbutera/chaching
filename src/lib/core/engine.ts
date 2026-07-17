// Framework-free ingestion engine. ONE cold scan per engine (not per request),
// then per-provider liveness: claude is tailed via fs.watch (recursive) + an
// mtime-poll fallback; codex + opencode are re-polled incrementally on an interval
// (mtime-gated, dedup makes overlap safe); cursor polls its Admin API. Maintains
// the Rollup and fans deltas out to subscribers. Both the SvelteKit server and the
// CLI consume this in-process.

import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { hostname } from 'node:os';
import { Rollup } from './rollup/rollup';
import { DedupSet } from './ingest/dedup';
import { discoverFiles, resolveProjectsDirs } from './ingest/discover';
import { ingestRange, type FileState } from './watch/tail';
import { loadConfig, type chachingConfig, type CursorProviderConfig } from './config';
import { expandPath, safeMtime } from './fs-utils';
import { isoDayUTC } from './ingest/parse';
import { HistoryStore } from './history/store';
import { ProviderStatus } from './provider-status';
import { readCodexRecords } from './providers/codex/local';
import { readPiRecords } from './providers/pi/local';
import { readOpenCodeSessions } from './providers/opencode/sqlite';
import { fetchCursorUsageRecords } from './providers/cursor/api';
import type { RollupDelta, RollupSnapshot, UsageRecord } from '../types';
import { isConfigured } from './sync/manager';
import { isPoolGlobalUsage, usageDedupKey } from './sync/record-key';
import { PostgresSyncStore } from './sync/store';

const MTIME_POLL_MS = 4000; // fallback poll cadence
const DELTA_DEBOUNCE_MS = 400; // coalesce bursts of file changes into one delta
// Codex/OpenCode re-poll cadence. These providers have no tail path (codex rewrites
// whole-turn snapshots, opencode is a SQLite db), so a long-running serve/TUI would
// otherwise show them frozen at cold-scan time forever. 15s keeps "live" honest
// without meaningful I/O: codex re-parses only mtime-fresh files, opencode re-reads
// only when the db (or its -wal) mtime moved.
const LOCAL_PROVIDER_POLL_MS = 15_000;
// Re-read margin for the codex incremental scan: mtime granularity + writes that
// land while a scan is in flight. Overlap is free (dedup), a miss is not.
const CODEX_RESCAN_MARGIN_MS = 60_000;

type DeltaListener = (delta: RollupDelta) => void;

export interface EngineStats {
	coldScanMs: number;
	files: number;
	providerErrors: ReturnType<ProviderStatus['snapshot']>;
}

export interface Engine {
	ensureStarted(): Promise<void>;
	snapshot(): RollupSnapshot;
	subscribe(fn: DeltaListener): () => void;
	setCutover(ts: number | null): void;
	dispose(): void;
	readonly stats: EngineStats;
}

class Ingestion {
	private rollup = new Rollup();
	private dedup = new DedupSet();
	private fileStates = new Map<string, FileState>(); // path -> {offset,...}
	private fileToProjectsDir = new Map<string, string>(); // path -> owning projects dir
	private projectsDirs: string[] = [];
	private watchers: FSWatcher[] = [];
	private mtimes = new Map<string, number>();
	private pollTimer: NodeJS.Timeout | null = null;
	private cursorTimer: NodeJS.Timeout | null = null;
	private localProviderTimer: NodeJS.Timeout | null = null;
	private syncTimer: NodeJS.Timeout | null = null;
	private localPollInFlight = false;
	private syncPollInFlight = false;
	/** codex session files already counted in stats.filesScanned (re-polls don't re-count) */
	private codexSeenFiles = new Set<string>();
	/** incremental floor for the next codex re-poll (wall clock, NOT the `now` seam) */
	private codexScanSince = 0;
	/** pi (and omp) session files already counted in stats.filesScanned (re-polls don't re-count) */
	private piSeenFiles = new Set<string>();
	/** incremental floor for the next pi re-poll (wall clock, NOT the `now` seam) */
	private piScanSince = 0;
	/** opencode source stamp (db + -wal mtime) at last ingest; re-ingest only on change */
	private opencodeSourceMtime = -1;
	private opencodeCounted = false;
	private deltaTimer: NodeJS.Timeout | null = null;
	private listeners = new Set<DeltaListener>();
	private ready: Promise<void> | null = null;
	private coldScanMs = 0;
	private pendingChanges = new Set<string>();
	private claudeEnv: NodeJS.ProcessEnv | null = null;
	private providerStatus = new ProviderStatus();
	private disposed = false;
	private historyStore: HistoryStore | null = null;
	private syncStore: PostgresSyncStore | null = null;
	private syncCursor = 0;
	private syncQueue: UsageRecord[] = [];
	private syncFlush: Promise<boolean> | null = null;
	private syncMappings: Record<string, string | null> = {};
	private syncMappingFingerprint = '[]';
	/** any read/parse failure during the cold scan makes a day potentially partial -> don't freeze. */
	private scanHadErrors = false;
	/** resolved config, captured in start() for the live (tail/poll) freeze path. */
	private resolvedConfig: chachingConfig | null = null;

	constructor(
		private config: chachingConfig | null,
		private watchEnabled: boolean,
		/** clock seam: epoch ms used to compute "today" (UTC). Defaults to wall clock. */
		private now: () => number = Date.now
	) {}

	/** Idempotent: kicks off the cold scan + watchers once. */
	ensureStarted(): Promise<void> {
		if (!this.ready) this.ready = this.start();
		return this.ready;
	}

	private async start(): Promise<void> {
		const t0 = Date.now();
		const cfg = this.config ?? (await loadConfig());
		this.resolvedConfig = cfg;
		this.rollup.setCutover(cfg.cutoverTs);

		// History: seed the rollup with frozen past-day aggregates + mark those days so the
		// live scan skips them (no double-count). MUST happen before any rollup.add call.
		if (isConfigured(cfg.sync)) await this.loadSync(cfg);
		else this.loadHistory(cfg);

		const claudeEnv = {
			...process.env,
			CLAUDE_CONFIG_DIR: cfg.providers.claude.roots.map(expandPath).join(',')
		};
		this.claudeEnv = cfg.providers.claude.enabled ? claudeEnv : null;
		this.projectsDirs = cfg.providers.claude.enabled ? await resolveProjectsDirs(claudeEnv) : [];
		const files = cfg.providers.claude.enabled ? await discoverFiles(claudeEnv) : [];

		// cold scan: stream each file once to EOF, recording its offset.
		for (const f of files) {
			const projectsDir = this.owningProjectsDir(f.path);
			this.fileToProjectsDir.set(f.path, projectsDir);
			this.rollup.markFileScanned();
			try {
				const newOffset = await ingestRange(
					f.path,
					0,
					projectsDir,
					this.rollup,
					this.dedup,
					this.syncHooks()
				);
				this.fileStates.set(f.path, {
					offset: newOffset,
					project: f.project,
					isSidechain: f.isSidechain
				});
				const m = await safeMtime(f.path);
				if (m != null) this.mtimes.set(f.path, m);
			} catch {
				// skip unreadable file; keep scanning. But a missed file may make a past
				// day partial, so don't freeze this run (freeze on a later clean run).
				this.scanHadErrors = true;
			}
		}

		if (cfg.providers.codex.enabled) {
			await this.ingestCodex(expandPath(cfg.providers.codex.root));
		}

		if (cfg.providers.opencode.enabled) {
			await this.ingestOpenCode(expandPath(cfg.providers.opencode.dbPath));
		}

		if (cfg.providers.pi.enabled) {
			await this.ingestPi(expandPath(cfg.providers.pi.root));
		}

		// Env-first: if the token is absent from config, fall back to the env var so
		// users who source the token from the environment don't have to store it in the file.
		const cursorToken =
			cfg.providers.cursor.adminApiToken || process.env.CURSOR_ADMIN_API_TOKEN || '';
		if (cfg.providers.cursor.enabled && cursorToken) {
			const cursorCfgWithToken = { ...cfg.providers.cursor, adminApiToken: cursorToken };
			await this.ingestCursor(cursorToken, cfg.providers.cursor.email);
			if (this.watchEnabled && !this.disposed) this.startCursorPolling(cursorCfgWithToken);
		}

		await this.flushSyncQueue();
		await this.pullSyncRecords();

		// Freeze newly-complete past days (day < today, scanned, not already frozen).
		if (!this.syncStore) this.freezeNewDays(cfg);

		this.coldScanMs = Date.now() - t0;
		if (this.watchEnabled && !this.disposed) {
			this.startWatching();
			this.startLocalProviderPolling(cfg);
			this.startSyncPolling(cfg);
		}
	}

	private async loadSync(cfg: chachingConfig): Promise<void> {
		if (!isConfigured(cfg.sync)) return;
		const store = new PostgresSyncStore(
			cfg.sync.databaseUrl,
			cfg.sync.poolId,
			cfg.sync.machineId
		);
		try {
			await store.open();
			await store.heartbeat(cfg.sync.machineName, hostname());
			this.syncMappings = await store.mappedSubscriptions();
			this.syncMappingFingerprint = await store.mappingFingerprint();
			const imported = await store.loadImportedHistory();
			this.rollup.loadAggregates(imported.aggregates, imported.sessions);
			this.rollup.setImportedMachineDays(
				imported.aggregates.flatMap((aggregate) =>
					aggregate.machineId ? [{ machineId: aggregate.machineId, day: aggregate.day }] : []
				)
			);
			this.rollup.setImportedCursorDays(
				imported.aggregates.flatMap((aggregate) =>
					aggregate.provider === 'cursor' ? [{ provider: aggregate.provider, day: aggregate.day }] : []
				)
			);
			const loaded = await store.loadAllRecords();
			this.syncCursor = loaded.cursor;
			const durableDays = new Set(imported.aggregates.map((aggregate) => aggregate.day));
			const today = isoDayUTC(this.now());
			for (const { record } of loaded.records) {
				if (!this.dedup.add(usageDedupKey(record))) continue;
				this.rollup.add(record);
				if (record.day < today) durableDays.add(record.day);
			}
			this.rollup.setDurableDays(durableDays);
			this.rollup.clearDirty();
			this.syncStore = store;
			this.providerStatus.clear('sync');
		} catch (error) {
			this.providerStatus.recordError('sync', error);
			void store.close().catch(() => {});
			this.syncStore = null;
			// Sync is configured but unreachable. Fall back to the retained local SQLite
			// frozen history so the rollup still seeds every past day instead of only the
			// live-log window (~30 days) — local-first, not PG-dependent (B1). Reset the
			// rollup/dedup first so a partially-applied loadSync can't compound with the
			// local aggregates. The recorded sync error keeps scanIsPartial() true, so
			// freezeNewDays() stays blocked this run and no partial copy is locked in.
			this.rollup = new Rollup();
			this.dedup = new DedupSet();
			this.rollup.setCutover(cfg.cutoverTs);
			this.loadHistory(cfg);
		}
	}

	/** Open the history DB and seed the rollup with frozen aggregates + sessions. */
	private loadHistory(cfg: chachingConfig): void {
		if (!cfg.history.enabled) return;
		try {
			const store = new HistoryStore();
			store.open(expandPath(cfg.history.dbPath));
			this.historyStore = store;
			const frozen = store.frozenDays();
			this.rollup.setFrozenDays(frozen);
			this.rollup.loadAggregates(store.loadAggregates(), store.loadSessions());
		} catch (error) {
			this.providerStatus.recordError('history', error);
			if (this.historyStore) {
				this.historyStore.close();
				this.historyStore = null;
			}
		}
	}

	/**
	 * The freeze-gating partial signal: true when THIS scan had an unreadable file or any
	 * provider ingest error, so a past day may be incomplete and must NOT be frozen yet.
	 * The SINGLE source of "partial" — shared by `freezeNewDays()` (what is safe to finalize)
	 * and the coverage path (what to mark `partial`), so the two can never drift (design D2).
	 */
	private scanIsPartial(): boolean {
		if (this.scanHadErrors) return true;
		for (const msg of Object.values(this.providerStatus.snapshot())) {
			if (msg) return true; // a provider failed to ingest -> a day may be partial
		}
		return false;
	}

	/** Freeze each past day (day < today UTC) that was scanned and is not yet frozen. */
	private freezeNewDays(cfg: chachingConfig): void {
		if (!cfg.history.enabled || !this.historyStore) return;
		// A partial scan (unreadable file, provider error) may leave a past day incomplete.
		// Freezing it would lock in the partial copy forever, so skip freezing this run and
		// let a later clean run capture the complete day.
		if (this.scanIsPartial()) return;
		const today = isoDayUTC(this.now());
		const frozen = this.rollup.frozenDaySet();
		const newDays = new Set<string>();
		for (const day of this.rollup.scannedDays()) {
			if (day < today && !frozen.has(day)) newDays.add(day);
		}
		if (newDays.size === 0) return;
		try {
			const { aggregates, sessions } = this.rollup.freezeCandidates(newDays);
			this.historyStore.freezeDays(newDays, aggregates, sessions);
			// Mark them frozen in-memory too, so a subsequent live tail for these days is skipped.
			this.rollup.setFrozenDays(newDays);
		} catch (error) {
			this.providerStatus.recordError('history', error);
		}
	}

	private async ingestCodex(root: string, modifiedSince?: number): Promise<void> {
		try {
			// Wall clock on purpose: mtimes are wall-clock facts, so the incremental
			// floor must not run through the `now` seam tests fake for "today".
			const scanStart = Date.now();
			const result = await readCodexRecords(root, { modifiedSince });
			for (const file of result.files) {
				if (this.codexSeenFiles.has(file)) continue;
				this.codexSeenFiles.add(file);
				this.rollup.markFileScanned();
			}
			this.addProviderRecords(result.records);
			this.codexScanSince = scanStart - CODEX_RESCAN_MARGIN_MS;
			const [firstError] = result.errors;
			if (firstError) this.providerStatus.recordMessage('codex', firstError);
			else this.providerStatus.clear('codex');
		} catch (error) {
			this.providerStatus.recordError('codex', error);
			return;
		}
	}

	private async ingestPi(root: string, modifiedSince?: number): Promise<void> {
		try {
			// Wall clock on purpose (same rationale as codex): the incremental floor is
			// an mtime fact and must not run through the `now` seam tests fake for "today".
			const scanStart = Date.now();
			const result = await readPiRecords(root, { modifiedSince });
			for (const file of result.files) {
				if (this.piSeenFiles.has(file)) continue;
				this.piSeenFiles.add(file);
				this.rollup.markFileScanned();
			}
			this.addProviderRecords(result.records);
			this.piScanSince = scanStart - CODEX_RESCAN_MARGIN_MS;
			const [firstError] = result.errors;
			if (firstError) this.providerStatus.recordMessage('pi', firstError);
			else this.providerStatus.clear('pi');
		} catch (error) {
			this.providerStatus.recordError('pi', error);
			return;
		}
	}

	private async ingestOpenCode(dbPath: string): Promise<void> {
		try {
			// Stamp BEFORE reading: a write that lands mid-read moves the mtime past
			// this stamp, so the next poll re-ingests it (dedup absorbs the overlap).
			const stamp = await this.opencodeSourceStamp(dbPath);
			if (!this.opencodeCounted) {
				this.rollup.markFileScanned();
				this.opencodeCounted = true;
			}
			const records = await readOpenCodeSessions(dbPath);
			this.addProviderRecords(records);
			this.opencodeSourceMtime = stamp;
			this.providerStatus.clear('opencode');
		} catch (error) {
			this.providerStatus.recordError('opencode', error);
			return;
		}
	}

	/** Latest mtime across the OpenCode db and its WAL (WAL writes may not touch the db file). */
	private async opencodeSourceStamp(dbPath: string): Promise<number> {
		let latest = -1;
		for (const p of [dbPath, `${dbPath}-wal`]) {
			const m = await safeMtime(p);
			if (m != null && m > latest) latest = m;
		}
		return latest;
	}

	private async ingestCursor(adminApiToken: string, email: string | null): Promise<void> {
		try {
			const endDate = Date.now();
			const startDate = endDate - 30 * 24 * 60 * 60 * 1000;
			const records = await fetchCursorUsageRecords({
				adminApiToken,
				startDate,
				endDate,
				email: email ?? undefined,
				pageSize: 100
			});
			this.addProviderRecords(records);
			this.providerStatus.clear('cursor');
		} catch (error) {
			this.providerStatus.recordError('cursor', error);
			return;
		}
	}

	private addProviderRecords(records: readonly UsageRecord[]): void {
		for (const raw of records) {
			const rec = this.prepareLocalRecord(raw);
			if (this.syncStore && isPoolGlobalUsage(rec)) {
				// The database chooses one authoritative copy of cloud-account events.
				// pullSyncRecords() adds that winning row to every machine's rollup.
				this.syncQueue.push(rec);
				continue;
			}
			if (!this.dedup.add(usageDedupKey(rec))) {
				this.rollup.addDuplicate();
				continue;
			}
			this.rollup.add(rec);
			if (this.syncStore) this.syncQueue.push(rec);
		}
	}

	private prepareLocalRecord(record: UsageRecord): UsageRecord {
		const cfg = this.resolvedConfig;
		if (!cfg || !isConfigured(cfg.sync)) return record;
		return {
			...record,
			machineId: cfg.sync.machineId,
			subscriptionId: this.syncMappings[record.provider] ?? null
		};
	}

	private syncHooks() {
		if (!this.syncStore) return {};
		return {
			prepare: (record: UsageRecord) => this.prepareLocalRecord(record),
			onAdded: (record: UsageRecord) => this.syncQueue.push(record)
		};
	}

	/** Resolves true only when the queue drained completely (nothing left un-inserted). */
	private async flushSyncQueue(): Promise<boolean> {
		if (this.syncFlush) return this.syncFlush;
		const task = this.drainSyncQueue();
		this.syncFlush = task;
		try {
			return await task;
		} finally {
			if (this.syncFlush === task) this.syncFlush = null;
		}
	}

	/** Returns false (and records the sync error) if a batch failed to insert. */
	private async drainSyncQueue(): Promise<boolean> {
		if (!this.syncStore) return true;
		while (this.syncQueue.length > 0) {
			// Remove before awaiting so producers append behind this in-flight batch.
			// On failure, restore exactly this batch at the front for idempotent retry.
			const pending = this.syncQueue.splice(0);
			try {
				await this.syncStore.insertRecords(pending);
				const today = isoDayUTC(this.now());
				this.rollup.setDurableDays(pending.filter((r) => r.day < today).map((r) => r.day));
				this.providerStatus.clear('sync');
			} catch (error) {
				this.syncQueue.unshift(...pending);
				this.providerStatus.recordError('sync', error);
				return false;
			}
		}
		return true;
	}

	/**
	 * Liveness for the cold-scan-only local providers (codex sessions, opencode db).
	 * Unlike claude there is no line-tail path — codex rewrites whole-turn snapshot
	 * lines and opencode is a SQLite db — so a long-running serve/TUI re-polls them:
	 * codex re-parses only mtime-fresh session files (dedup absorbs overlap),
	 * opencode re-reads only when the db/-wal mtime moved.
	 */
	private startLocalProviderPolling(cfg: chachingConfig): void {
		if (this.localProviderTimer) return;
		if (
			!cfg.providers.codex.enabled &&
			!cfg.providers.opencode.enabled &&
			!cfg.providers.pi.enabled
		)
			return;
		this.localProviderTimer = setInterval(
			() => void this.pollLocalProviders(cfg),
			LOCAL_PROVIDER_POLL_MS
		);
		if (this.localProviderTimer.unref) this.localProviderTimer.unref();
	}

	private async pollLocalProviders(cfg: chachingConfig): Promise<void> {
		if (this.disposed || this.localPollInFlight) return;
		this.localPollInFlight = true;
		try {
			if (cfg.providers.codex.enabled) {
				await this.ingestCodex(expandPath(cfg.providers.codex.root), this.codexScanSince);
			}
			if (cfg.providers.pi.enabled) {
				await this.ingestPi(expandPath(cfg.providers.pi.root), this.piScanSince);
			}
			if (cfg.providers.opencode.enabled) {
				const dbPath = expandPath(cfg.providers.opencode.dbPath);
				const stamp = await this.opencodeSourceStamp(dbPath);
				if (stamp > this.opencodeSourceMtime) await this.ingestOpenCode(dbPath);
			}
			await this.flushSyncQueue();
			if (this.disposed) return;
			if (!this.syncStore) this.maybeFreezeLive();
			if (this.rollup.hasDirty()) {
				const delta = this.rollup.drainDelta(this.now(), this.coverageInput());
				if (delta) for (const fn of this.listeners) fn(delta);
			}
		} finally {
			this.localPollInFlight = false;
		}
	}

	private startSyncPolling(cfg: chachingConfig): void {
		if (!this.syncStore || this.syncTimer || !isConfigured(cfg.sync)) return;
		this.syncTimer = setInterval(() => void this.pollSync(cfg), LOCAL_PROVIDER_POLL_MS);
		if (this.syncTimer.unref) this.syncTimer.unref();
	}

	private async pollSync(cfg: chachingConfig): Promise<void> {
		if (this.disposed || !this.syncStore || !isConfigured(cfg.sync)) return;
		// A hung PG must not pile up overlapping 15s ticks (mirrors localPollInFlight).
		if (this.syncPollInFlight) return;
		this.syncPollInFlight = true;
		try {
			// Only a fully-drained queue lets us report sync healthy at the end of the
			// tick. A failed drain records the error inside drainSyncQueue; clearing it
			// below would lie about liveness while the outbound queue keeps growing.
			const drained = await this.flushSyncQueue();
			const mappings = await this.syncStore.mappedSubscriptions();
			const fingerprint = await this.syncStore.mappingFingerprint();
			if (
				this.syncMappingFingerprint !== fingerprint ||
				!sameMappings(this.syncMappings, mappings)
			) {
				this.syncMappings = mappings;
				this.syncMappingFingerprint = fingerprint;
				await this.reloadSyncRollup();
			} else {
				await this.pullSyncRecords();
			}
			await this.syncStore.heartbeat(cfg.sync.machineName, hostname());
			if (drained) this.providerStatus.clear('sync');
			if (this.rollup.hasDirty()) {
				const delta = this.rollup.drainDelta(this.now(), this.coverageInput());
				if (delta) for (const fn of this.listeners) fn(delta);
			}
		} catch (error) {
			this.providerStatus.recordError('sync', error);
		} finally {
			this.syncPollInFlight = false;
		}
	}

	private async pullSyncRecords(): Promise<void> {
		if (!this.syncStore) return;
		const incoming = await this.syncStore.recordsSince(this.syncCursor);
		const today = isoDayUTC(this.now());
		const durableDays = new Set<string>();
		for (const stored of incoming) {
			this.syncCursor = Math.max(this.syncCursor, stored.cursor);
			if (!this.dedup.add(usageDedupKey(stored.record))) {
				this.rollup.addDuplicate();
				continue;
			}
			this.rollup.add(stored.record);
			if (stored.record.day < today) durableDays.add(stored.record.day);
		}
		this.rollup.setDurableDays(durableDays);
	}

	private async reloadSyncRollup(): Promise<void> {
		if (!this.syncStore) return;
		const nextRollup = new Rollup();
		const nextDedup = new DedupSet();
		nextRollup.setCutover(this.resolvedConfig?.cutoverTs ?? null);
		const imported = await this.syncStore.loadImportedHistory();
		nextRollup.loadAggregates(imported.aggregates, imported.sessions);
		nextRollup.setImportedMachineDays(
			imported.aggregates.flatMap((aggregate) =>
				aggregate.machineId ? [{ machineId: aggregate.machineId, day: aggregate.day }] : []
			)
		);
		nextRollup.setImportedCursorDays(
			imported.aggregates.flatMap((aggregate) =>
				aggregate.provider === 'cursor' ? [{ provider: aggregate.provider, day: aggregate.day }] : []
			)
		);
		const loaded = await this.syncStore.loadAllRecords();
		const today = isoDayUTC(this.now());
		const durableDays = new Set(imported.aggregates.map((aggregate) => aggregate.day));
		for (const { record } of loaded.records) {
			if (!nextDedup.add(usageDedupKey(record))) continue;
			nextRollup.add(record);
			if (record.day < today) durableDays.add(record.day);
		}
		nextRollup.setDurableDays(durableDays);
		nextRollup.clearDirty();
		this.rollup = nextRollup;
		this.dedup = nextDedup;
		this.syncCursor = loaded.cursor;
		const replacement = this.rollup.snapshot(this.now(), this.coverageInput());
		const delta: RollupDelta = { ...replacement, replace: replacement };
		for (const fn of this.listeners) fn(delta);
	}

	private startCursorPolling(cfg: CursorProviderConfig): void {
		if (this.cursorTimer || !cfg.adminApiToken) return;
		this.cursorTimer = setInterval(() => void this.pollCursor(cfg), cfg.pollSeconds * 1000);
		if (this.cursorTimer.unref) this.cursorTimer.unref();
	}

	private async pollCursor(cfg: CursorProviderConfig): Promise<void> {
		if (this.disposed) return;
		await this.ingestCursor(cfg.adminApiToken, cfg.email);
		await this.flushSyncQueue();
		if (this.disposed) return;
		if (!this.syncStore) this.maybeFreezeLive();
		if (this.rollup.hasDirty()) {
			const delta = this.rollup.drainDelta(this.now(), this.coverageInput());
			if (delta) for (const fn of this.listeners) fn(delta);
		}
	}

	private owningProjectsDir(filePath: string): string {
		for (const dir of this.projectsDirs) {
			if (filePath.startsWith(dir + sep)) return dir;
		}
		return this.projectsDirs[0] ?? '';
	}

	private startWatching(): void {
		// Recursive fs.watch on each projects dir. macOS supports recursive natively.
		for (const dir of this.projectsDirs) {
			try {
				const w = watch(dir, { recursive: true }, (_event, filename) => {
					if (!filename) return;
					const name = filename.toString();
					if (!name.endsWith('.jsonl')) return;
					const full = name.startsWith(dir) ? name : `${dir}${sep}${name}`;
					this.fileToProjectsDir.set(full, dir);
					this.queueChange(full);
				});
				this.watchers.push(w);
			} catch {
				// recursive watch unavailable on this volume -> rely on mtime poll
			}
		}
		// mtime-poll fallback (also catches anything fs.watch misses on network FS)
		this.pollTimer = setInterval(() => void this.pollMtimes(), MTIME_POLL_MS);
		if (this.pollTimer.unref) this.pollTimer.unref();
	}

	private queueChange(full: string): void {
		if (this.disposed) return;
		this.pendingChanges.add(full);
		if (this.deltaTimer) return;
		this.deltaTimer = setTimeout(() => void this.flushChanges(), DELTA_DEBOUNCE_MS);
		if (this.deltaTimer.unref) this.deltaTimer.unref();
	}

	private async flushChanges(): Promise<void> {
		this.deltaTimer = null;
		if (this.disposed) return;
		const paths = [...this.pendingChanges];
		this.pendingChanges.clear();

		for (const full of paths) {
			await this.tailFile(full);
		}

		if (this.disposed) return;
		// A long-running process can cross UTC midnight: yesterday becomes a complete past
		// day mid-run. Freeze it now so it persists even if logs are pruned before restart.
		if (!this.syncStore) this.maybeFreezeLive();
		if (this.rollup.hasDirty()) {
			const delta = this.rollup.drainDelta(this.now(), this.coverageInput());
			if (delta) for (const fn of this.listeners) fn(delta);
		}
	}

	/** Freeze any past day that just completed (used by the live tail/poll paths). */
	private maybeFreezeLive(): void {
		if (this.disposed || !this.resolvedConfig) return;
		this.freezeNewDays(this.resolvedConfig);
	}

	private async tailFile(full: string): Promise<void> {
		const projectsDir = this.fileToProjectsDir.get(full) ?? this.owningProjectsDir(full);
		const state = this.fileStates.get(full);
		const startOffset = state?.offset ?? 0;
		if (!state) this.rollup.markFileScanned();
		try {
			const newOffset = await ingestRange(
				full,
				startOffset,
				projectsDir,
				this.rollup,
				this.dedup,
				this.syncHooks()
			);
			await this.flushSyncQueue();
			const existing = this.fileStates.get(full);
			this.fileStates.set(full, {
				offset: newOffset,
				project: existing?.project ?? 'unknown',
				isSidechain: existing?.isSidechain ?? full.includes(`${sep}subagents${sep}`)
			});
			const m = await safeMtime(full);
			if (m != null) this.mtimes.set(full, m);
		} catch {
			// ignore unreadable/vanished file
		}
	}

	private async pollMtimes(): Promise<void> {
		// Re-discover so brand-new files are picked up even if fs.watch missed them.
		let changed = false;
		try {
			if (this.disposed || !this.claudeEnv) return;
			const files = await discoverFiles(this.claudeEnv);
			for (const f of files) {
				const m = await safeMtime(f.path);
				if (m == null) continue;
				const prev = this.mtimes.get(f.path);
				if (prev === undefined || m > prev) {
					this.fileToProjectsDir.set(f.path, this.owningProjectsDir(f.path));
					this.pendingChanges.add(f.path);
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		if (changed && !this.deltaTimer) {
			this.deltaTimer = setTimeout(() => void this.flushChanges(), DELTA_DEBOUNCE_MS);
			if (this.deltaTimer.unref) this.deltaTimer.unref();
		}
	}

	subscribe(fn: DeltaListener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/**
	 * The per-day coverage classification facts the rollup can't see (design D2): the
	 * canonical "today", this run's freeze-gating partial signal, and whether history (and
	 * so freezing) is enabled. Shared by the snapshot and every delta so the live dashboard's
	 * provenance stays correct after a delta (today flips missing->partial on its first row;
	 * a day frozen by maybeFreezeLive() flips partial->frozen).
	 */
	private coverageInput() {
		return {
			today: isoDayUTC(this.now()),
			scanPartial: this.scanIsPartial(),
			// History-disabled degrade rule (design D-risk): with no freeze, nothing is ever
			// `frozen`/`zero`, so a scanned past day with spend must NOT read `missing`. The
			// rollup treats available scanned data as authoritative-equivalent for display.
			historyEnabled: this.resolvedConfig?.history.enabled ?? false
		};
	}

	snapshot(): RollupSnapshot {
		return this.rollup.snapshot(this.now(), this.coverageInput());
	}

	setCutover(ts: number | null): void {
		this.rollup.setCutover(ts);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const w of this.watchers) {
			try {
				w.close();
			} catch {
				// already closed
			}
		}
		this.watchers = [];
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.cursorTimer) {
			clearInterval(this.cursorTimer);
			this.cursorTimer = null;
		}
		if (this.localProviderTimer) {
			clearInterval(this.localProviderTimer);
			this.localProviderTimer = null;
		}
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		if (this.deltaTimer) {
			clearTimeout(this.deltaTimer);
			this.deltaTimer = null;
		}
		if (this.historyStore) {
			this.historyStore.close();
			this.historyStore = null;
		}
		if (this.syncStore) {
			void this.syncStore.close().catch(() => {});
			this.syncStore = null;
		}
		this.listeners.clear();
	}

	get stats(): EngineStats {
		return {
			coldScanMs: this.coldScanMs,
			files: this.fileStates.size,
			providerErrors: this.providerStatus.snapshot()
		};
	}
}

/** Create a live engine: cold scan + watchers/polling, fans deltas to subscribers. */
export function createEngine(config?: chachingConfig | null, now?: () => number): Engine {
	return new Ingestion(config ?? null, true, now ?? Date.now);
}

/** One cold scan, resolve a snapshot, dispose all resources (no watchers/timers left). */
export async function runOnce(
	config?: chachingConfig | null,
	now?: () => number
): Promise<RollupSnapshot> {
	const engine = new Ingestion(config ?? null, false, now ?? Date.now);
	try {
		await engine.ensureStarted();
		return engine.snapshot();
	} finally {
		engine.dispose();
	}
}

function sameMappings(
	left: Readonly<Record<string, string | null>>,
	right: Readonly<Record<string, string | null>>
): boolean {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) if ((left[key] ?? null) !== (right[key] ?? null)) return false;
	return true;
}
