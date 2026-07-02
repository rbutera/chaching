// Subscription subsidisation — the "how much API value did my flat fee buy me
// this month" reframe. PURE: it consumes already-computed per-provider burn and a
// monthly fee; it never touches cost.ts or re-sums tokens (design D6).
//
// The basis is MONTHLY and calendar-aligned: the headline compares the current
// calendar month-to-date API-equivalent burn against the FULL monthly fee, and a
// labelled "projected" figure scales month-to-date up by the elapsed fraction of
// the month (design D5). $0 (Free) tiers are handled without divide-by-zero.

import type { CoverageMap, DayModelAgg } from '../types';
import { dayCoverageState, sumGrain } from './aggregate';

/** Providers whose API-equivalent cost chaching computes → subsidisation applies. */
export const SUBSIDISED_PROVIDERS = ['claude', 'codex'] as const;
export type SubsidisedProvider = (typeof SUBSIDISED_PROVIDERS)[number];

export interface SubsidisationInput {
	/** the API-equivalent burn for the slice (per-provider month-to-date, or combined) */
	apiEquivalentUsd: number;
	/** the flat monthly fee for the slice */
	monthlyUsd: number;
}

export interface Subsidisation {
	apiEquivalentUsd: number;
	monthlyUsd: number;
	/** apiEquivalentUsd − monthlyUsd; negative when the fee exceeds the value used */
	netSubsidyUsd: number;
	/**
	 * apiEquivalentUsd / monthlyUsd, or `null` when monthlyUsd is 0 (Free tier).
	 * A null multiple is rendered as "∞ — all of it", never Infinity/NaN.
	 */
	multiple: number | null;
}

/**
 * The core subsidisation computation. $0-tier safe: when `monthlyUsd <= 0` the
 * multiple is `null` (the caller renders "∞ — all of it"); when `monthlyUsd > 0`
 * but burn is 0 the multiple is `0` ("nothing used yet this month").
 */
export function computeSubsidisation({
	apiEquivalentUsd,
	monthlyUsd
}: SubsidisationInput): Subsidisation {
	const fee = Number.isFinite(monthlyUsd) && monthlyUsd > 0 ? monthlyUsd : 0;
	const burn = Number.isFinite(apiEquivalentUsd) && apiEquivalentUsd > 0 ? apiEquivalentUsd : 0;
	return {
		apiEquivalentUsd: burn,
		monthlyUsd: fee,
		netSubsidyUsd: burn - fee,
		multiple: fee > 0 ? burn / fee : null
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

/** One day past `day` (YYYY-MM-DD, UTC). Local to avoid coupling this module to view-model.ts. */
function nextDayISO(day: string): string {
	const d = new Date(day + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
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
 * GUARD (a) coverage: if any elapsed-MTD day is `missing` (a gap chaching has
 * no opinion about — pruned logs, or chaching wasn't running), an unknown
 * chunk of real spend could be absent from `mtdCost`, and projecting off an
 * understated MTD would understate the whole-month pace. `partial` (today's
 * live tail) is fine — it's meant to be counted as-is, not a gap.
 *
 * GUARD (b) sample size: `elapsedDays < 3` extrapolates a whole month from a
 * 1-2 day sample, which fabricates precision the data doesn't support.
 *
 * GUARD (c) unknown-priced spend: an MTD request whose model has no known
 * price contributes $0 to `mtdCost`, so the projection would silently
 * understate the pace while rendering as a precise figure. Suppress instead.
 */
export function burnPace(
	dayModel: DayModelAgg[],
	coverage: CoverageMap,
	now: Date = new Date()
): BurnPace | null {
	const elapsedDays = now.getUTCDate();
	if (elapsedDays < 3) return null;

	const { from, to } = monthToDateRange(now);
	for (let day = from; day <= to; day = nextDayISO(day)) {
		if (dayCoverageState(day, coverage) === 'missing') return null;
	}

	const daysInMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
	).getUTCDate();
	const mtd = sumGrain(dayModel, { from, to });
	if (mtd.costUnknownRequests > 0) return null; // guard (c)
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
	monthlyUsd: number;
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
	monthlyUsd: number;
}

export interface SubsidisationRollup {
	providers: ProviderSubsidisation[];
	/** combined across ENABLED subsidised providers only */
	combined: {
		monthlyUsd: number;
		monthly: MonthlyBurn;
		mtd: Subsidisation;
		projected: Subsidisation;
	};
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
	const combinedFee = enabled.reduce((sum, p) => sum + p.monthlyUsd, 0);
	const combinedBurnMTD = enabled.reduce((sum, p) => sum + p.monthly.burnMTD, 0);
	const combinedMonthly = monthlyBurn(combinedBurnMTD, now);

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
		}
	};
}
