import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { UsageRecord } from '../../../types';
import { createPiLineParser } from './parse';

// Reads Pi (and its fork omp — same on-disk format + path) session logs under
// `~/.pi/agent/sessions/<flattened-cwd>/<ISO-ts>_<sessionId>.jsonl`. The sessions
// root nests one level deep by flattened cwd, so we walk `**/*.jsonl` (same shape
// as the codex reader). Whole-turn snapshots are append-only, so a long-running
// process re-polls only mtime-fresh files (dedup absorbs any overlap).

export interface PiReadResult {
	readonly filesScanned: number;
	/** the session files this pass actually parsed (the engine tracks first-seen for stats) */
	readonly files: readonly string[];
	readonly records: readonly UsageRecord[];
	readonly errors: readonly string[];
}

export interface PiReadOptions {
	/**
	 * Only parse files modified at/after this epoch-ms stamp — the engine's
	 * incremental re-poll. The caller keeps a safety margin and the rollup dedup
	 * absorbs overlap, so re-reading a file twice is safe; skipping a fresh one is not.
	 */
	modifiedSince?: number;
}

export async function readPiRecords(
	root: string,
	opts: PiReadOptions = {}
): Promise<PiReadResult> {
	let files = await walkJsonl(root);
	if (opts.modifiedSince !== undefined) {
		const since = opts.modifiedSince;
		const fresh: string[] = [];
		for (const file of files) {
			try {
				const s = await stat(file);
				if (s.mtimeMs >= since) fresh.push(file);
			} catch {
				// vanished between walk and stat — skip
			}
		}
		files = fresh;
	}
	const records: UsageRecord[] = [];
	const errors: string[] = [];
	for (const file of files) {
		// sessionId/project are fallbacks; the header line inside the file overrides
		// both (session uuidv7 + cwd) once seen.
		const parser = createPiLineParser({ sessionId: basename(file, '.jsonl'), project: 'pi' });
		try {
			const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
			const rl = createInterface({ input: stream, crlfDelay: Infinity });
			for await (const line of rl) {
				const rec = parser.parse(line);
				if (rec) records.push(rec);
			}
		} catch (error) {
			errors.push(errorMessage(error));
		}
	}
	return { filesScanned: files.length, files, records, errors };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function walkJsonl(dir: string): Promise<string[]> {
	const out: string[] = [];
	await walkJsonlInto(dir, out);
	return out;
}

async function walkJsonlInto(dir: string, out: string[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		// missing/unreadable sessions root — no files, not an error (provider simply idle)
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walkJsonlInto(full, out);
		} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
			out.push(full);
		}
	}
}
