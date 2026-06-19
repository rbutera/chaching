// Line parser + lightweight schema guard. Extracts a billable UsageRecord from a
// single JSONL line, or returns null for anything that isn't a real assistant
// usage record. Tolerant of partial/corrupt lines (returns null, never throws).

import type { TokenCounts, UsageRecord } from '$lib/types';
import { computeCost } from '$lib/server/pricing/cost';
import { makeKey } from './dedup';

interface RawUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation?: {
		ephemeral_1h_input_tokens?: number;
		ephemeral_5m_input_tokens?: number;
	};
	server_tool_use?: {
		web_search_requests?: number;
		web_fetch_requests?: number;
	};
	service_tier?: string;
}

interface RawLine {
	type?: string;
	timestamp?: string;
	requestId?: string | null;
	sessionId?: string;
	isSidechain?: boolean;
	cwd?: string;
	message?: {
		id?: string | null;
		model?: string;
		usage?: RawUsage;
	};
}

function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface ParseContext {
	project: string;
	fileIsSidechain: boolean;
}

/**
 * Parse one JSONL line into a UsageRecord, or null if it should be skipped.
 * Skips: non-JSON, partial lines, non-assistant lines, missing usage,
 * `<synthetic>` model, and zero-usage records.
 */
export function parseLine(line: string, ctx: ParseContext): UsageRecord | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed[0] !== '{') return null;

	let obj: RawLine;
	try {
		obj = JSON.parse(trimmed) as RawLine;
	} catch {
		return null; // partial / corrupt line caught mid-write
	}

	if (obj.type !== 'assistant') return null;
	const msg = obj.message;
	if (!msg || !msg.usage) return null;

	const model = msg.model;
	if (!model || model === '<synthetic>') return null;

	const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
	if (!Number.isFinite(ts)) return null;

	const u = msg.usage;
	const tokens: TokenCounts = {
		input: num(u.input_tokens),
		output: num(u.output_tokens),
		cacheCreation: num(u.cache_creation_input_tokens),
		cacheRead: num(u.cache_read_input_tokens)
	};

	// skip genuinely empty records (defensive; synthetic already filtered)
	if (
		tokens.input === 0 &&
		tokens.output === 0 &&
		tokens.cacheCreation === 0 &&
		tokens.cacheRead === 0
	) {
		return null;
	}

	const cacheCreation1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
	const cacheCreation5m = num(u.cache_creation?.ephemeral_5m_input_tokens);

	const cost = computeCost(model, tokens, cacheCreation1h, cacheCreation5m);

	const day = isoDayUTC(ts);

	return {
		key: makeKey(msg.id ?? null, obj.requestId ?? null),
		provider: 'claude',
		timestamp: ts,
		day,
		model,
		tokens,
		cacheCreation1h,
		cacheCreation5m,
		webSearchRequests: num(u.server_tool_use?.web_search_requests),
		webFetchRequests: num(u.server_tool_use?.web_fetch_requests),
		sessionId: obj.sessionId ?? 'unknown',
		project: ctx.project,
		isSidechain: obj.isSidechain ?? ctx.fileIsSidechain,
		cost
	};
}

/** YYYY-MM-DD in UTC. */
export function isoDayUTC(epochMs: number): string {
	const d = new Date(epochMs);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
