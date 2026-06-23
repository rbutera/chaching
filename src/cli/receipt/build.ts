// buildReceipt — pure transform from a RollupSnapshot + options to a ReceiptModel.
//
// Reuses the core aggregation (filterDays / sumGrain / aggregateByModel /
// aggregateByProvider) and the period scoping copied from stats.ts. NO aggregation
// is reimplemented here; this module only *shapes* the already-aggregated grain
// into the receipt's presentation model (line items, coupons, subtotals, total).

import type { Period, RollupSnapshot } from '../../lib/types.js';
import {
	aggregateByModel,
	filterDays,
	sumGrain,
	totalTokens
} from '../../lib/core/aggregate.js';
import { resolvePrice } from '../../lib/core/pricing/cost.js';
import { cacheCostBreakdown } from '../../lib/core/pricing/cache-breakdown.js';
import {
	buildSubsidisation,
	type ProviderSubsidisationConfig,
	type SubsidisedProvider
} from '../../lib/core/subsidisation.js';
import { modelFamily, modelLabel } from '../../lib/format.js';
import { periodWindow } from '../../lib/core/view-model.js';
import { WORDMARK } from '../theme/personality.js';
import type {
	ReceiptCoupon,
	ReceiptLineItem,
	ReceiptModel,
	ReceiptSubsidisation,
	ReceiptSubtotal
} from './model.js';

export interface BuildReceiptOptions {
	period?: Period;
	providers?: string[];
	/** suppress decorative copy (footer flourish) — barcode/structure stay */
	noArt?: boolean;
	/** optional fixed timestamp (epoch ms) for deterministic ref/barcode in tests */
	now?: number;
	/** optional footer copy (already resolved by the caller); empty under noArt */
	footer?: string;
	/**
	 * Optional per-provider subscription config. When present, the receipt gains a
	 * subsidisation footer. The multiple-vs-monthly-fee is shown only when the
	 * receipt's period is month (or all-time/default → current-month headline); a
	 * `--period week`/`day` receipt honestly says "this week/today" and omits the
	 * monthly multiple to avoid comparing a partial period of burn to a month of fee.
	 */
	subscription?: Record<SubsidisedProvider, ProviderSubsidisationConfig>;
	/**
	 * Explicit day range override (inclusive `YYYY-MM-DD` bounds). When present it
	 * WINS over `period`'s computed range — used by the web "Receipt" button to pin
	 * a single focused day (the dashboard's drill-in). `period` still drives the
	 * label + subsidisation basis; only the scoped grain comes from this range.
	 */
	range?: { from: string; to: string };
	/**
	 * Real "user@host" for the header's user·path line. Supplied by the Node callers
	 * (CLI `receipt` + web PNG route) via `currentAccount()`. Kept as an injected
	 * option so `buildReceipt` stays pure/deterministic for tests (no `os` read here).
	 */
	account?: string;
}

/**
 * The ROLLING window the receipt scopes its line items + TOTAL BURN through — the
 * SAME `periodWindow` the dashboard hero uses, anchored at `snap.latestDay` (NOT
 * `now`). day=latest day, week=last 7, month=last 30, quarter=last 90,
 * all=earliest..latest. This is what makes `receipt --period month` total equal the
 * dashboard's "month" hero for every period.
 *
 * An absent `period` is coerced to `month` here (the receipt's default), so callers
 * need not pre-resolve it — but the receipt command + web route both pass an explicit
 * period anyway.
 *
 * When the snapshot has NO data (no earliest/latest day), `periodWindow` returns a
 * `1970-01-01` sentinel; we surface that as `{ from: undefined, to: undefined }` so
 * the empty-state receipt shows no range line instead of a bogus 1970 date (and so
 * the bounds match `periodDayRange`'s undefined-on-no-data shape for `filterDays`).
 */
export function rollingPeriodRange(
	snapshot: RollupSnapshot,
	period: Period | undefined
): { from: string | undefined; to: string | undefined } {
	if (snapshot.earliestDay == null && snapshot.latestDay == null) {
		return { from: undefined, to: undefined };
	}
	const w = periodWindow(snapshot, {
		period: period ?? 'month',
		modelFilter: new Set(),
		providerFilter: new Set(),
		focusedDay: null
	});
	return { from: w.from, to: w.to };
}

/** Human label for the period token. */
function periodLabelOf(period: Period | undefined): string {
	switch (period) {
		case 'day':
			return 'today';
		case 'week':
			return 'this week';
		case 'month':
			return 'this month';
		case 'quarter':
			return 'this quarter';
		default:
			return 'all time';
	}
}

/**
 * Deterministic faux-barcode line derived from total + ref. Block glyphs vary
 * width by the digits of a stable hash, so the SAME snapshot+timestamp always
 * produces the SAME barcode (asserted by a test) — never random.
 */
function fauxBarcode(seed: string): string {
	// FNV-1a → hex; map nibbles to barcode-ish vertical block runs.
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	const hex = (h >>> 0).toString(16).padStart(8, '0') + (seed.length * 2654435761 >>> 0).toString(16).padStart(8, '0');
	const bars = ['▏', '▎', '▍', '▌', '▋', '█'];
	let out = '';
	for (const ch of hex) {
		const n = parseInt(ch, 16);
		out += bars[n % bars.length];
		out += ' ▏'[n % 2]; // alternate a thin gap
	}
	return out.trim();
}

/** Short deterministic ref code from the seed. */
function refCode(seed: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
}

/**
 * Build the pure ReceiptModel from a snapshot. Scopes by period + provider,
 * computes line items / coupons / subtotals / total, assembles header + barcode.
 */
export function buildReceipt(snapshot: RollupSnapshot, opts: BuildReceiptOptions = {}): ReceiptModel {
	const now = opts.now != null ? new Date(opts.now) : new Date();
	// Scope the line items + TOTAL BURN through the SAME rolling window the dashboard
	// uses (`periodWindow`, anchored at `snap.latestDay`), so `receipt --period X` total
	// matches the dashboard's hero for every period. We do NOT use the calendar
	// `periodDayRange` (anchored at `now`): that drifts whenever there is no data "today"
	// (e.g. receipt month = Jun-1→today vs dashboard month = rolling latestDay-29→latestDay).
	// An explicit `opts.range` (the web focused-day pin) still wins over the period window.
	const { from, to } = opts.range
		? { from: opts.range.from, to: opts.range.to }
		: rollingPeriodRange(snapshot, opts.period);
	const providerFilter =
		opts.providers && opts.providers.length > 0 ? new Set(opts.providers) : null;

	let grain = filterDays(snapshot.dayModel, from, to);
	if (providerFilter) {
		grain = grain.filter((dm) => providerFilter.has(dm.provider));
	}

	const periodLabel = periodLabelOf(opts.period);
	const wordmark = WORDMARK;
	const empty = grain.length === 0;

	// Resolve the actual covered day range from the grain (so the header shows
	// real data bounds, not just the requested window).
	let coveredFrom: string | null = null;
	let coveredTo: string | null = null;
	for (const dm of grain) {
		if (coveredFrom === null || dm.day < coveredFrom) coveredFrom = dm.day;
		if (coveredTo === null || dm.day > coveredTo) coveredTo = dm.day;
	}

	if (empty) {
		const seed = `empty:${periodLabel}:${now.toISOString().slice(0, 10)}`;
		return {
			wordmark,
			periodLabel,
			period: opts.period,
			from: from ?? null,
			to: to ?? null,
			providers: opts.providers ?? null,
			account: opts.account ?? null,
			lineItems: [],
			coupons: [],
			youSaved: 0,
			cacheCost: {
				cacheReadTokens: 0,
				cacheReadCost: 0,
				cacheWriteTokens: 0,
				cacheWriteCost: 0,
				savedVsUncached: 0
			},
			subsidisation: null,
			subtotals: [],
			totalBurn: 0,
			totalTokens: 0,
			requests: 0,
			costUnknownRequests: 0,
			unknownPriceModels: [],
			footer: opts.noArt ? '' : (opts.footer ?? ''),
			barcode: fauxBarcode(seed),
			ref: refCode(seed),
			empty: true
		};
	}

	const totals = sumGrain(grain);
	const byModel = aggregateByModel(grain);

	// Line items: one per (provider, model). We re-aggregate the grain by the
	// (provider, model) pair so a model used under two providers is itemised
	// separately (the receipt reads like a real itemised bill).
	const itemMap = new Map<string, ReceiptLineItem>();
	for (const dm of grain) {
		const key = `${dm.provider} ${dm.model}`;
		let it = itemMap.get(key);
		if (!it) {
			const price = resolvePrice(dm.model);
			it = {
				provider: dm.provider,
				model: dm.model,
				modelLabel: modelLabel(dm.model),
				family: modelFamily(dm.model),
				tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
				requests: 0,
				cost: 0,
				unknownPrice: price === null
			};
			itemMap.set(key, it);
		}
		it.tokens.input += dm.tokens.input;
		it.tokens.output += dm.tokens.output;
		it.tokens.cacheCreation += dm.tokens.cacheCreation;
		it.tokens.cacheRead += dm.tokens.cacheRead;
		it.requests += dm.requests;
		it.cost += dm.cost;
	}
	// Group by provider (provider with most spend first), then by model cost
	// within each provider, so the receipt reads like a real itemised bill with
	// one header per provider rather than interleaving providers by cost.
	const providerCost = new Map<string, number>();
	for (const it of itemMap.values()) {
		providerCost.set(it.provider, (providerCost.get(it.provider) ?? 0) + it.cost);
	}
	const lineItems = [...itemMap.values()].sort((a, b) => {
		const pc = (providerCost.get(b.provider) ?? 0) - (providerCost.get(a.provider) ?? 0);
		if (pc !== 0) return pc;
		if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
		return b.cost - a.cost;
	});

	// Coupons: per-model cache-read savings. saved = cacheRead × (inputRate − readRate),
	// both rates sourced from resolvePrice (never hardcoded). Unknown-price models
	// contribute NO coupon. The coupon is narrative only — it is NEVER subtracted
	// from TOTAL BURN (which is totals.cost verbatim).
	const coupons: ReceiptCoupon[] = [];
	let youSaved = 0;
	for (const m of byModel) {
		const cacheRead = m.tokens.cacheRead;
		if (cacheRead <= 0) continue;
		const price = resolvePrice(m.model);
		if (!price) continue; // unknown price → no coupon
		const inputRate = price.input_cost_per_token;
		const readRate = price.cache_read_input_token_cost;
		const wouldHaveCost = cacheRead * inputRate;
		const actualCost = cacheRead * readRate;
		const saved = Math.max(0, wouldHaveCost - actualCost);
		if (saved <= 0) continue;
		coupons.push({
			model: m.model,
			modelLabel: modelLabel(m.model),
			family: modelFamily(m.model),
			cacheReadTokens: cacheRead,
			wouldHaveCost,
			actualCost,
			saved
		});
		youSaved += saved;
	}
	coupons.sort((a, b) => b.saved - a.saved);

	// Per-family subtotals.
	const famMap = new Map<ReceiptSubtotal['family'], ReceiptSubtotal>();
	for (const it of lineItems) {
		let s = famMap.get(it.family);
		if (!s) {
			s = { family: it.family, cost: 0, requests: 0 };
			famMap.set(it.family, s);
		}
		s.cost += it.cost;
		s.requests += it.requests;
	}
	const familyOrder: ReceiptSubtotal['family'][] = ['opus', 'sonnet', 'haiku', 'other'];
	const subtotals = familyOrder
		.map((f) => famMap.get(f))
		.filter((s): s is ReceiptSubtotal => s !== undefined);

	const unknownPriceModels = [
		...new Set(lineItems.filter((it) => it.unknownPrice).map((it) => it.model))
	];

	// Billed cache-cost breakdown over the SAME scoped grain — reads and writes as
	// charged line items, every rate from resolvePrice (no hardcoded constants).
	const { combined: cacheBreakdown } = cacheCostBreakdown(grain);
	const cacheCost = {
		cacheReadTokens: cacheBreakdown.cacheReadTokens,
		cacheReadCost: cacheBreakdown.cacheReadCost,
		cacheWriteTokens: cacheBreakdown.cacheWriteTokens,
		cacheWriteCost: cacheBreakdown.cacheWriteCost,
		savedVsUncached: cacheBreakdown.savedVsUncached
	};

	// Optional subsidisation footer. The basis is the receipt's own period scope:
	// month / all-time(default) → current-month headline (multiple is meaningful);
	// week / day → that period's burn, monthly multiple omitted (period mismatch).
	let subsidisation: ReceiptSubsidisation | null = null;
	if (opts.subscription) {
		const monthBasis = opts.period === 'month' || opts.period === undefined;
		if (monthBasis) {
			// Month-to-date burn vs full monthly fee, combined across enabled providers.
			const rollup = buildSubsidisation(snapshot.dayModel, opts.subscription, now);
			subsidisation = {
				periodLabel: 'this month',
				monthBasis: true,
				monthlyUsd: rollup.combined.monthlyUsd,
				apiEquivalentUsd: rollup.combined.mtd.apiEquivalentUsd,
				netSubsidyUsd: rollup.combined.mtd.netSubsidyUsd,
				multiple: rollup.combined.mtd.multiple
			};
		} else {
			// Period-scoped burn for the enabled subsidised providers; no monthly multiple.
			const subsidisedSet = new Set<string>(
				(['claude', 'codex'] as SubsidisedProvider[]).filter(
					(p) => opts.subscription?.[p].enabled
				)
			);
			const monthlyUsd = (['claude', 'codex'] as SubsidisedProvider[])
				.filter((p) => opts.subscription?.[p].enabled)
				.reduce((sum, p) => sum + (opts.subscription?.[p].monthlyUsd ?? 0), 0);
			const periodBurn = sumGrain(grain, { providers: subsidisedSet }).cost;
			subsidisation = {
				periodLabel,
				monthBasis: false,
				monthlyUsd,
				apiEquivalentUsd: periodBurn,
				netSubsidyUsd: periodBurn - monthlyUsd,
				multiple: null
			};
		}
	}

	// Deterministic seed: total + covered range + provider/period scope. NOT
	// time-of-render, so the same data renders the same barcode.
	const seed = [
		totals.cost.toFixed(6),
		coveredFrom ?? '',
		coveredTo ?? '',
		opts.period ?? 'all',
		(opts.providers ?? []).join(',')
	].join('|');

	return {
		wordmark,
		periodLabel,
		period: opts.period,
		from: coveredFrom,
		to: coveredTo,
		providers: opts.providers ?? null,
		account: opts.account ?? null,
		lineItems,
		coupons,
		youSaved,
		cacheCost,
		subsidisation,
		subtotals,
		totalBurn: totals.cost,
		totalTokens: totalTokens(totals.tokens),
		requests: totals.requests,
		costUnknownRequests: totals.costUnknownRequests,
		unknownPriceModels,
		footer: opts.noArt ? '' : (opts.footer ?? ''),
		barcode: fauxBarcode(seed),
		ref: `${refCode(seed)} · ${coveredTo ?? coveredFrom ?? ''}`,
		empty: false
	};
}
