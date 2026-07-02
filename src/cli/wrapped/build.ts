// buildWrapped — pure transform from a RollupSnapshot + options to a WrappedModel.
//
// Reuses the core aggregation (filterDays / sumGrain / aggregateByModel), the
// per-project attribution (aggregateProjects over the month's sessions), the
// server cache-cost breakdown (cacheCostBreakdown), and the subscription
// subsidisation (buildSubsidisation). NO aggregation is reimplemented here; this
// module only *shapes* the already-aggregated month into the recap model.
//
// Windowing is CALENDAR-month (unlike the receipt's rolling window): the recap is
// a monthly statement. The month-over-month delta is gated on a genuine prior-
// month baseline exactly like the dashboard's `priorHasBaseline` (cost honesty).

import type { CoverageMap, DayCoverage, DayModelAgg, RollupSnapshot } from '../../lib/types.js';
import { aggregateByModel, filterDays, sumGrain, totalTokens } from '../../lib/core/aggregate.js';
import { cacheCostBreakdown } from '../../lib/core/pricing/cache-breakdown.js';
import { aggregateProjects, enumerateDays, inWindow } from '../../lib/core/view-model.js';
import {
	buildSubsidisation,
	type ProviderSubsidisationConfig,
	type SubsidisedProvider
} from '../../lib/core/subsidisation.js';
import { modelFamily, modelLabel } from '../../lib/format.js';
import { WORDMARK } from '../theme/personality.js';
import type {
	WrappedBiggestDay,
	WrappedCache,
	WrappedModel,
	WrappedMomDelta,
	WrappedSubsidy,
	WrappedTopModel,
	WrappedTopProject
} from './model.js';

export interface BuildWrappedOptions {
	/** target recap month, ISO `YYYY-MM`; default = the month containing `now`. */
	month?: string;
	/** suppress decorative copy (footer flourish); barcode/structure stay. */
	noArt?: boolean;
	/** footer copy (already resolved by the caller); empty under noArt. */
	footer?: string;
	/** fixed clock (epoch ms) for deterministic month-to-date + ref/barcode in tests. */
	now?: number;
	/** per-provider subscription config → enables the subsidy block. */
	subscription?: Record<SubsidisedProvider, ProviderSubsidisationConfig>;
	/** real "user@host" for the header (injected so buildWrapped stays pure). */
	account?: string;
}

/** UTC `YYYY-MM` of an epoch-ms timestamp. */
function monthOf(now: number): string {
	return new Date(now).toISOString().slice(0, 7);
}

/** UTC `YYYY-MM-DD` of an epoch-ms timestamp. */
function dayOf(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

/** Last calendar day of a `YYYY-MM` month, as `YYYY-MM-DD` (UTC). */
function lastDayOfMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
	return `${month}-${String(last).padStart(2, '0')}`;
}

/** The `YYYY-MM` immediately before `month`. */
function priorMonthOf(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 → previous month
	return d.toISOString().slice(0, 7);
}

/** Human month label, e.g. "July 2026". */
function monthLabelOf(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
		month: 'long',
		timeZone: 'UTC'
	});
	return `${name} ${y}`;
}

/**
 * Is a fully-past calendar-month window an authoritative baseline? True only when
 * EVERY day in it is authoritative (`frozen` or `zero`) — a `partial` (today's
 * live tail) or `missing` (retention gap / before we started logging) day fails.
 * Mirrors `heroTotals`' private `priorIsAuthoritative` so the wrapped delta gate
 * matches the dashboard's exactly.
 */
function monthIsAuthoritative(days: string[], coverage: CoverageMap): boolean {
	if (days.length === 0) return false;
	for (const day of days) {
		const state: DayCoverage = coverage[day] ?? 'missing';
		if (state !== 'frozen' && state !== 'zero') return false;
	}
	return true;
}

/** Deterministic FNV-1a hash of a seed → 16 hex chars (barcode/ref source). */
function hash64(seed: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (
		(h >>> 0).toString(16).padStart(8, '0') +
		((seed.length * 2654435761) >>> 0).toString(16).padStart(8, '0')
	);
}

/** Deterministic faux-barcode line from a seed (same idiom as the receipt). */
function fauxBarcode(seed: string): string {
	const hex = hash64(seed);
	const bars = ['▏', '▎', '▍', '▌', '▋', '█'];
	let out = '';
	for (const ch of hex) {
		const n = parseInt(ch, 16);
		out += bars[n % bars.length];
		out += ' ▏'[n % 2];
	}
	return out.trim();
}

/** Short deterministic ref code from a seed. */
function refCode(seed: string): string {
	return hash64(seed).slice(0, 6).toUpperCase();
}

/** Fold a scoped grain to per-day cost and return the single most expensive day. */
function biggestDayOf(grain: DayModelAgg[]): WrappedBiggestDay | null {
	const byDay = new Map<string, number>();
	for (const dm of grain) byDay.set(dm.day, (byDay.get(dm.day) ?? 0) + dm.cost);
	let best: WrappedBiggestDay | null = null;
	for (const [day, cost] of byDay) {
		if (best === null || cost > best.cost || (cost === best.cost && day < best.day)) {
			best = { day, cost };
		}
	}
	return best;
}

/**
 * Build the pure WrappedModel from a snapshot. Scopes to the target calendar month
 * (default: the month containing `now`, month-to-date), computes the headline /
 * top model / top project / cache savings / biggest day / MoM delta / subsidy, and
 * assembles the deterministic header + barcode.
 */
export function buildWrapped(snapshot: RollupSnapshot, opts: BuildWrappedOptions = {}): WrappedModel {
	const nowMs = opts.now != null ? opts.now : Date.now();
	const currentMonth = monthOf(nowMs);
	const month = opts.month ?? currentMonth;
	const monthToDate = month === currentMonth;

	// Month window: [1st, last-day] for a past month; [1st, today] for the current
	// (still-accruing) month so the recap is honest month-to-date.
	const from = `${month}-01`;
	const to = monthToDate ? dayOf(nowMs) : lastDayOfMonth(month);

	const wordmark = WORDMARK;
	const monthLabel = monthLabelOf(month);

	const grain = filterDays(snapshot.dayModel, from, to);
	const empty = grain.length === 0;

	// Real covered range from the grain (data bounds, not just the requested window).
	let coveredFrom: string | null = null;
	let coveredTo: string | null = null;
	for (const dm of grain) {
		if (coveredFrom === null || dm.day < coveredFrom) coveredFrom = dm.day;
		if (coveredTo === null || dm.day > coveredTo) coveredTo = dm.day;
	}

	const totals = sumGrain(grain);
	const headline = {
		cost: totals.cost,
		tokens: totalTokens(totals.tokens),
		requests: totals.requests,
		costUnknownRequests: totals.costUnknownRequests
	};

	// Top model by cost (aggregateByModel is already cost-desc sorted).
	const byModel = aggregateByModel(grain);
	const topModel: WrappedTopModel | null =
		byModel.length > 0
			? {
					model: byModel[0].model,
					modelLabel: modelLabel(byModel[0].model),
					family: modelFamily(byModel[0].model),
					cost: byModel[0].cost,
					share: totals.cost > 0 ? byModel[0].cost / totals.cost : 0,
					tokens: totalTokens(byModel[0].tokens),
					requests: byModel[0].requests
				}
			: null;

	// Top project by cost — aggregateProjects over the month's sessions (OVERLAP
	// rule via inWindow, so a boundary-straddling session counts in both months).
	// The unknown bucket is never dropped; it can legitimately be the top row.
	const monthSessions = snapshot.sessions.filter((s) => inWindow(s, from, to));
	const projects = aggregateProjects(monthSessions);
	const topProject: WrappedTopProject | null =
		projects.length > 0
			? {
					display: projects[0].display,
					cost: projects[0].cost,
					sessionCount: projects[0].sessionCount,
					isUnknown: projects[0].isUnknown
				}
			: null;

	// Cache savings for the month (server-side breakdown; every rate from resolvePrice).
	const { combined: cacheBreakdown } = cacheCostBreakdown(grain);
	const cache: WrappedCache = {
		cacheReadTokens: cacheBreakdown.cacheReadTokens,
		cacheReadCost: cacheBreakdown.cacheReadCost,
		cacheWriteTokens: cacheBreakdown.cacheWriteTokens,
		cacheWriteCost: cacheBreakdown.cacheWriteCost,
		savedVsUncached: cacheBreakdown.savedVsUncached
	};

	const biggestDay = biggestDayOf(grain);

	// Month-over-month delta — gated on a GENUINE prior-month baseline (every day
	// authoritative, wholly inside the banked range, non-zero total). Otherwise the
	// whole comparison is omitted rather than fabricated.
	const priorMonth = priorMonthOf(month);
	const priorFrom = `${priorMonth}-01`;
	const priorTo = lastDayOfMonth(priorMonth);
	const priorDays = enumerateDays(priorFrom, priorTo);
	const priorTotals = sumGrain(snapshot.dayModel, { from: priorFrom, to: priorTo });
	let momDelta: WrappedMomDelta | null = null;
	if (
		monthIsAuthoritative(priorDays, snapshot.coverage) &&
		priorTotals.cost > 0 &&
		priorTotals.costUnknownRequests === 0
	) {
		momDelta = {
			priorMonth,
			priorCost: priorTotals.cost,
			deltaUsd: totals.cost - priorTotals.cost,
			deltaPct: (totals.cost - priorTotals.cost) / priorTotals.cost
		};
	}

	// Subscription subsidy for the month. buildSubsidisation is month-to-date
	// anchored at its `now`; anchoring it at the window's `to` makes its month-to-
	// date range exactly [month-01, to] — so a past month gets the FULL month and
	// the current month gets month-to-date, matching the recap window.
	let subsidy: WrappedSubsidy | null = null;
	if (opts.subscription) {
		const anyEnabled = (['claude', 'codex'] as SubsidisedProvider[]).some(
			(p) => opts.subscription?.[p].enabled
		);
		if (anyEnabled) {
			const anchor = new Date(`${to}T12:00:00Z`);
			const rollup = buildSubsidisation(snapshot.dayModel, opts.subscription, anchor);
			subsidy = {
				monthlyUsd: rollup.combined.monthlyUsd,
				apiEquivalentUsd: rollup.combined.mtd.apiEquivalentUsd,
				netSubsidyUsd: rollup.combined.mtd.netSubsidyUsd,
				multiple: rollup.combined.mtd.multiple
			};
		}
	}

	// Deterministic seed: month + total + covered range (NOT time-of-render).
	const seed = [month, totals.cost.toFixed(6), coveredFrom ?? '', coveredTo ?? ''].join('|');

	return {
		wordmark,
		month,
		monthLabel,
		monthToDate,
		from: coveredFrom,
		to: coveredTo,
		account: opts.account ?? null,
		headline,
		topModel,
		topProject,
		cache,
		biggestDay,
		momDelta,
		subsidy,
		footer: opts.noArt ? '' : (opts.footer ?? ''),
		barcode: fauxBarcode(seed),
		ref: `${refCode(seed)} · ${month}`,
		empty
	};
}
