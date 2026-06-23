// Shared types for chaching — used by both the server ingester and the client UI.

/** The four billable token classes from Claude Code's message.usage. */
export interface TokenCounts {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
}

/** A single parsed, billable assistant usage record (one API response). */
export interface UsageRecord {
	/** dedup key: `${message.id}:${requestId}` (or a synthetic key if either is null) */
	key: string;
	provider: string;
	timestamp: number; // epoch ms (UTC)
	day: string; // YYYY-MM-DD (UTC)
	model: string; // bare Claude Code model id, e.g. claude-opus-4-8
	tokens: TokenCounts;
	cacheCreation1h: number;
	cacheCreation5m: number;
	webSearchRequests: number;
	webFetchRequests: number;
	sessionId: string;
	project: string; // decoded project dir name
	isSidechain: boolean;
	/** computed estimate; null when the model has no known price */
	cost: number | null;
}

/** Per-(day, provider, model) aggregate. */
export interface DayModelAgg {
	day: string;
	provider: string;
	model: string;
	tokens: TokenCounts;
	requests: number;
	cost: number; // 0 if unknown-price contributed (see costUnknownRequests)
	costUnknownRequests: number;
}

/** Per-session summary for the session index / drill-down. */
export interface SessionSummary {
	sessionId: string;
	provider: string;
	project: string;
	firstTs: number;
	lastTs: number;
	tokens: TokenCounts;
	requests: number;
	cost: number;
	costUnknownRequests: number;
	models: string[]; // model mix, most-used first
}

/** Rolling 5-hour-block (cap-proximity) entry. */
export interface BlockSummary {
	startTs: number; // epoch ms, block start (first message in the block)
	endTs: number; // startTs + 5h
	tokens: TokenCounts;
	requests: number;
	cost: number;
	isActive: boolean; // now < endTs
}

/** The full snapshot pushed to the client over SSE on connect. */
export interface RollupSnapshot {
	generatedAt: number;
	earliestDay: string | null;
	latestDay: string | null;
	totals: {
		tokens: TokenCounts;
		requests: number;
		cost: number;
		costUnknownRequests: number;
	};
	/** every per-(day, provider, model) aggregate, flat. The client re-aggregates to week/month/etc. */
	dayModel: DayModelAgg[];
	/** session index, newest-last-activity first */
	sessions: SessionSummary[];
	/** rolling 5-hour blocks, newest first */
	blocks: BlockSummary[];
	/** distinct models seen, by total cost desc */
	models: string[];
	providers: string[];
	/** models that appeared but had no price entry (cost reported as unknown) */
	unknownPriceModels: string[];
	/** files scanned + records counted, for transparency */
	stats: {
		filesScanned: number;
		recordsCounted: number;
		linesSkipped: number;
		duplicatesSkipped: number;
	};
	/** the configured work/personal cutover timestamp (epoch ms) if set, else null */
	cutoverTs: number | null;
}

/** Incremental delta emitted after the cold scan when new lines are tailed. */
export interface RollupDelta {
	generatedAt: number;
	/** the new/updated per-(day,provider,model) aggregates to merge by (day,provider,model) */
	dayModel: DayModelAgg[];
	/** new/updated session summaries to merge by sessionId */
	sessions: SessionSummary[];
	/** full recomputed blocks (cheap) so the active-block view stays correct */
	blocks: BlockSummary[];
	totals: RollupSnapshot['totals'];
	earliestDay: string | null;
	latestDay: string | null;
	models: string[];
	providers: string[];
	unknownPriceModels: string[];
	stats: RollupSnapshot['stats'];
}

export type SSEMessage =
	| { type: 'snapshot'; data: RollupSnapshot }
	| { type: 'delta'; data: RollupDelta };

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'all';
