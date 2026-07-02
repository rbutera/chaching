// The WrappedModel — the single pure data structure the text renderer, the --json
// output, AND the PNG template all consume (same discipline as the ReceiptModel:
// the surfaces can't drift because they render one model). `chaching wrapped` is
// the receipt's fun cousin — a Spotify-Wrapped-style MONTHLY recap in the same
// thermal-receipt voice — so this mirrors receipt/model.ts's shape and honesty
// rules (cost never fabricated; comparisons gated on a real prior window).

import type { TokenCounts } from '../../lib/types.js';

/** The headline totals for the recap month. */
export interface WrappedHeadline {
	cost: number;
	tokens: number;
	requests: number;
	/** requests whose model had no known price (cost is an underestimate) */
	costUnknownRequests: number;
}

/** The month's top model by cost, with its share of the month's spend. */
export interface WrappedTopModel {
	model: string;
	modelLabel: string;
	family: 'opus' | 'sonnet' | 'haiku' | 'other';
	cost: number;
	/** cost / headline.cost, in [0, 1]; 0 when the month had no spend */
	share: number;
	tokens: number;
	requests: number;
}

/**
 * The month's top project by cost. Attribution follows the session OVERLAP rule
 * (`inWindow`): a session that straddles the month boundary counts in this month
 * AND its neighbour, so the label is "top project" not "spend confined to the
 * month". `isUnknown` marks the empty/unknown-project bucket (never dropped —
 * cost honesty). `display` is the short (last-segment) name and is PII-scrubbable.
 */
export interface WrappedTopProject {
	display: string;
	/**
	 * Whole-session cost attributed to this project (the session OVERLAP lineage,
	 * NOT the dayModel one). Deliberately NOT expressed as a share of the headline:
	 * a session straddling the month boundary is counted whole, so the session total
	 * does not reconcile with the calendar-scoped headline and a "% of spend" here
	 * could exceed 100% (cost honesty — see stats.ts "whole sessions in window").
	 */
	cost: number;
	sessionCount: number;
	isUnknown: boolean;
}

/** Cache savings for the month — the "you saved" narrative + the billed reality. */
export interface WrappedCache {
	cacheReadTokens: number;
	/** what the reads billed at the cache-read rate */
	cacheReadCost: number;
	cacheWriteTokens: number;
	/** what the writes billed at the cache-create rate */
	cacheWriteCost: number;
	/** what the reads WOULD have cost uncached, less what they billed (the savings) */
	savedVsUncached: number;
}

/** The single most expensive day of the month. */
export interface WrappedBiggestDay {
	/** ISO YYYY-MM-DD */
	day: string;
	cost: number;
}

/**
 * Month-over-month delta vs the PRIOR calendar month. Present ONLY when the prior
 * month is a genuine baseline: every one of its days is authoritative (frozen or
 * zero — no `partial`/`missing`), it lies wholly inside the banked range, and its
 * total is non-zero (same gate as the dashboard's `priorHasBaseline`). Otherwise
 * the whole comparison is omitted (`WrappedModel.momDelta` is null) — never a
 * fabricated percentage.
 */
export interface WrappedMomDelta {
	/** prior calendar month label, e.g. "2026-05" */
	priorMonth: string;
	priorCost: number;
	/** thisMonthCost − priorCost */
	deltaUsd: number;
	/** (thisMonthCost − priorCost) / priorCost; priorCost is guaranteed > 0 here */
	deltaPct: number;
}

/** The optional subscription-subsidy multiple for the month. */
export interface WrappedSubsidy {
	/** combined flat monthly fee across enabled subsidised providers */
	monthlyUsd: number;
	/** API-equivalent burn for the month (month-to-date when the month is current) */
	apiEquivalentUsd: number;
	/** apiEquivalentUsd − monthlyUsd */
	netSubsidyUsd: number;
	/** apiEquivalentUsd / monthlyUsd, or null for a $0 (Free) fee → "∞ — all of it" */
	multiple: number | null;
}

/** The full pure wrapped model. */
export interface WrappedModel {
	/** wordmark / store line for the header (redaction-safe) */
	wordmark: string;
	/** the recap month, ISO `YYYY-MM` */
	month: string;
	/** human month label, e.g. "July 2026" */
	monthLabel: string;
	/** true when the recap month is the current (still-accruing) calendar month */
	monthToDate: boolean;
	/** inclusive day range actually covered by data, ISO YYYY-MM-DD; null when empty */
	from: string | null;
	to: string | null;
	/** real "user@host" for the header (shown by default; scrubbed on --redact) */
	account?: string | null;

	headline: WrappedHeadline;
	topModel: WrappedTopModel | null;
	topProject: WrappedTopProject | null;
	cache: WrappedCache;
	biggestDay: WrappedBiggestDay | null;
	/** null when the prior month is not a full baseline (comparison omitted) */
	momDelta: WrappedMomDelta | null;
	/** null when no subscription is configured/enabled */
	subsidy: WrappedSubsidy | null;

	/** the wry personality footer line (empty under --no-art) */
	footer: string;
	/** deterministic faux-barcode glyph line */
	barcode: string;
	/** deterministic ref line (e.g. "REF 4F2A · 2026-07") */
	ref: string;

	/** true when the month had no data at all (empty-state recap) */
	empty: boolean;
}

/** The JSON shape emitted by `wrapped --json` (model + pricing provenance). */
export interface WrappedJson {
	wrapped: WrappedModel;
	_pricing: { snapshotDate: string | null; source: string | null };
}
