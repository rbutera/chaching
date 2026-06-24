import { DatabaseSync } from 'node:sqlite';
import type { TokenCounts, UsageRecord } from '../../../types';
import { isoDayUTC } from '../../ingest/parse';
import { resolveModelsDevPrice } from '../../pricing/modelsdev';
import type { PriceEntry } from '../../pricing/overrides';

// The current OpenCode schema keeps per-message usage in the `message` table; the
// `session` table no longer carries token/cost/model columns. Each `message.data`
// is a JSON blob — assistant blobs carry role, modelID, providerID, tokens
// {input, output, reasoning, cache:{write, read}}, cost, path {cwd, root}, agent,
// time {created, completed}, and (when aborted/errored) an `error` field.
//
// We emit ONE UsageRecord per surviving assistant message, priced via the
// models.dev resolver and the same per-token math cost.ts uses. `data.cost` is 0
// for the bulk of rows (Zen/subscription), so we ignore it unless the resolver is
// null AND it is a positive fallback. ALL rows are `provider: "opencode"` here —
// cursor-acp attribution is a separate change.

interface OpenCodeMessageRow {
	id: string;
	session_id: string;
	time_created: number;
	time_updated: number;
	data: string;
}

export async function readOpenCodeSessions(dbPath: string): Promise<UsageRecord[]> {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(`SELECT id, session_id, time_created, time_updated, data FROM message`)
			.all() as unknown as OpenCodeMessageRow[];
		const records: UsageRecord[] = [];
		for (const row of rows) {
			const rec = rowToRecord(row);
			if (rec) records.push(rec);
		}
		return records;
	} finally {
		db.close();
	}
}

function rowToRecord(row: OpenCodeMessageRow): UsageRecord | null {
	const raw = typeof row.data === 'string' ? row.data : null;
	if (!raw) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const data = parsed as Record<string, unknown>;

	// keep only assistant messages
	if (data.role !== 'assistant') return null;
	// skip aborted/errored rows
	if (data.error != null) return null;

	const tok = asRecord(data.tokens);
	const cache = asRecord(tok.cache);
	const input = numberValue(tok.input);
	const output = numberValue(tok.output);
	const reasoning = numberValue(tok.reasoning);
	const cacheWrite = numberValue(cache.write);
	const cacheRead = numberValue(cache.read);

	// skip rows whose mapped tokens are all zero
	if (input + output + reasoning + cacheWrite + cacheRead === 0) return null;

	const tokens: TokenCounts = {
		input,
		output: output + reasoning,
		cacheCreation: cacheWrite,
		cacheRead
	};

	const time = asRecord(data.time);
	const timestamp =
		numberOrNull(time.completed) ??
		numberOrNull(time.created) ??
		numberOrNull(row.time_updated) ??
		numberValue(row.time_created);

	const path = asRecord(data.path);
	const project =
		stringOrNull(path.cwd) ?? stringOrNull(data.agent) ?? 'opencode';

	const modelID = stringOrNull(data.modelID) ?? 'unknown';
	const providerID = stringOrNull(data.providerID) ?? '';

	return {
		key: `opencode:${row.id}`,
		provider: 'opencode',
		timestamp,
		day: isoDayUTC(timestamp),
		model: modelID,
		tokens,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: row.session_id,
		project,
		isSidechain: false,
		cost: computeCost(providerID, modelID, tokens, numberValue(data.cost))
	};
}

// Resolve a price from models.dev and compute per-token cost (same formula as
// cost.ts). When the resolver is null, fall back to the blob's own cost only when
// it is positive; otherwise null (unknown — never a faked $0).
function computeCost(
	providerID: string,
	modelID: string,
	tokens: TokenCounts,
	blobCost: number
): number | null {
	const price = resolveModelsDevPrice(providerID, modelID);
	if (price) return costFromEntry(price, tokens);
	return blobCost > 0 ? blobCost : null;
}

function costFromEntry(price: PriceEntry, tokens: TokenCounts): number {
	return (
		tokens.input * price.input_cost_per_token +
		tokens.output * price.output_cost_per_token +
		tokens.cacheCreation * price.cache_creation_input_token_cost +
		tokens.cacheRead * price.cache_read_input_token_cost
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
