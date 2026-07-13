import type { TokenCounts, UsageRecord } from '../../../types';
import { costFromPriceEntry } from '../../pricing/cost';
import { resolveModelsDevPrice } from '../../pricing/modelsdev';
import { isoDayUTC } from '../../ingest/parse';

// Pi (and its fork omp) append-only session JSONL, one object per line. The header
// line (`type:"session"`) carries the session `id` (uuidv7) + `cwd`; assistant
// `message` lines carry the billable usage. The parser is stateful because the
// dedup key and session/project attribution come from that first header line —
// like the codex parser tracking `turn_context`.
//
// CRITICAL token semantics (differs from codex): Pi's `usage.input` is ALREADY
// cache-exclusive, so we do NOT subtract cacheRead/cacheWrite from it (codex
// subtracts `cached_input_tokens` from `input_tokens`; Pi must not). `usage.output`
// already includes reasoning. `usage.cost` is IGNORED — chaching computes cost from
// its own pricing tables (models.dev resolver), same as opencode.

interface PiParserContext {
	/** fallback session id (the file's basename) used until/if the header line is seen */
	sessionId: string;
	/** fallback project used until/if the header line's `cwd` is seen */
	project: string;
}

interface PiLineParser {
	parse(line: string): UsageRecord | null;
}

export function createPiLineParser(ctx: PiParserContext): PiLineParser {
	// Header state, seeded from the filename fallback and overwritten by the
	// `type:"session"` line. Pi writes the header first, but we degrade gracefully
	// if a file is truncated ahead of it.
	let headerId = ctx.sessionId;
	let project = ctx.project;
	let sequence = 0;

	return {
		parse(line: string): UsageRecord | null {
			const obj = parseObject(line);
			if (!obj) return null;
			const type = stringValue(obj.type);

			if (type === 'session') {
				headerId = stringValue(obj.id) ?? headerId;
				project = stringValue(obj.cwd) ?? project;
				return null;
			}
			if (type !== 'message') return null;

			const message = objectValue(obj.message);
			// only assistant turns are billable
			if (stringValue(message.role) !== 'assistant') return null;

			const usage = objectValue(message.usage);
			// NB: NO cache subtraction — usage.input is already cache-exclusive.
			const input = numberValue(usage.input);
			const output = numberValue(usage.output); // already includes reasoning
			const cacheRead = numberValue(usage.cacheRead);
			const cacheCreation = numberValue(usage.cacheWrite);
			const tokens: TokenCounts = { input, output, cacheCreation, cacheRead };

			// Skip zero-usage turns (errored/aborted calls, e.g. a 429), matching codex.
			if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) return null;

			const ts = messageTimestamp(message, obj);
			if (ts === null) return null;

			const model = stringValue(message.model) ?? 'unknown';
			// message.provider (e.g. "zai", "openai-codex", "anthropic") selects the
			// pricing catalog only; the chaching provider tag is always "pi".
			const priceProvider = stringValue(message.provider) ?? '';
			const price = resolvePiPrice(priceProvider, model);
			const cost = price ? costFromPriceEntry(price, tokens) : null;

			sequence += 1;
			const entryId = stringValue(obj.id) ?? `seq-${sequence}`;

			return {
				key: `pi:${headerId}:${entryId}`,
				provider: 'pi',
				timestamp: ts,
				day: isoDayUTC(ts),
				model,
				tokens,
				cacheCreation1h: 0,
				cacheCreation5m: 0,
				webSearchRequests: 0,
				webFetchRequests: 0,
				sessionId: headerId,
				project,
				isSidechain: false,
				cost
			};
		}
	};
}

/**
 * Resolve a Pi (provider, model) pair through the models.dev resolver. When the
 * exact id is unknown and it carries uppercase (e.g. `MiniMax-M3`), retry with the
 * lowercased id, because models.dev catalog keys are lowercase (`minimax-m3`). The
 * retry only fires on an otherwise-unknown id, so it can never mis-price a known one.
 * Genuinely-unknown ids still return null (unpriced, flagged — never a faked $0).
 */
function resolvePiPrice(provider: string, model: string) {
	const hit = resolveModelsDevPrice(provider, model);
	if (hit) return hit;
	const lower = model.toLowerCase();
	if (lower !== model) {
		const lowered = resolveModelsDevPrice(provider, lower);
		if (lowered) return lowered;
	}
	return null;
}

/** Prefer the numeric `message.timestamp` (epoch ms); fall back to the ISO line timestamp. */
function messageTimestamp(
	message: Record<string, unknown>,
	obj: Record<string, unknown>
): number | null {
	const ms = message.timestamp;
	if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
	const iso = stringValue(obj.timestamp);
	if (iso) {
		const parsed = Date.parse(iso);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function parseObject(line: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(line);
		return objectValue(parsed);
	} catch {
		return null;
	}
}

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
