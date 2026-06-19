import { DatabaseSync } from 'node:sqlite';
import type { TokenCounts, UsageRecord } from '../../../types';
import { isoDayUTC } from '../../ingest/parse';

interface OpenCodeSessionRow {
	id: string;
	path: string | null;
	agent: string | null;
	model: string | null;
	cost: number;
	tokens_input: number;
	tokens_output: number;
	tokens_reasoning: number;
	tokens_cache_read: number;
	tokens_cache_write: number;
	time_created: number;
	time_updated: number;
}

interface OpenCodeModelInfo {
	id?: string;
	providerID?: string;
	variant?: string;
}

export async function readOpenCodeSessions(dbPath: string): Promise<UsageRecord[]> {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db.prepare(`SELECT id, path, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated FROM session`).all().map(parseRow);
		return rows.map(rowToRecord);
	} finally {
		db.close();
	}
}

function parseRow(row: Record<string, unknown>): OpenCodeSessionRow {
	return {
		id: stringValue(row.id, 'unknown'),
		path: nullableString(row.path),
		agent: nullableString(row.agent),
		model: nullableString(row.model),
		cost: numberValue(row.cost),
		tokens_input: numberValue(row.tokens_input),
		tokens_output: numberValue(row.tokens_output),
		tokens_reasoning: numberValue(row.tokens_reasoning),
		tokens_cache_read: numberValue(row.tokens_cache_read),
		tokens_cache_write: numberValue(row.tokens_cache_write),
		time_created: numberValue(row.time_created),
		time_updated: numberValue(row.time_updated)
	};
}

function rowToRecord(row: OpenCodeSessionRow): UsageRecord {
	const tokens: TokenCounts = {
		input: row.tokens_input,
		output: row.tokens_output + row.tokens_reasoning,
		cacheCreation: row.tokens_cache_write,
		cacheRead: row.tokens_cache_read
	};
	return {
		key: `opencode:${row.id}`,
		provider: 'opencode',
		timestamp: row.time_updated,
		day: isoDayUTC(row.time_updated),
		model: modelLabel(row.model),
		tokens,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: row.id,
		project: row.path ?? row.agent ?? 'opencode',
		isSidechain: false,
		cost: row.cost
	};
}

function modelLabel(raw: string | null): string {
	if (!raw) return 'unknown';
	try {
		const parsed: unknown = JSON.parse(raw);
		const info = modelInfo(parsed);
		if (info.id && info.providerID) return `${info.providerID}/${info.id}`;
		if (info.id) return info.id;
		return raw;
	} catch {
		return raw;
	}
}

function modelInfo(value: unknown): OpenCodeModelInfo {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return {
		id: typeof record.id === 'string' ? record.id : undefined,
		providerID: typeof record.providerID === 'string' ? record.providerID : undefined,
		variant: typeof record.variant === 'string' ? record.variant : undefined
	};
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
