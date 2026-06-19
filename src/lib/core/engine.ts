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

	constructor(
		private config: chachingConfig | null,
		private watchEnabled: boolean
	) {}

	/** Idempotent: kicks off the cold scan + watchers once. */
	ensureStarted(): Promise<void> {
		if (!this.ready) this.ready = this.start();
		return this.ready;
	}

	private async start(): Promise<void> {
		const t0 = Date.now();
		const cfg = this.config ?? (await loadConfig());
		this.rollup.setCutover(cfg.cutoverTs);
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
				// skip unreadable file; keep scanning
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

		this.coldScanMs = Date.now() - t0;
		if (this.watchEnabled && !this.disposed) this.startWatching();
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
		if (this.rollup.hasDirty()) {
			const delta = this.rollup.drainDelta();
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
		if (this.rollup.hasDirty()) {
			const delta = this.rollup.drainDelta();
			if (delta) for (const fn of this.listeners) fn(delta);
		}
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

	snapshot(): RollupSnapshot {
		return this.rollup.snapshot();
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
export function createEngine(config?: chachingConfig | null): Engine {
	return new Ingestion(config ?? null, true);
}

/** One cold scan, resolve a snapshot, dispose all resources (no watchers/timers left). */
export async function runOnce(config?: chachingConfig | null): Promise<RollupSnapshot> {
	const engine = new Ingestion(config ?? null, false);
	try {
		await engine.ensureStarted();
		return engine.snapshot();
	} finally {
		engine.dispose();
	}
}
