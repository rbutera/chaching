// Streaming cold scan + incremental tail. Never loads a whole file into memory:
// reads line-by-line via a byte-range stream, tracks a per-file byte offset, and
// on tail reads only offset->EOF. Feeds parsed+deduped records into the Rollup.

import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, sep } from 'node:path';
import type { Rollup } from '../rollup/rollup';
import type { DedupSet } from '../ingest/dedup';
import { parseLine } from '../ingest/parse';
import { decodeProject } from '../ingest/discover';
import type { UsageRecord } from '@chaching/shared/types';
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
	let position = startOffset;
	function addLine(raw: string): void {
		const lineStart = position;
		position += Buffer.byteLength(raw, 'utf8');
		const line = raw.replace(/\r?\n$/, '');
		if (!line) return;
		let parsed = parseLine(line, ctx);
		if (!parsed) { rollup.addSkipped(); return; }
		if (parsed.key.startsWith('__nokey__:')) {
			const identity = createHash('sha256').update(JSON.stringify([parsed.timestamp, parsed.sessionId, parsed.model, parsed.tokens, parsed.cacheCreation1h, parsed.cacheCreation5m, parsed.webSearchRequests, parsed.webFetchRequests])).digest('hex');
			parsed = { ...parsed, key: `file:${filePath}:${lineStart}:${identity}` };
		}
		const rec = hooks.prepare?.(parsed) ?? parsed;
		if (!dedup.add(usageDedupKey(rec))) { rollup.addDuplicate(); return; }
		rollup.add(rec);
		hooks.onAdded?.(rec);
	}
	let pending = '';
	for await (const chunk of stream) {
		pending += chunk;
		let newline: number;
		while ((newline = pending.indexOf('\n')) !== -1) {
			addLine(pending.slice(0, newline + 1));
			pending = pending.slice(newline + 1);
		}
	}
	if (pending) addLine(pending);

	return size;
}
