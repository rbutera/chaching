import type { TokenCounts, UsageRecord } from '../../../types';
import { isoDayUTC } from '../../ingest/parse';

interface CursorTokenUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheWriteTokens?: number;
	cacheReadTokens?: number;
	totalCents?: number;
	discountPercentOff?: number;
}

export interface CursorUsageEvent {
	timestamp: string;
	userEmail?: string;
	serviceAccountId?: string;
	serviceAccountName?: string;
	model: string;
	kind?: string;
	maxMode?: boolean;
	requestsCosts?: number;
	isTokenBasedCall?: boolean;
	isChargeable?: boolean;
	isHeadless?: boolean;
	tokenUsage?: CursorTokenUsage;
	chargedCents: number;
	cursorTokenFee?: number;
}

interface CursorFetchOptions {
	adminApiToken: string;
	startDate: number;
	endDate: number;
	email?: string;
	pageSize?: number;
	fetcher?: (request: Request) => Promise<Response>;
}

export function cursorEventToRecord(event: CursorUsageEvent): UsageRecord {
	const timestamp = Number(event.timestamp);
	const usage = event.tokenUsage ?? {};
	const tokens: TokenCounts = {
		input: usage.inputTokens ?? 0,
		output: usage.outputTokens ?? 0,
		cacheCreation: usage.cacheWriteTokens ?? 0,
		cacheRead: usage.cacheReadTokens ?? 0
	};
	const owner = event.userEmail ?? event.serviceAccountName ?? event.serviceAccountId ?? 'cursor';
	return {
		key: `cursor:${event.timestamp}:${owner}:${event.model}`,
		provider: 'cursor',
		timestamp,
		day: isoDayUTC(timestamp),
		model: event.model,
		tokens,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: `cursor:${event.timestamp}:${owner}`,
		project: owner,
		isSidechain: Boolean(event.isHeadless),
		cost: event.chargedCents / 100
	};
}

export async function fetchCursorUsageRecords(opts: CursorFetchOptions): Promise<UsageRecord[]> {
	const fetcher = opts.fetcher ?? fetch;
	const pageSize = opts.pageSize ?? 100;
	const records: UsageRecord[] = [];
	let page = 1;
	let hasNextPage = true;
	while (hasNextPage) {
		const body = opts.email
			? { startDate: opts.startDate, endDate: opts.endDate, email: opts.email, page, pageSize }
			: { startDate: opts.startDate, endDate: opts.endDate, page, pageSize };
		const request = new Request('https://api.cursor.com/teams/filtered-usage-events', {
			method: 'POST',
			headers: {
				authorization: `Basic ${Buffer.from(`${opts.adminApiToken}:`).toString('base64')}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		const response = await fetcher(request);
		if (!response.ok) throw new CursorApiError(response.status);
		const payload: unknown = await response.json();
		const parsed = parseUsageResponse(payload);
		records.push(...parsed.events.map(cursorEventToRecord));
		hasNextPage = parsed.hasNextPage;
		page += 1;
	}
	return records;
}

export class CursorApiError extends Error {
	constructor(readonly status: number) {
		super(`Cursor Admin API returned HTTP ${status}`);
	}
}

function parseUsageResponse(payload: unknown): { events: CursorUsageEvent[]; hasNextPage: boolean } {
	const root = objectValue(payload);
	const pagination = objectValue(root.pagination);
	const usageEvents = Array.isArray(root.usageEvents) ? root.usageEvents : [];
	return {
		events: usageEvents.map(parseEvent).filter((event) => event !== null),
		hasNextPage: Boolean(pagination.hasNextPage)
	};
}

function parseEvent(value: unknown): CursorUsageEvent | null {
	const event = objectValue(value);
	const timestamp = stringValue(event.timestamp);
	const model = stringValue(event.model);
	const chargedCents = numberValue(event.chargedCents);
	if (!timestamp || !model) return null;
	return {
		timestamp,
		userEmail: optionalString(event.userEmail),
		serviceAccountId: optionalString(event.serviceAccountId),
		serviceAccountName: optionalString(event.serviceAccountName),
		model,
		kind: optionalString(event.kind),
		maxMode: optionalBoolean(event.maxMode),
		requestsCosts: optionalNumber(event.requestsCosts),
		isTokenBasedCall: optionalBoolean(event.isTokenBasedCall),
		isChargeable: optionalBoolean(event.isChargeable),
		isHeadless: optionalBoolean(event.isHeadless),
		tokenUsage: parseTokenUsage(event.tokenUsage),
		chargedCents,
		cursorTokenFee: optionalNumber(event.cursorTokenFee)
	};
}

function parseTokenUsage(value: unknown): CursorTokenUsage | undefined {
	const usage = objectValue(value);
	if (Object.keys(usage).length === 0) return undefined;
	return {
		inputTokens: optionalNumber(usage.inputTokens),
		outputTokens: optionalNumber(usage.outputTokens),
		cacheWriteTokens: optionalNumber(usage.cacheWriteTokens),
		cacheReadTokens: optionalNumber(usage.cacheReadTokens),
		totalCents: optionalNumber(usage.totalCents),
		discountPercentOff: optionalNumber(usage.discountPercentOff)
	};
}

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}
