import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { UsageRecord } from '../../../types';
import { createCodexLineParser } from './parse';

export interface CodexReadResult {
	readonly filesScanned: number;
	readonly records: readonly UsageRecord[];
	readonly errors: readonly string[];
}

export async function readCodexRecords(root: string): Promise<CodexReadResult> {
	const files = await walkJsonl(root);
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
	return { filesScanned: files.length, records, errors };
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
