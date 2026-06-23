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

/**
 * Per-calendar-day trustworthiness of the spend numbers. Derived from the freeze
 * model (which days are finalized in the history DB) plus the engine's "today" and
 * its freeze-gating partial signal. Four states, in priority order:
 *
 * - `frozen`  — a past day finalized in the history DB, with spend. Authoritative.
 * - `zero`    — a past frozen day with genuine $0 (we were running; no usage). NOT a gap.
 * - `partial` — today (the live tail), OR a past day scanned-but-not-yet-frozen because
 *               this run's scan was gated partial (read/provider error). Not final.
 * - `missing` — inside the requested range but neither frozen nor scanned-with-data
 *               (logs pruned by retention, or chaching wasn't running). Distinct from `zero`.
 *
 * `missing` is RANGE-RELATIVE: the snapshot `coverage` map only carries days the data
 * layer has an opinion about (frozen / zero / partial). The view-model fills `missing`
 * for any in-window day absent from the map (the single place it is materialized).
 */
export type DayCoverage = 'frozen' | 'partial' | 'missing' | 'zero';

/** day (YYYY-MM-DD UTC) -> its coverage state. Only days-with-an-opinion are keys. */
export type CoverageMap = Record<string, DayCoverage>;

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
	/**
	 * Per-day coverage for the days the data layer has an opinion about (frozen / zero /
	 * partial). Absent days are NOT keys — `missing` is range-relative and filled by the
	 * view-model over its window. Additive: older clients ignore it. NOT threaded through
	 * `RollupDelta` (the hot path stays lean; coverage is recomputed from the next snapshot).
	 */
	coverage: CoverageMap;
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
