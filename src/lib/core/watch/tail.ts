// Streaming cold scan + incremental tail. Never loads a whole file into memory:
// reads line-by-line via a byte-range stream, tracks a per-file byte offset, and
// on tail reads only offset->EOF. Feeds parsed+deduped records into the Rollup.

import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, sep } from 'node:path';
import type { Rollup } from '../rollup/rollup';
import type { DedupSet } from '../ingest/dedup';
import { isNoKey, usageRecordDedupKey } from '../ingest/dedup';
import { parseLine } from '../ingest/parse';
import { decodeProject } from '../ingest/discover';
import type { UsageRecord } from '../../types';

export interface FileState {
	offset: number; // bytes consumed so far (EOF after last read)
	project: string;
	isSidechain: boolean;
}

export interface IngestRangeOptions {
	transformRecord?: (record: UsageRecord) => UsageRecord;
	onRecord?: (record: UsageRecord) => void;
	/** Sync mode only: make null-id Claude events stable across process restarts. */
	stabilizeNoKey?: boolean;
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
	options: IngestRangeOptions = {}
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
			? await ingestRange(filePath, 0, projectsDir, rollup, dedup, options)
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
	let lineOffset = startOffset;
	const pathHash = options.stabilizeNoKey
		? createHash('sha256').update(filePath).digest('hex').slice(0, 16)
		: '';

	for await (const line of rl) {
		const currentOffset = lineOffset;
		lineOffset += Buffer.byteLength(line, 'utf8') + 1;
		if (!line) continue;
		const parsed = parseLine(line, ctx);
		if (!parsed) {
			rollup.addSkipped();
			continue;
		}
		const stable =
			options.stabilizeNoKey && isNoKey(parsed.key)
				? {
						...parsed,
						key: `__sync_source__:${pathHash}:${currentOffset}:${createHash('sha256').update(line).digest('hex').slice(0, 16)}`
					}
				: parsed;
		const rec = options.transformRecord?.(stable) ?? stable;
		if (!dedup.add(usageRecordDedupKey(rec))) {
			rollup.addDuplicate();
			continue;
		}
		rollup.add(rec);
		options.onRecord?.(rec);
	}

	return size;
}
