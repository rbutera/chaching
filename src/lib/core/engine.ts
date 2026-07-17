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
import {
	PostgresSyncStore,
	cursorAccountScope,
	machineScope,
	type PeerDayAgg,
	type PeerHourAgg,
	type PeerSession,
	type PublishScope
} from './sync/store';
import type { SyncMapping } from './sync/types';
import {
	attachSubscriptions,
	buildSubscriptionIndex,
	mergePooledSnapshot,
	peerContribution,
	type SubscriptionIndex
} from './sync/overlay';

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
// Only the last ~48h of local hour buckets are published (the server prunes to 7d), which
// is more than enough to reconstruct any live 5h-cap window across machines.
const HOUR_PUBLISH_WINDOW_MS = 48 * 60 * 60 * 1000;
// Random 0-15s jitter added to each wall-clock-aligned burst so all pool machines hit the
// SAME serverless wake window (aligned instant) while spreading their connects within it.
const SYNC_JITTER_MS = 15_000;

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
	private syncBurstInFlight = false;
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
	/**
	 * Cursor Admin API spend is an account-global fact. In pooled mode it feeds ONLY this
	 * publish-side rollup (never the local rollup), is published under the account scope, and
	 * is rendered — for every machine including the poller — from the peer overlay. That is
	 * how the machine that polls cursor avoids double-counting its own cursor spend.
	 */
	private cursorRollup: Rollup | null = null;
	/** Peer aggregate overlay, keyed by (sourceScope, grain). Replaced in place on republish. */
	private peerDay = new Map<string, PeerDayAgg>();
	private peerHour = new Map<string, PeerHourAgg>();
	private peerSession = new Map<string, PeerSession>();
	/** Incremental peer read watermark: max `updated_at` (ISO) seen so far, null = read all. */
	private syncWatermark: string | null = null;
	private syncMappings: readonly SyncMapping[] = [];
	private syncSubscriptionIndex: SubscriptionIndex = { byMachineProvider: new Map(), cursor: null };
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

		// Local-first ALWAYS: seed the rollup with frozen past-day aggregates from local SQLite
		// and let the live scan freeze normally, whether or not sync is configured. Pooling adds
		// a peer OVERLAY on top; it never replaces the durable local store, so leaving a pool
		// loses nothing local. MUST happen before any rollup.add call so frozen days are skipped.
		this.loadHistory(cfg);
		// Cursor Admin API spend is account-global; in pooled mode it feeds a publish-only
		// rollup (see the field doc), never the local rollup.
		if (isConfigured(cfg.sync)) {
			this.cursorRollup = new Rollup();
			this.cursorRollup.setCutover(cfg.cutoverTs);
		}

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

		// Connect the pooled ledger AFTER the local scan so the first publish carries the full
		// local rollup. A connect failure records the sync error and degrades to local-only —
		// the local data is already loaded, so this is the local-first fallback (B1).
		if (isConfigured(cfg.sync)) await this.connectSync(cfg);

		// Freeze newly-complete past days (day < today, scanned, not already frozen). Runs in
		// pooled mode too now; scanIsPartial() (which includes a sync-connect error) still gates
		// it, so a run where PG was unreachable does not lock in a partial copy.
		this.freezeNewDays(cfg);

		this.coldScanMs = Date.now() - t0;
		if (this.watchEnabled && !this.disposed) {
			this.startWatching();
			this.startLocalProviderPolling(cfg);
			this.startSyncScheduler(cfg);
		}
	}

	/**
	 * Connect the pooled ledger: publish the full local rollup, load the peer overlay, and
	 * build the read-time subscription index. On any failure record the sync error and degrade
	 * to local-only (the local rollup is already populated — local-first, B1). The recorded
	 * error keeps scanIsPartial() true so no partial freeze is locked in this run.
	 */
	private async connectSync(cfg: chachingConfig): Promise<void> {
		if (!isConfigured(cfg.sync)) return;
		const store = new PostgresSyncStore(cfg.sync.databaseUrl, cfg.sync.poolId, cfg.sync.machineId);
		try {
			await store.open();
			await store.heartbeat(cfg.sync.machineName, hostname());
			this.syncStore = store;
			await this.refreshSubscriptionIndex();
			// Full publish on connect: every local day/session (frozen history + live) plus the
			// last 48h of hour buckets and the account-scoped cursor spend. Idempotent LWW.
			await this.publishLocal(true);
			// Read all peers (watermark null → since beginning), including our own just-published
			// account-scoped cursor rows, so this snapshot already renders cursor from the overlay.
			await this.loadPeer();
			this.rollup.clearPublishDirty();
			this.providerStatus.clear('sync');
		} catch (error) {
			this.providerStatus.recordError('sync', error);
			void store.close().catch(() => {});
			this.syncStore = null;
		}
	}

	private ownScope(): PublishScope {
		const machineId = this.resolvedConfig?.sync.machineId ?? '';
		return { sourceScope: machineScope(machineId), machineId };
	}

	private cursorScope(): PublishScope | null {
		const email = this.resolvedConfig?.providers.cursor.email?.trim();
		if (!email) return null;
		return { sourceScope: cursorAccountScope(email), machineId: null };
	}

	/**
	 * Publish this machine's aggregates to the ledger. `full` publishes every local day/session
	 * (pool join / cold start); otherwise only the publish-dirty delta since the last burst.
	 * Cursor spend publishes separately under the account scope. Callers clear publish-dirty
	 * ONLY after this resolves without throwing, so a failed burst self-heals by republishing.
	 */
	private async publishLocal(full: boolean): Promise<void> {
		if (!this.syncStore) return;
		const now = this.now();
		const hourFloor = now - HOUR_PUBLISH_WINDOW_MS;
		const scope = this.ownScope();
		const days = full ? this.rollup.allDayAggregates() : this.rollup.dirtyDayAggregates();
		const hours = full
			? this.rollup.allHourAggregates(hourFloor)
			: this.rollup.dirtyHourAggregates(hourFloor);
		const sessions = full ? this.rollup.allSessionSummaries() : this.rollup.dirtySessionSummaries();
		await this.syncStore.publishDayAggregates(scope, days);
		await this.syncStore.publishHourAggregates(scope, hours, now);
		await this.syncStore.publishSessions(scope, sessions);

		const cursorScope = this.cursorScope();
		if (this.cursorRollup && cursorScope) {
			// Cursor account rows are always republished in full: the set is small and every
			// machine may write them (LWW), so a per-machine dirty delta buys nothing.
			await this.syncStore.publishDayAggregates(cursorScope, this.cursorRollup.allDayAggregates());
			await this.syncStore.publishHourAggregates(
				cursorScope,
				this.cursorRollup.allHourAggregates(hourFloor),
				now
			);
			await this.syncStore.publishSessions(cursorScope, this.cursorRollup.allSessionSummaries());
		}
	}

	/** Incrementally read peer aggregates (updated_at >= watermark) into the overlay maps. */
	private async loadPeer(): Promise<void> {
		if (!this.syncStore) return;
		const load = await this.syncStore.loadAggregates(this.syncWatermark);
		for (const agg of load.dayAggregates) {
			this.peerDay.set(`${agg.sourceScope}${agg.day}${agg.provider}${agg.model}`, agg);
		}
		for (const agg of load.hourAggregates) {
			this.peerHour.set(
				`${agg.sourceScope}${agg.hourTs}${agg.provider}${agg.model}`,
				agg
			);
		}
		for (const session of load.sessions) {
			this.peerSession.set(
				`${session.sourceScope}${session.provider}${session.sessionId}`,
				session
			);
		}
		this.syncWatermark = load.watermark;
		// Bound the hour overlay: peers prune their own rows past 7d but their DELETEs are
		// invisible to us, so drop stale buckets locally too (blocks only span recent time).
		const hourFloor = this.now() - HOUR_PUBLISH_WINDOW_MS;
		for (const [key, agg] of this.peerHour) {
			if (agg.hourTs < hourFloor) this.peerHour.delete(key);
		}
	}

	/** Reload the pool mapping rows and rebuild the read-time subscription index + fingerprint. */
	private async refreshSubscriptionIndex(): Promise<void> {
		if (!this.syncStore) return;
		this.syncMappings = await this.syncStore.allMappings();
		this.syncMappingFingerprint = await this.syncStore.mappingFingerprint();
		this.syncSubscriptionIndex = buildSubscriptionIndex(
			this.syncMappings,
			this.resolvedConfig?.sync.machineId ?? ''
		);
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
			// Cursor Admin API spend is account-global. In pooled mode (cursorRollup non-null) it
			// feeds ONLY the publish-side cursor rollup — never the local rollup or its dedup — so
			// the poller renders it (like every peer) from the account-scoped overlay, no double-count.
			if (this.cursorRollup && isPoolGlobalUsage(raw)) {
				this.cursorRollup.add(raw);
				continue;
			}
			const rec = this.prepareLocalRecord(raw);
			if (!this.dedup.add(usageDedupKey(rec))) {
				this.rollup.addDuplicate();
				continue;
			}
			this.rollup.add(rec);
		}
	}

	/** Stamp this machine's id onto a local record when pooled; subscription is a read-time join. */
	private prepareLocalRecord(record: UsageRecord): UsageRecord {
		const cfg = this.resolvedConfig;
		if (!cfg || !isConfigured(cfg.sync)) return record;
		return { ...record, machineId: cfg.sync.machineId };
	}

	private syncHooks() {
		if (!this.syncStore) return {};
		return { prepare: (record: UsageRecord) => this.prepareLocalRecord(record) };
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
			if (this.disposed) return;
			this.maybeFreezeLive();
			this.emitLocalChange();
		} finally {
			this.localPollInFlight = false;
		}
	}

	/**
	 * Schedule sync bursts on wall-clock-aligned instants: epoch-grid multiples of
	 * `intervalMinutes` (hour-aligned for divisors of 60, e.g. :00/:15/:30/:45 for 15) plus a
	 * 0-15s jitter. Every pool machine fires in the SAME narrow window, so PostgreSQL wakes,
	 * absorbs the burst, and scales back to zero between windows. Self-scheduling setTimeout
	 * (not setInterval) so the next fire is re-aligned to the grid after each burst.
	 */
	private startSyncScheduler(cfg: chachingConfig): void {
		if (!this.syncStore || this.syncTimer || !isConfigured(cfg.sync)) return;
		const intervalMs = Math.max(1, cfg.sync.intervalMinutes) * 60_000;
		const scheduleNext = () => {
			if (this.disposed) return;
			const now = Date.now();
			const nextAligned = Math.ceil((now + 1) / intervalMs) * intervalMs;
			const delay = nextAligned - now + Math.floor(Math.random() * SYNC_JITTER_MS);
			this.syncTimer = setTimeout(() => {
				void this.runSyncBurst(cfg).finally(scheduleNext);
			}, delay);
			if (this.syncTimer.unref) this.syncTimer.unref();
		};
		scheduleNext();
	}

	/**
	 * One sync burst: publish this machine's dirty day/hour/session aggregates (+ cursor
	 * account rows), heartbeat, read peer deltas incrementally, and check the mapping
	 * fingerprint. `sync` status is cleared ONLY when the whole burst succeeds; any failure
	 * records the error and leaves publish-dirty intact so the next burst republishes
	 * (self-healing — the dirty set is derived from the local rollup, no outbox to lose).
	 */
	private async runSyncBurst(cfg: chachingConfig): Promise<void> {
		if (this.disposed || !this.syncStore || !isConfigured(cfg.sync)) return;
		// A hung PG must not pile up overlapping bursts (mirrors localPollInFlight).
		if (this.syncBurstInFlight) return;
		this.syncBurstInFlight = true;
		try {
			await this.publishLocal(false);
			this.rollup.clearPublishDirty();
			if (this.cursorRollup) this.cursorRollup.clearPublishDirty();
			await this.syncStore.heartbeat(cfg.sync.machineName, hostname());
			const fingerprint = await this.syncStore.mappingFingerprint();
			const mappingChanged = fingerprint !== this.syncMappingFingerprint;
			if (mappingChanged) await this.refreshSubscriptionIndex();
			await this.loadPeer();
			this.providerStatus.clear('sync');
			// A merged replace after every burst: local live changes since the last emit and any
			// peer/mapping change all land at once, and the client's totals stay pool-correct.
			if (this.disposed) return;
			this.emitSyncSnapshot();
		} catch (error) {
			this.providerStatus.recordError('sync', error);
		} finally {
			this.syncBurstInFlight = false;
		}
	}

	/**
	 * Build the pooled snapshot: LOCAL rollup snapshot merged with the PEER overlay
	 * contribution, then a read-time subscription join. Own rows come only from the local
	 * rollup; peer + account-scoped cursor rows come only from the overlay — disjoint, so the
	 * merge never double-counts.
	 */
	private buildSyncSnapshot(): RollupSnapshot {
		const now = this.now();
		const today = isoDayUTC(now);
		const local = this.rollup.snapshot(now, this.coverageInput());
		const peer = peerContribution(
			this.peerDay.values(),
			[...this.peerHour.values()],
			this.peerSession.values(),
			now
		);
		const merged = mergePooledSnapshot(local, peer, today);
		return attachSubscriptions(merged, this.syncSubscriptionIndex);
	}

	private emitSyncSnapshot(): void {
		if (this.listeners.size === 0) return;
		const replacement = this.buildSyncSnapshot();
		const delta: RollupDelta = { ...replacement, replace: replacement };
		for (const fn of this.listeners) fn(delta);
	}

	/**
	 * Fan a change to subscribers. Pooled mode ships a full merged `replace` (local + peer
	 * totals must agree); solo mode drains an incremental delta from the local rollup.
	 */
	private emitLocalChange(): void {
		if (this.disposed) return;
		if (this.syncStore) {
			if (this.rollup.hasDirty()) {
				this.rollup.clearDirty();
				this.emitSyncSnapshot();
			}
			return;
		}
		if (this.rollup.hasDirty()) {
			const delta = this.rollup.drainDelta(this.now(), this.coverageInput());
			if (delta) for (const fn of this.listeners) fn(delta);
		}
	}

	private startCursorPolling(cfg: CursorProviderConfig): void {
		if (this.cursorTimer || !cfg.adminApiToken) return;
		this.cursorTimer = setInterval(() => void this.pollCursor(cfg), cfg.pollSeconds * 1000);
		if (this.cursorTimer.unref) this.cursorTimer.unref();
	}

	private async pollCursor(cfg: CursorProviderConfig): Promise<void> {
		if (this.disposed) return;
		await this.ingestCursor(cfg.adminApiToken, cfg.email);
		if (this.disposed) return;
		this.maybeFreezeLive();
		// Pooled: cursor spend went to the publish-only cursorRollup, so the local rollup is not
		// dirty here and this is a no-op — cursor renders on the next burst. Solo: it emits.
		this.emitLocalChange();
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
		// Freezing runs in pooled mode too (local-first); scanIsPartial() still gates it.
		this.maybeFreezeLive();
		this.emitLocalChange();
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
		if (this.syncStore) return this.buildSyncSnapshot();
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
			// syncTimer is a self-scheduling setTimeout (the wall-clock-aligned scheduler).
			clearTimeout(this.syncTimer);
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
