// The ReceiptModel — the single pure data structure that the text renderer,
// the --json output, AND the PNG template all consume. By construction the three
// surfaces can never drift: they render the same model.

import type { Period, TokenCounts } from '../../lib/types.js';

/** One provider/model line item on the receipt. */
export interface ReceiptLineItem {
	/** raw provider id (redactable-safe: providers are not PII) */
	provider: string;
	/** raw model id */
	model: string;
	/** display label for the model, e.g. "Opus 4.8" */
	modelLabel: string;
	/** model family bucket: opus | sonnet | haiku | other */
	family: 'opus' | 'sonnet' | 'haiku' | 'other';
	tokens: TokenCounts;
	requests: number;
	cost: number;
	/** true when this model has no known price (cost is an underestimate / $0) */
	unknownPrice: boolean;
}

/** A cache-read coupon — the narrative "you saved" line for one model. */
export interface ReceiptCoupon {
	model: string;
	modelLabel: string;
	family: 'opus' | 'sonnet' | 'haiku' | 'other';
	/** cache-read tokens that earned the discount */
	cacheReadTokens: number;
	/** what those tokens WOULD have cost at the fresh-input rate */
	wouldHaveCost: number;
	/** what they actually cost at the cache-read rate */
	actualCost: number;
	/** wouldHaveCost - actualCost; always >= 0 */
	saved: number;
}

/**
 * The billed cache-cost breakdown — what cache reads and writes actually COST,
 * alongside the narrative savings. Makes it unmistakable that cache is charged,
 * not free. Every figure derives from `resolvePrice` (no hardcoded rates).
 */
export interface ReceiptCacheCost {
	cacheReadTokens: number;
	/** Σ cacheRead × cache-read rate — the BILLED read cost */
	cacheReadCost: number;
	cacheWriteTokens: number;
	/** Σ cacheCreation × cache-write rate — the BILLED write cost */
	cacheWriteCost: number;
	/** what reads would have cost uncached, less what they billed (the savings) */
	savedVsUncached: number;
}

/** The optional subsidisation footer — flat-fee value framing for one slice. */
export interface ReceiptSubsidisation {
	/** the period label this subsidisation line is computed over (e.g. "this month") */
	periodLabel: string;
	/** true when the basis is a full calendar month (so the multiple-vs-fee is meaningful) */
	monthBasis: boolean;
	/** combined flat monthly fee across enabled subsidised providers */
	monthlyUsd: number;
	/** API-equivalent burn compared against the fee (month-to-date when monthBasis) */
	apiEquivalentUsd: number;
	/** apiEquivalentUsd − monthlyUsd */
	netSubsidyUsd: number;
	/** apiEquivalentUsd / monthlyUsd, or null for a $0 (Free) fee → "∞ — all of it" */
	multiple: number | null;
}

/** A per-family subtotal block. */
export interface ReceiptSubtotal {
	family: 'opus' | 'sonnet' | 'haiku' | 'other';
	cost: number;
	requests: number;
}

/** The full pure receipt model. */
export interface ReceiptModel {
	/** wordmark / store line for the header (already redaction-safe) */
	wordmark: string;
	/** human period label, e.g. "all time" or "week" */
	periodLabel: string;
	/** the period token (undefined = all time) */
	period?: Period;
	/** inclusive date range covered, ISO YYYY-MM-DD; null when no data */
	from: string | null;
	to: string | null;
	/** provider filter applied, if any */
	providers: string[] | null;
	/**
	 * Real "user@host" for the header's user·path line (the machine the receipt was
	 * cut on). Shown verbatim by DEFAULT; scrubbed to a redaction block only when the
	 * caller opts in (`--redact` / `?redact=1`). Absent/undefined → the design's
	 * placeholder block (back-compat for callers that don't supply identity).
	 */
	account?: string | null;

	/** per-provider/model line items, most-expensive first */
	lineItems: ReceiptLineItem[];
	/** cache-read coupons, most-saved first */
	coupons: ReceiptCoupon[];
	/** Σ coupon.saved */
	youSaved: number;
	/** billed cache-read + cache-write cost (the "cache is not free" line items) */
	cacheCost: ReceiptCacheCost;
	/** optional subsidisation footer (present only when a subscription is supplied) */
	subsidisation: ReceiptSubsidisation | null;
	/** per-family subtotals */
	subtotals: ReceiptSubtotal[];

	/** the bold TOTAL BURN = totals.cost verbatim (never net of coupons again) */
	totalBurn: number;
	/** total billable tokens across all classes */
	totalTokens: number;
	/** total requests */
	requests: number;
	/** number of requests whose model had unknown pricing */
	costUnknownRequests: number;
	/** distinct unknown-price model ids in scope */
	unknownPriceModels: string[];

	/** the wry personality footer line (empty under --no-art) */
	footer: string;
	/** deterministic faux-barcode glyph line */
	barcode: string;
	/** deterministic receipt timestamp/ref line (e.g. "REF 4F2A · 2026-06-22") */
	ref: string;

	/** true when there was no data at all (empty-state receipt) */
	empty: boolean;
}

/** The JSON shape emitted by `receipt --json` (model + scoped totals + pricing). */
export interface ReceiptJson {
	receipt: ReceiptModel;
	totals: {
		tokens: TokenCounts;
		cost: number;
		requests: number;
		costUnknownRequests: number;
	};
	_pricing: { snapshotDate: string | null; source: string | null };
}
