import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { UsageRecord } from '../../../types';
import { createCodexLineParser } from './parse';

export interface CodexReadResult {
	readonly filesScanned: number;
	/** the session files this pass actually parsed (the engine tracks first-seen for stats) */
	readonly files: readonly string[];
	readonly records: readonly UsageRecord[];
	readonly errors: readonly string[];
}

export interface CodexReadOptions {
	/**
	 * Only parse files modified at/after this epoch-ms stamp — the engine's
	 * incremental re-poll. The caller keeps a safety margin and the rollup dedup
	 * absorbs overlap, so re-reading a file twice is safe; skipping a fresh one is not.
	 */
	modifiedSince?: number;
}

export async function readCodexRecords(
	root: string,
	opts: CodexReadOptions = {}
): Promise<CodexReadResult> {
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
		const parser = createCodexLineParser({ sessionId: basename(file, '.jsonl'), project: 'codex' });
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
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walkJsonlInto(full, out);
		} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
			out.push(full);
		}
	}
}
