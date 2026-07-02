// `chaching doctor` — per-provider health, staleness, and pricing-coverage
// diagnostics. Answers "why isn't provider X counting?" in one command.
//
// Split by design: `buildDoctorReport()` is a PURE function from injected facts to
// a report model (unit-tested), and everything above it (config load, cold scan,
// filesystem probes, the optional serve-port HEAD) is the I/O shell in runDoctor().
// Cost honesty carries over: we report "unknown"/absent rather than inventing a
// health signal we can't observe.

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';

import { createEngine } from '../../lib/core/engine.js';
import { loadConfig, type chachingConfig } from '../../lib/core/config.js';
import { expandPath, safeMtime } from '../../lib/core/fs-utils.js';
import { isoDayUTC } from '../../lib/core/ingest/parse.js';
import { discoverFiles, resolveProjectsDirs } from '../../lib/core/ingest/discover.js';
import { HistoryStore } from '../../lib/core/history/store.js';
import { providerLabel, money, int } from '../../lib/format.js';
import {
	noArt as resolveNoArt,
	noColor,
	green,
	yellow,
	dim,
	bold,
	wordmark
} from '../theme/personality.js';
import type { RollupSnapshot } from '../../lib/types.js';

// ── Report model (pure) ────────────────────────────────────────────────────────

export type Health = 'OK' | 'WARN' | 'FAIL';

/** The four providers chaching ingests, in display order. */
export type ProviderName = 'claude' | 'codex' | 'opencode' | 'cursor';

/** Per-provider facts gathered by the I/O shell and fed to the pure builder. */
export interface DoctorProviderInput {
	provider: ProviderName;
	enabled: boolean;
	/** human description of the configured source (paths / "Admin API token"). */
	sourceLabel: string;
	/** does the configured source exist on disk? `null` when existence is N/A (cursor). */
	sourceExists: boolean | null;
	/** source file count (claude jsonl / codex sessions); `null` when N/A (opencode db, cursor). */
	fileCount: number | null;
	/** newest source mtime in epoch ms; `null` when nothing found / N/A. */
	newestMtime: number | null;
	/** latest UTC day this provider has ingested data for; `null` when none. */
	latestDay: string | null;
	/** requests attributed to this provider on `todayUTC`. */
	todayRequests: number;
	/** cost attributed to this provider today; `null` when no priced data today. */
	todayCost: number | null;
	/** captured ProviderStatus ingest error, if any. */
	error: string | null;
	/** cursor only: whether an admin token is configured (env or file). */
	tokenPresent?: boolean;
}

export interface DoctorHistoryInput {
	enabled: boolean;
	dbPath: string;
	dbExists: boolean;
	frozenDayCount: number;
	latestFrozenDay: string | null;
	/** did this scan gate freezing (a provider ingest error made it partial)? */
	scanPartial: boolean;
}

export interface DoctorServerInput {
	port: number;
	/** localhost HEAD probe result: reachable / unreachable / `null` when not probed. */
	reachable: boolean | null;
}

export interface DoctorInput {
	todayUTC: string;
	providers: DoctorProviderInput[];
	history: DoctorHistoryInput;
	unknownPriceModels: string[];
	server: DoctorServerInput;
}

/** One rendered line inside a section. `status` null = a plain informational line. */
export interface DoctorLine {
	status: Health | null;
	text: string;
}

export interface DoctorSection {
	title: string;
	status: Health;
	lines: DoctorLine[];
}

export interface DoctorReport {
	sections: DoctorSection[];
	overall: Health;
	hasFail: boolean;
	/** true when any enabled provider has fresher source data than it has ingested. */
	staleness: boolean;
}

/** WARN unless something is worse; FAIL wins, then WARN, then OK. */
function worst(a: Health, b: Health): Health {
	if (a === 'FAIL' || b === 'FAIL') return 'FAIL';
	if (a === 'WARN' || b === 'WARN') return 'WARN';
	return 'OK';
}

/** True when the newest source file lands on a UTC day AFTER the latest ingested day. */
function isStale(p: DoctorProviderInput): boolean {
	if (!p.enabled || p.newestMtime == null) return false;
	const newestSourceDay = isoDayUTC(p.newestMtime);
	if (p.latestDay == null) return true; // fresh source, nothing ingested at all
	return newestSourceDay > p.latestDay;
}

/**
 * Pure diagnosis: turn injected facts into a sectioned report + overall health.
 * No I/O, no clock — everything it needs is in `input`, so it is fully unit-testable.
 */
export function buildDoctorReport(input: DoctorInput): DoctorReport {
	const sections: DoctorSection[] = [];
	let staleness = false;

	// ── Providers ────────────────────────────────────────────────────────────────
	for (const p of input.providers) {
		const lines: DoctorLine[] = [];
		let status: Health = 'OK';

		if (!p.enabled) {
			lines.push({ status: null, text: `disabled in config` });
			sections.push({ title: `Provider: ${providerLabel(p.provider)}`, status: 'OK', lines });
			continue;
		}

		// Source existence.
		if (p.provider === 'cursor') {
			if (p.tokenPresent) {
				lines.push({ status: 'OK', text: `Admin API token configured` });
			} else {
				lines.push({ status: 'FAIL', text: `enabled but no Admin API token (config or CURSOR_ADMIN_API_TOKEN)` });
				status = worst(status, 'FAIL');
			}
		} else if (p.sourceExists === false) {
			lines.push({ status: 'FAIL', text: `source not found: ${p.sourceLabel}` });
			status = worst(status, 'FAIL');
		} else {
			const count = p.fileCount != null ? `${int(p.fileCount)} file(s)` : `present`;
			const newest = p.newestMtime != null ? `, newest ${isoDayUTC(p.newestMtime)}` : '';
			lines.push({ status: 'OK', text: `source: ${p.sourceLabel} (${count}${newest})` });
			if (p.fileCount === 0) {
				lines.push({ status: 'WARN', text: `source exists but contains no data files` });
				status = worst(status, 'WARN');
			}
		}

		// Ingest error captured during the scan.
		if (p.error) {
			lines.push({ status: 'FAIL', text: `ingest error: ${p.error}` });
			status = worst(status, 'FAIL');
		}

		// Ingested-data facts.
		if (p.latestDay) {
			lines.push({ status: null, text: `latest ingested day: ${p.latestDay}` });
		} else if (status !== 'FAIL') {
			lines.push({ status: 'WARN', text: `no ingested data in this scan` });
			status = worst(status, 'WARN');
		}

		const costStr = p.todayCost != null ? money(p.todayCost) : 'cost unknown';
		if (p.todayRequests > 0) {
			lines.push({ status: 'OK', text: `today (${input.todayUTC}): ${int(p.todayRequests)} request(s), ${costStr}` });
		} else {
			lines.push({ status: null, text: `today (${input.todayUTC}): no requests` });
		}

		// Staleness: fresher source on disk than we ingested. Actionable hint attached.
		if (isStale(p) && !p.error && p.sourceExists !== false) {
			staleness = true;
			const srcDay = p.newestMtime != null ? isoDayUTC(p.newestMtime) : '?';
			lines.push({
				status: 'WARN',
				text: `source has data for ${srcDay} but latest ingested day is ${p.latestDay ?? 'none'} — a running serve/TUI predating v1.9.0 must be restarted to re-poll`
			});
			status = worst(status, 'WARN');
		}

		sections.push({ title: `Provider: ${providerLabel(p.provider)}`, status, lines });
	}

	// ── Staleness hint (cross-cutting) ──────────────────────────────────────────
	if (staleness) {
		const lines: DoctorLine[] = [
			{
				status: null,
				text: `As of v1.9.0 a long-running \`chaching serve\`/TUI re-polls codex + opencode every 15s.`
			},
			{
				status: null,
				text: `A process started before v1.9.0 will not — restart it to pick up new usage.`
			}
		];
		if (input.server.reachable === true) {
			lines.push({
				status: 'WARN',
				text: `a chaching server is listening on :${input.server.port} — if it is stale, restart it`
			});
		} else if (input.server.reachable === false) {
			lines.push({ status: null, text: `no chaching server reachable on :${input.server.port}` });
		}
		sections.push({ title: 'Staleness', status: 'WARN', lines });
	}

	// ── History health ──────────────────────────────────────────────────────────
	{
		const h = input.history;
		const lines: DoctorLine[] = [];
		let status: Health = 'OK';
		if (!h.enabled) {
			lines.push({ status: 'WARN', text: `history disabled — past days are never frozen and can be lost when logs prune` });
			status = 'WARN';
		} else {
			lines.push({ status: 'OK', text: `enabled, db: ${h.dbPath}` });
			if (!h.dbExists) {
				lines.push({ status: 'WARN', text: `history db not created yet (no past day frozen so far)` });
				status = worst(status, 'WARN');
			} else {
				lines.push({ status: null, text: `frozen days: ${int(h.frozenDayCount)}${h.latestFrozenDay ? ` (latest ${h.latestFrozenDay})` : ''}` });
			}
			if (h.scanPartial) {
				lines.push({ status: 'WARN', text: `this scan is partial (a provider errored) — freezing is blocked until a clean scan` });
				status = worst(status, 'WARN');
			}
		}
		sections.push({ title: 'History', status, lines });
	}

	// ── Pricing coverage ────────────────────────────────────────────────────────
	{
		const lines: DoctorLine[] = [];
		let status: Health = 'OK';
		if (input.unknownPriceModels.length === 0) {
			lines.push({ status: 'OK', text: `every observed model has a price` });
		} else {
			lines.push({ status: 'WARN', text: `${int(input.unknownPriceModels.length)} model(s) seen with no price (shown as cost-unknown):` });
			for (const m of input.unknownPriceModels) {
				lines.push({ status: null, text: `  ${m}` });
			}
			status = 'WARN';
		}
		sections.push({ title: 'Pricing coverage', status, lines });
	}

	const overall = sections.reduce<Health>((acc, s) => worst(acc, s.status), 'OK');
	return { sections, overall, hasFail: overall === 'FAIL', staleness };
}

// ── I/O shell ──────────────────────────────────────────────────────────────────

export interface DoctorFlags {
	json?: boolean;
	noArt?: boolean;
}

export async function runDoctor(argv: string[]): Promise<void> {
	const flags = parseDoctorFlags(argv);
	const cfg = await loadConfig();
	const input = await gatherDoctorInput(cfg);
	const report = buildDoctorReport(input);

	if (flags.json) {
		process.stdout.write(JSON.stringify(report, null, 2) + '\n');
	} else {
		renderReport(report, flags.noArt ?? resolveNoArt(argv));
	}

	if (report.hasFail) process.exit(1);
}

function parseDoctorFlags(argv: string[]): DoctorFlags {
	const flags: DoctorFlags = { noArt: resolveNoArt(argv) };
	for (const arg of argv) {
		if (arg === '--json') flags.json = true;
		else if (arg === '--no-art' || arg === '--no-color') {
			// handled globally (noArt / NO_COLOR); accept without error
		} else if (arg.startsWith('-')) {
			console.error(`chaching doctor: unknown flag '${arg}'`);
			console.error(`Run \`chaching --help\` for usage.`);
			process.exit(1);
		}
	}
	return flags;
}

/** Run a fresh cold scan and probe the filesystem to assemble the diagnosis facts. */
async function gatherDoctorInput(cfg: chachingConfig): Promise<DoctorInput> {
	const todayUTC = isoDayUTC(Date.now());

	// Fresh cold scan. createEngine() gives us both the snapshot AND the captured
	// ProviderStatus errors (runOnce() discards the engine, so we keep it here and
	// dispose immediately — timers are unref'd so nothing lingers).
	const engine = createEngine(cfg);
	let snapshot: RollupSnapshot;
	let providerErrors: Record<string, string>;
	try {
		await engine.ensureStarted();
		snapshot = engine.snapshot();
		providerErrors = engine.stats.providerErrors;
	} finally {
		engine.dispose();
	}

	// Per-provider ingested-data facts from the snapshot's flat dayModel.
	const latestDayFor = (name: string): string | null => {
		let latest: string | null = null;
		for (const dm of snapshot.dayModel) {
			if (dm.provider !== name) continue;
			if (latest === null || dm.day > latest) latest = dm.day;
		}
		return latest;
	};
	const todayFacts = (name: string): { requests: number; cost: number | null } => {
		let requests = 0;
		let cost = 0;
		let priced = false;
		for (const dm of snapshot.dayModel) {
			if (dm.provider !== name || dm.day !== todayUTC) continue;
			requests += dm.requests;
			cost += dm.cost;
			if (dm.requests - dm.costUnknownRequests > 0) priced = true;
		}
		return { requests, cost: priced ? cost : requests > 0 ? null : 0 };
	};

	const providers: DoctorProviderInput[] = [];

	// claude — jsonl transcripts under each root's projects/ dir.
	{
		const enabled = cfg.providers.claude.enabled;
		const roots = cfg.providers.claude.roots;
		let sourceExists: boolean | null = null;
		let fileCount: number | null = null;
		let newestMtime: number | null = null;
		if (enabled) {
			const claudeEnv = {
				...process.env,
				CLAUDE_CONFIG_DIR: roots.map(expandPath).join(',')
			};
			const projectsDirs = await resolveProjectsDirs(claudeEnv);
			sourceExists = projectsDirs.length > 0;
			const files = await discoverFiles(claudeEnv);
			fileCount = files.length;
			newestMtime = await newestOf(files.map((f) => f.path));
		}
		const today = todayFacts('claude');
		providers.push({
			provider: 'claude',
			enabled,
			sourceLabel: roots.join(', '),
			sourceExists,
			fileCount,
			newestMtime,
			latestDay: latestDayFor('claude'),
			todayRequests: today.requests,
			todayCost: today.cost,
			error: providerErrors.claude ?? null
		});
	}

	// codex — JSONL session files under the sessions root.
	{
		const enabled = cfg.providers.codex.enabled;
		const root = expandPath(cfg.providers.codex.root);
		let sourceExists: boolean | null = null;
		let fileCount: number | null = null;
		let newestMtime: number | null = null;
		if (enabled) {
			sourceExists = existsSync(root);
			if (sourceExists) {
				const files = await walkExt(root, '.jsonl');
				fileCount = files.length;
				newestMtime = await newestOf(files);
			}
		}
		const today = todayFacts('codex');
		providers.push({
			provider: 'codex',
			enabled,
			sourceLabel: cfg.providers.codex.root,
			sourceExists,
			fileCount,
			newestMtime,
			latestDay: latestDayFor('codex'),
			todayRequests: today.requests,
			todayCost: today.cost,
			error: providerErrors.codex ?? null
		});
	}

	// opencode — a single SQLite db (+ its -wal).
	{
		const enabled = cfg.providers.opencode.enabled;
		const dbPath = expandPath(cfg.providers.opencode.dbPath);
		let sourceExists: boolean | null = null;
		let newestMtime: number | null = null;
		if (enabled) {
			sourceExists = existsSync(dbPath);
			if (sourceExists) newestMtime = await newestOf([dbPath, `${dbPath}-wal`]);
		}
		const today = todayFacts('opencode');
		providers.push({
			provider: 'opencode',
			enabled,
			sourceLabel: cfg.providers.opencode.dbPath,
			sourceExists,
			fileCount: null,
			newestMtime,
			latestDay: latestDayFor('opencode'),
			todayRequests: today.requests,
			todayCost: today.cost,
			error: providerErrors.opencode ?? null
		});
	}

	// cursor — Admin API (token, no local file source).
	{
		const enabled = cfg.providers.cursor.enabled;
		const tokenPresent =
			(cfg.providers.cursor.adminApiToken || process.env.CURSOR_ADMIN_API_TOKEN || '').length > 0;
		const today = todayFacts('cursor');
		providers.push({
			provider: 'cursor',
			enabled,
			sourceLabel: 'Cursor Admin API',
			sourceExists: null,
			fileCount: null,
			newestMtime: null,
			latestDay: latestDayFor('cursor'),
			todayRequests: today.requests,
			todayCost: today.cost,
			error: providerErrors.cursor ?? null,
			tokenPresent
		});
	}

	// History health.
	const historyDbPath = expandPath(cfg.history.dbPath);
	const history = readHistoryHealth(cfg.history.enabled, historyDbPath, providerErrors);

	// Optional: is a chaching server already listening on the configured port?
	const reachable = await probeServer(cfg.server.port);

	return {
		todayUTC,
		providers,
		history,
		unknownPriceModels: snapshot.unknownPriceModels,
		server: { port: cfg.server.port, reachable }
	};
}

/** Newest mtime (epoch ms) across a set of paths; null when none stat-able. */
async function newestOf(paths: string[]): Promise<number | null> {
	let newest: number | null = null;
	const mtimes = await Promise.all(paths.map((p) => safeMtime(p)));
	for (const m of mtimes) {
		if (m != null && (newest === null || m > newest)) newest = m;
	}
	return newest;
}

/** Recursively collect files ending in `ext` under `dir` (read-only, best-effort). */
async function walkExt(dir: string, ext: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(d: string): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(d, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
		}
	}
	await walk(dir);
	return out;
}

/** Read frozen-day stats from the history DB WITHOUT creating it when absent. */
function readHistoryHealth(
	enabled: boolean,
	dbPath: string,
	providerErrors: Record<string, string>
): DoctorHistoryInput {
	const scanPartial = Object.values(providerErrors).some(Boolean);
	const dbExists = existsSync(dbPath);
	let frozenDayCount = 0;
	let latestFrozenDay: string | null = null;
	// Only OPEN an existing db — open() would otherwise create schema as a side effect.
	if (enabled && dbExists) {
		const store = new HistoryStore();
		try {
			store.open(dbPath);
			const days = [...store.frozenDays()];
			frozenDayCount = days.length;
			for (const d of days) {
				if (latestFrozenDay === null || d > latestFrozenDay) latestFrozenDay = d;
			}
		} catch {
			// unreadable db → report as no frozen data rather than crashing the diagnosis
		} finally {
			store.close();
		}
	}
	return { enabled, dbPath, dbExists, frozenDayCount, latestFrozenDay, scanPartial };
}

/** Best-effort localhost HEAD probe. Never throws; resolves reachable/unreachable. */
function probeServer(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (v: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(v);
		};
		try {
			const req = request(
				{ host: '127.0.0.1', port, method: 'HEAD', path: '/', timeout: 400 },
				(res) => {
					res.resume();
					done(true);
				}
			);
			req.on('error', () => done(false));
			req.on('timeout', () => {
				req.destroy();
				done(false);
			});
			req.end();
		} catch {
			done(false);
		}
	});
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Marker color is a COLOR concern (green/yellow/red already degrade under NO_COLOR),
// not an ASCII-art one — so it is independent of --no-art, matching stats.ts.
function marker(status: Health): string {
	const label = `[${status}]`;
	if (status === 'OK') return green(label);
	if (status === 'WARN') return yellow(label);
	return red(label);
}

/** Red ANSI (personality only exports green/yellow); degrades under NO_COLOR. */
function red(t: string): string {
	if (noColor()) return t;
	return `\x1b[31m${t}\x1b[0m`;
}

function renderReport(report: DoctorReport, isNoArt: boolean): void {
	console.log('');
	if (!isNoArt) {
		const wm = wordmark({ noArt: false });
		if (wm) console.log(`  ${wm}`);
	} else {
		console.log('  chaching doctor');
	}
	console.log('');

	for (const section of report.sections) {
		console.log(`  ${marker(section.status)} ${bold(section.title)}`);
		for (const line of section.lines) {
			if (line.status) {
				console.log(`      ${marker(line.status)} ${line.text}`);
			} else {
				console.log(`           ${dim(line.text)}`);
			}
		}
		console.log('');
	}

	const overall = report.overall;
	const summary =
		overall === 'FAIL'
			? `${marker('FAIL')} one or more checks failed`
			: overall === 'WARN'
				? `${marker('WARN')} healthy, with warnings`
				: `${marker('OK')} all checks passed`;
	console.log(`  ${summary}`);
	console.log('');
}
