import type { TokenCounts, UsageRecord } from '../../../types';
import { computeCost } from '../../pricing/cost';
import { isoDayUTC } from '../../ingest/parse';

interface CodexParserContext {
	sessionId: string;
	project: string;
}

interface CodexLineParser {
	parse(line: string): UsageRecord | null;
}

interface TokenUsage {
	input_tokens?: number;
	cached_input_tokens?: number;
	output_tokens?: number;
	reasoning_output_tokens?: number;
}

export function createCodexLineParser(ctx: CodexParserContext): CodexLineParser {
	let currentModel = 'unknown';
	let currentProject = ctx.project;
	let sequence = 0;

	return {
		parse(line: string): UsageRecord | null {
			const obj = parseObject(line);
			if (!obj) return null;
			const type = stringValue(obj.type);
			const payload = objectValue(obj.payload);
			if (type === 'turn_context') {
				currentModel = stringValue(payload.model) ?? currentModel;
				currentProject = stringValue(payload.cwd) ?? currentProject;
				return null;
			}
			if (type !== 'event_msg' || stringValue(payload.type) !== 'token_count') return null;
			const timestamp = stringValue(obj.timestamp);
			if (!timestamp) return null;
			const ts = Date.parse(timestamp);
			if (!Number.isFinite(ts)) return null;
			const info = objectValue(payload.info);
			const usage = tokenUsage(objectValue(info.last_token_usage));
			const cached = usage.cached_input_tokens ?? 0;
			const promptTokens = usage.input_tokens ?? 0;
			const input = Math.max(promptTokens - cached, 0);
			const output = (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0);
			const tokens: TokenCounts = { input, output, cacheCreation: 0, cacheRead: cached };
			if (tokens.input === 0 && tokens.output === 0 && tokens.cacheRead === 0) return null;
			sequence += 1;
			return {
				key: `codex:${ctx.sessionId}:${sequence}`,
				provider: 'codex',
				timestamp: ts,
				day: isoDayUTC(ts),
				model: currentModel,
				tokens,
				cacheCreation1h: 0,
				cacheCreation5m: 0,
				webSearchRequests: 0,
				webFetchRequests: 0,
				sessionId: ctx.sessionId,
				project: currentProject,
				isSidechain: false,
				cost: computeCost(currentModel, tokens, 0, 0, promptTokens)
			};
		}
	};
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

function tokenUsage(value: Record<string, unknown>): TokenUsage {
	return {
		input_tokens: numberValue(value.input_tokens),
		cached_input_tokens: numberValue(value.cached_input_tokens),
		output_tokens: numberValue(value.output_tokens),
		reasoning_output_tokens: numberValue(value.reasoning_output_tokens)
	};
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
