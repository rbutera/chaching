// Streaming cold scan + incremental tail. Never loads a whole file into memory:
// reads line-by-line via a byte-range stream, tracks a per-file byte offset, and
// on tail reads only offset->EOF. Feeds parsed+deduped records into the Rollup.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, sep } from 'node:path';
import type { Rollup } from '../rollup/rollup';
import type { DedupSet } from '../ingest/dedup';
import { parseLine } from '../ingest/parse';
import { decodeProject } from '../ingest/discover';
import type { UsageRecord } from '../../types';
import { usageDedupKey } from '../sync/record-key';

export interface FileState {
	offset: number; // bytes consumed so far (EOF after last read)
	project: string;
	isSidechain: boolean;
}

export interface IngestRangeHooks {
	prepare?: (record: UsageRecord) => UsageRecord;
	onAdded?: (record: UsageRecord) => void;
}

/** Map projectsDir + filepath -> decoded project name. */
function projectFor(projectsDir: string, filePath: string): string {
	if (!filePath.startsWith(projectsDir)) return 'unknown';
	const rel = filePath.slice(projectsDir.length + 1);
	const encoded = rel.split(sep)[0] ?? '';
	return decodeProject(encoded);
}

function isSidechainPath(filePath: string): boolean {
	return filePath.includes(`${sep}subagents${sep}`) || basename(filePath).startsWith('agent-');
}

/**
 * Read a file from `startOffset` to EOF, line by line, applying dedup + parse,
 * and feed surviving records to the rollup. Returns the new offset (file size).
 * Streams — does not buffer the whole file.
 */
export async function ingestRange(
	filePath: string,
	startOffset: number,
	projectsDir: string,
	rollup: Rollup,
	dedup: DedupSet,
	hooks: IngestRangeHooks = {}
): Promise<number> {
	let size: number;
	try {
		size = (await stat(filePath)).size;
	} catch {
		return startOffset; // file vanished
	}
	if (size <= startOffset) {
		// truncated or no growth; if truncated (size < offset) restart from 0
		return size < startOffset
			? await ingestRange(filePath, 0, projectsDir, rollup, dedup, hooks)
			: startOffset;
	}

	const ctx = {
		project: projectFor(projectsDir, filePath),
		fileIsSidechain: isSidechainPath(filePath)
	};

	const stream = createReadStream(filePath, {
		start: startOffset,
		end: size - 1,
		encoding: 'utf8',
		highWaterMark: 1 << 20 // 1 MiB chunks
	});
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		if (!line) continue;
		const parsed = parseLine(line, ctx);
		if (!parsed) {
			rollup.addSkipped();
			continue;
		}
		const rec = hooks.prepare?.(parsed) ?? parsed;
		if (!dedup.add(usageDedupKey(rec))) {
			rollup.addDuplicate();
			continue;
		}
		rollup.add(rec);
		hooks.onAdded?.(rec);
	}

	return size;
}
