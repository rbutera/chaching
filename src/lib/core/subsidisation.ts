// Shared fee comparisons for calendar-month reports and selected date windows.

import type { DayModelAgg } from '../types';
import { sumGrain } from './aggregate';

/** Providers whose API-equivalent cost chaching computes → subsidisation applies. */
export const SUBSIDISED_PROVIDERS = ['claude', 'codex'] as const;
export type SubsidisedProvider = (typeof SUBSIDISED_PROVIDERS)[number];

export interface SubsidisationInput {
	/** the API-equivalent burn for the slice (per-provider month-to-date, or combined) */
	apiEquivalentUsd: number;
	/** the flat monthly fee for the slice */
	monthlyUsd: number | null;
}

export interface Subsidisation {
	apiEquivalentUsd: number;
	monthlyUsd: number | null;
	/** apiEquivalentUsd − monthlyUsd; negative when the fee exceeds the value used */
	netSubsidyUsd: number | null;
	/** Null for unknown or zero fees; subsidyMultipleText distinguishes their display. */
	multiple: number | null;
}

export function computeSubsidisation({
	apiEquivalentUsd,
	monthlyUsd
}: SubsidisationInput): Subsidisation {
	const fee = monthlyUsd === null ? null : Number.isFinite(monthlyUsd) && monthlyUsd >= 0 ? monthlyUsd : null;
	const burn = Number.isFinite(apiEquivalentUsd) && apiEquivalentUsd > 0 ? apiEquivalentUsd : 0;
	return {
		apiEquivalentUsd: burn,
		monthlyUsd: fee,
		netSubsidyUsd: fee === null ? null : burn - fee,
		multiple: fee !== null && fee > 0 ? burn / fee : null
	};
}

/** The current-calendar-month [from, to] day range (UTC), inclusive. */
export function monthToDateRange(now: Date = new Date()): { from: string; to: string } {
	const today = now.toISOString().slice(0, 10);
	return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Fraction of the current calendar month elapsed (days incl. today / days in month), in (0, 1]. */
export function fractionOfMonthElapsed(now: Date = new Date()): number {
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	const daysElapsed = now.getUTCDate(); // 1..31, includes today
	const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return daysElapsed / daysInMonth;
}

export interface BurnPace {
	/** month-to-date cost, [month-start, today] inclusive (UTC) */
	mtdCost: number;
	/** day-of-month of `now` (UTC), 1..31 — the denominator of the pace, includes today */
	elapsedDays: number;
	daysInMonth: number;
	/** mtdCost / elapsedDays * daysInMonth — "on pace for ~$X this month" */
	projectedCost: number;
}

/**
 * Burn-pace projection: "on pace for ~$X this month", the dashboard's forward
 * headline (distinct from `monthlyBurn`, which the subsidy math scales by
 * elapsed FRACTION — this is the plain day-count version driving its own UI
 * stat). Cost-honesty hard rule (see CLAUDE.md "Conventions"): two guards
 * return `null` rather than a fabricated figure, and the caller must render
 * nothing when that happens.
 *
 * GUARD (a) sample size: `elapsedDays < 3` extrapolates a whole month from a
 * 1-2 day sample, which fabricates precision the data doesn't support.
 *
 * GUARD (b) unknown-priced spend: an MTD request whose model has no known
 * price contributes $0 to `mtdCost`, so the projection would silently
 * understate the pace while rendering as a precise figure. Suppress instead.
 *
 * There is deliberately NO coverage guard: a day with no recorded data counts
 * as $0 (a weekend, a sick day), not as grounds to suppress the pace (product
 * decision, 2026-07-02 — same rule as the hero delta).
 */
export function burnPace(dayModel: DayModelAgg[], now: Date = new Date()): BurnPace | null {
	const elapsedDays = now.getUTCDate();
	if (elapsedDays < 3) return null;

	const { from, to } = monthToDateRange(now);
	const daysInMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
	).getUTCDate();
	const mtd = sumGrain(dayModel, { from, to });
	if (mtd.costUnknownRequests > 0) return null; // guard (b)
	const projectedCost = (mtd.cost / elapsedDays) * daysInMonth;

	return { mtdCost: mtd.cost, elapsedDays, daysInMonth, projectedCost };
}

export interface MonthlyBurn {
	/** banked month-to-date API-equivalent burn for the slice */
	burnMTD: number;
	/** burnMTD / fractionOfMonthElapsed — the forward-looking "where it lands" figure */
	burnProjected: number;
	/** the elapsed fraction used for the projection (for transparency / labelling) */
	fractionElapsed: number;
}

/** Month-to-date burn for a slice + its projected full-month figure. */
export function monthlyBurn(burnMTD: number, now: Date = new Date()): MonthlyBurn {
	const fractionElapsed = fractionOfMonthElapsed(now);
	const burnProjected = fractionElapsed > 0 ? burnMTD / fractionElapsed : burnMTD;
	return { burnMTD, burnProjected, fractionElapsed };
}

/** One provider's subsidisation, on both the banked and projected basis. */
export interface ProviderSubsidisation {
	provider: SubsidisedProvider;
	enabled: boolean;
	monthlyUsd: number | null;
	tier: string;
	monthly: MonthlyBurn;
	/** subsidisation on the banked month-to-date burn (the honest headline) */
	mtd: Subsidisation;
	/** subsidisation on the projected full-month burn (forward-looking) */
	projected: Subsidisation;
}

/** Per-provider config slice the roll-up needs (decoupled from the full config type). */
export interface ProviderSubsidisationConfig {
	enabled: boolean;
	tier: string;
	monthlyUsd: number | null;
}

export interface SubsidisationRollup {
	providers: ProviderSubsidisation[];
	/** combined across ENABLED subsidised providers only */
	combined: {
		monthlyUsd: number | null;
		monthly: MonthlyBurn;
		mtd: Subsidisation;
		projected: Subsidisation;
	};
	/**
	 * The window facts, so the UI can say WHICH month and how deep into it we are
	 * ("July so far · 2 days in"). Early-month MTD figures are tiny next to the
	 * page's rolling-30-day charts, and a naked "under-using" verdict from a 1-2
	 * day sample is misleading — the card gates its wording on `elapsedDays`.
	 */
	monthLabel: string;
	elapsedDays: number;
	daysInMonth: number;
}

/**
 * Build the full per-provider + combined subsidisation roll-up from the snapshot
 * grain + the per-provider subscription config.
 *
 * The numerator is the month-to-date API-equivalent burn (`sumGrain` over the
 * current calendar month, filtered to the provider). Only ENABLED subsidised
 * providers contribute to the combined fee and the combined burn; OpenCode/Cursor
 * are excluded entirely (they report real cost, not subsidised). $0-tier safe.
 */
export function buildSubsidisation(
	grain: DayModelAgg[],
	config: Record<SubsidisedProvider, ProviderSubsidisationConfig>,
	now: Date = new Date()
): SubsidisationRollup {
	const { from, to } = monthToDateRange(now);

	const providers: ProviderSubsidisation[] = SUBSIDISED_PROVIDERS.map((provider) => {
		const cfg = config[provider];
		const burnMTD = cfg.enabled
			? sumGrain(grain, { from, to, providers: new Set([provider]) }).cost
			: 0;
		const monthly = monthlyBurn(burnMTD, now);
		return {
			provider,
			enabled: cfg.enabled,
			monthlyUsd: cfg.monthlyUsd,
			tier: cfg.tier,
			monthly,
			mtd: computeSubsidisation({ apiEquivalentUsd: burnMTD, monthlyUsd: cfg.monthlyUsd }),
			projected: computeSubsidisation({
				apiEquivalentUsd: monthly.burnProjected,
				monthlyUsd: cfg.monthlyUsd
			})
		};
	});

	const enabled = providers.filter((p) => p.enabled);
	const combinedFee = sumFees(enabled.map(p => p.monthlyUsd));
	const combinedBurnMTD = enabled.reduce((sum, p) => sum + p.monthly.burnMTD, 0);
	const combinedMonthly = monthlyBurn(combinedBurnMTD, now);

	const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
	const elapsedDays = now.getUTCDate();
	const daysInMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
	).getUTCDate();

	return {
		providers,
		combined: {
			monthlyUsd: combinedFee,
			monthly: combinedMonthly,
			mtd: computeSubsidisation({ apiEquivalentUsd: combinedBurnMTD, monthlyUsd: combinedFee }),
			projected: computeSubsidisation({
				apiEquivalentUsd: combinedMonthly.burnProjected,
				monthlyUsd: combinedFee
			})
		},
		monthLabel,
		elapsedDays,
		daysInMonth
	};
}

// ── Window-based subsidisation (the dashboard card) ─────────────────────────────
//
// The dashboard subsidy card FOLLOWS the period selector (product decision,
// 2026-07-02, superseding the old calendar-month-to-date design): the fee is
// pro-rated to the selected window from a daily rate of monthlyUsd / 30, so
//   day     -> today's usage        vs fee/30
//   week    -> last 7 days' usage   vs fee/30 * 7
//   month   -> last 30 days' usage  vs fee/30 * 30 (= the monthly fee exactly)
//   quarter -> last 90 days' usage  vs fee/30 * 90
//   all     -> full-range usage     vs fee/30 * windowDays
// A pinned day is a 1-day window. Receipts use the same selected-window basis.

/** Daily-rate divisor for pro-rating a monthly fee across a window. */
export const FEE_PRORATA_DAYS = 30;

export interface WindowProviderSubsidisation {
	provider: SubsidisedProvider;
	enabled: boolean;
	tier: string;
	monthlyUsd: number | null;
	/** monthlyUsd / 30 * windowDays — the fee share this window carries */
	windowFeeUsd: number | null;
	sub: Subsidisation;
}

export interface WindowSubsidisationRollup {
	providers: WindowProviderSubsidisation[];
	combined: { monthlyUsd: number | null; windowFeeUsd: number | null; sub: Subsidisation };
	/** inclusive day count of the window */
	windowDays: number;
	from: string;
	to: string;
}

/** Inclusive day count of [from, to] (UTC). */
export function inclusiveDays(from: string, to: string): number {
	if (to < from) return 0;
	const a = new Date(from + 'T00:00:00Z').getTime();
	const b = new Date(to + 'T00:00:00Z').getTime();
	return Math.round((b - a) / 86400000) + 1;
}

/**
 * Per-provider + combined subsidisation over an arbitrary [from, to] window,
 * against the fee pro-rated to that window (daily rate = monthlyUsd / 30).
 */
export function buildWindowSubsidisation(
	grain: DayModelAgg[],
	config: Record<SubsidisedProvider, ProviderSubsidisationConfig>,
	window: { from: string; to: string }
): WindowSubsidisationRollup {
	const { from, to } = window;
	const windowDays = inclusiveDays(from, to);

	const providers: WindowProviderSubsidisation[] = SUBSIDISED_PROVIDERS.map((provider) => {
		const cfg = config[provider];
		const burn = cfg.enabled
			? sumGrain(grain, { from, to, providers: new Set([provider]) }).cost
			: 0;
		const windowFeeUsd = cfg.enabled ? cfg.monthlyUsd === null ? null : (cfg.monthlyUsd / FEE_PRORATA_DAYS) * windowDays : 0;
		return {
			provider,
			enabled: cfg.enabled,
			tier: cfg.tier,
			monthlyUsd: cfg.monthlyUsd,
			windowFeeUsd,
			sub: computeSubsidisation({ apiEquivalentUsd: burn, monthlyUsd: windowFeeUsd })
		};
	});

	const enabled = providers.filter((p) => p.enabled);
	const combinedFee = sumFees(enabled.map(p => p.monthlyUsd));
	const combinedWindowFee = sumFees(enabled.map(p => p.windowFeeUsd));
	const combinedBurn = enabled.reduce((s, p) => s + p.sub.apiEquivalentUsd, 0);

	return {
		providers,
		combined: {
			monthlyUsd: combinedFee,
			windowFeeUsd: combinedWindowFee,
			sub: computeSubsidisation({ apiEquivalentUsd: combinedBurn, monthlyUsd: combinedWindowFee })
		},
		windowDays,
		from,
		to
	};
}

export function sumFees(fees: readonly (number | null)[]): number | null {
	return fees.some(fee => fee === null) ? null : fees.reduce<number>((sum, fee) => sum + (fee ?? 0), 0);
}

export function subsidyMultipleText(subsidy: Pick<Subsidisation, 'monthlyUsd' | 'apiEquivalentUsd' | 'multiple'>): string {
	if (subsidy.monthlyUsd === null) return '—';
	if (subsidy.monthlyUsd === 0) return subsidy.apiEquivalentUsd > 0 ? '∞ — all of it' : '—';
	if (subsidy.multiple === null) return '—';
	return subsidy.multiple >= 100 ? `${Math.round(subsidy.multiple)}×` : `${subsidy.multiple.toFixed(1)}×`;
}
