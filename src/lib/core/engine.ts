// Framework-free ingestion engine. ONE cold scan per engine (not per request),
// then fs.watch (recursive) + mtime-poll fallback to tail new lines. Maintains the
// Rollup and fans deltas out to subscribers. Both the SvelteKit server and the CLI
// consume this in-process.

import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
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
import { readOpenCodeSessions } from './providers/opencode/sqlite';
import { fetchCursorUsageRecords } from './providers/cursor/api';
import type { RollupDelta, RollupSnapshot, UsageRecord } from '../types';

const MTIME_POLL_MS = 4000; // fallback poll cadence
const DELTA_DEBOUNCE_MS = 400; // coalesce bursts of file changes into one delta

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
	private deltaTimer: NodeJS.Timeout | null = null;
	private listeners = new Set<DeltaListener>();
	private ready: Promise<void> | null = null;
	private coldScanMs = 0;
	private pendingChanges = new Set<string>();
	private claudeEnv: NodeJS.ProcessEnv | null = null;
	private providerStatus = new ProviderStatus();
	private disposed = false;
	private historyStore: HistoryStore | null = null;
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
		this.loadHistory(cfg);

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
				const newOffset = await ingestRange(f.path, 0, projectsDir, this.rollup, this.dedup);
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

		// Env-first: if the token is absent from config, fall back to the env var so
		// users who source the token from the environment don't have to store it in the file.
		const cursorToken =
			cfg.providers.cursor.adminApiToken || process.env.CURSOR_ADMIN_API_TOKEN || '';
		if (cfg.providers.cursor.enabled && cursorToken) {
			const cursorCfgWithToken = { ...cfg.providers.cursor, adminApiToken: cursorToken };
			await this.ingestCursor(cursorToken, cfg.providers.cursor.email);
			if (this.watchEnabled && !this.disposed) this.startCursorPolling(cursorCfgWithToken);
		}

		// Freeze newly-complete past days (day < today, scanned, not already frozen).
		this.freezeNewDays(cfg);

		this.coldScanMs = Date.now() - t0;
		if (this.watchEnabled && !this.disposed) this.startWatching();
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

	private async ingestCodex(root: string): Promise<void> {
		try {
			const result = await readCodexRecords(root);
			for (let i = 0; i < result.filesScanned; i++) this.rollup.markFileScanned();
			this.addProviderRecords(result.records);
			const [firstError] = result.errors;
			if (firstError) this.providerStatus.recordMessage('codex', firstError);
			else this.providerStatus.clear('codex');
		} catch (error) {
			this.providerStatus.recordError('codex', error);
			return;
		}
	}

	private async ingestOpenCode(dbPath: string): Promise<void> {
		try {
			this.rollup.markFileScanned();
			const records = await readOpenCodeSessions(dbPath);
			this.addProviderRecords(records);
			this.providerStatus.clear('opencode');
		} catch (error) {
			this.providerStatus.recordError('opencode', error);
			return;
		}
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
		for (const rec of records) {
			if (!this.dedup.add(rec.key)) {
				this.rollup.addDuplicate();
				continue;
			}
			this.rollup.add(rec);
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
		this.maybeFreezeLive();
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
			const newOffset = await ingestRange(full, startOffset, projectsDir, this.rollup, this.dedup);
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
		if (this.deltaTimer) {
			clearTimeout(this.deltaTimer);
			this.deltaTimer = null;
		}
		if (this.historyStore) {
			this.historyStore.close();
			this.historyStore = null;
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
