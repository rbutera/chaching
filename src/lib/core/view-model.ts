// Framework-free view-model derivations shared by BOTH the web dashboard
// (`src/lib/client/dashboard.svelte.ts`) and the Ink TUI (`src/cli/tui/`).
//
// These are pure functions over a `RollupSnapshot` + a small `ViewState`
// (period + model filter + provider filter). Extracting them
// here is design D4: "the derivations port directly" — one source of truth so
// the web and TUI can never drift. The Svelte class and the React root are both
// thin shells that hold state and call into here.

import type { DayCoverage, Period, RollupSnapshot, SessionSummary } from '../types';
import {
	aggregateByModel,
	aggregateByProvider,
	aggregateByPeriod,
	dayCoverageState,
	filterDays,
	sumGrain,
	type BucketGrain,
	type ModelTotal,
	type PeriodBucket,
	type ProviderTotal,
	type Totals
} from './aggregate';

/**
 * One calendar day in the banked range, for the calendar heatmap (design D1). `coverage`
 * is the day's typed provenance state from the snapshot coverage map (defaulting to
 * `missing` for a gap day inside the range — the same range-relative rule the rest of the
 * view-model uses). Hand-rolled, framework-free so the future Ink TUI can reuse it.
 */
export interface DayCell {
	day: string;
	cost: number;
	requests: number;
	/** true when the day had any spend rows in scope (distinguishes a real $0 from a gap) */
	hasData: boolean;
	coverage: DayCoverage;
}

/** Add (or subtract) whole days to a YYYY-MM-DD string, in UTC. */
export function addDaysISO(day: string, delta: number): string {
	const d = new Date(day + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

export function zeroTotals(): Totals {
	return {
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
		cost: 0,
		requests: 0,
		costUnknownRequests: 0,
		coverage: { states: {}, worst: 'frozen' }
	};
}

/**
 * Every inclusive calendar day in [from, to] (UTC). This is the single place range-relative
 * `missing` is materialized: the aggregation fold looks up each of these days in the
 * snapshot coverage map and defaults absent days to `missing` (design D5).
 */
export function enumerateDays(from: string, to: string): string[] {
	const out: string[] = [];
	if (to < from) return out;
	for (let day = from; day <= to; day = addDaysISO(day, 1)) out.push(day);
	return out;
}

/** The minimal UI selection both faces own. Sets may be empty (= "all"). */
export interface ViewState {
	period: Period;
	/** empty = all models */
	modelFilter: Set<string>;
	/** empty = all providers */
	providerFilter: Set<string>;
	/**
	 * The pinned single-day focus (`YYYY-MM-DD`), or null for rolling-period mode (default). When
	 * set, `scopedSessions` narrows its window to this one day instead of the rolling period
	 * window — keeping the session list/explorer aligned with the pinned hero/cards (sibling
	 * `chaching-day-nav`). Optional so existing callers/fixtures need no change.
	 */
	focusedDay?: string | null;
}

export function defaultViewState(period: Period = 'week'): ViewState {
	return { period, modelFilter: new Set(), providerFilter: new Set(), focusedDay: null };
}

/** A filter set, normalized to null when empty (the aggregate helpers treat null = all). */
function asFilter(set: Set<string>): Set<string> | null {
	return set.size > 0 ? set : null;
}

/**
 * The day-grain in scope: pinned-day-scoped when a day is focused, else windowed
 * to the selected period (day/week/month/quarter/all). Every summary derivation
 * built on this — per-model totals, per-provider totals, the cache-cost
 * breakdown — follows the period selector through here, matching the
 * `scopedTotals`/`trend` lineage. Full-history reads (heatmap, lifetime totals)
 * use `snap.dayModel`/`snap.totals` directly and are unaffected.
 */
export function scopedGrain(snap: RollupSnapshot, state: ViewState) {
	if (state.focusedDay) return filterDays(snap.dayModel, state.focusedDay, state.focusedDay);
	const w = periodWindow(snap, state);
	return filterDays(snap.dayModel, w.from, w.to);
}

/** Number of inclusive days in a [from, to] window. */
function windowDays(from: string, to: string): number {
	if (to < from) return 0;
	const a = new Date(from + 'T00:00:00Z').getTime();
	const b = new Date(to + 'T00:00:00Z').getTime();
	return Math.round((b - a) / 86400000) + 1;
}

/**
 * Pick the trend bar grain so a long span stays legible. One bar per day is
 * right for day/week/month, but an all-time view of 44+ days would render dozens
 * of unreadable slivers — so we bucket by week past ~45 days and by month past
 * ~370. The bars then number ~6-12 across any realistic banked history.
 */
export function trendGrain(from: string, to: string): BucketGrain {
	const days = windowDays(from, to);
	if (days > 370) return 'month';
	if (days > 45) return 'week';
	return 'day';
}

/**
 * Trend buckets for the chart. For short spans: one DAY bucket for EVERY
 * calendar day in the period window (zero-total buckets fill gaps so a quiet
 * Wednesday reads as a short/absent bar, not a collapsed axis). For long spans
 * (all-time / quarter) the grain steps up to week or month so the chart stays
 * readable instead of rendering 60+ slivers. Either way the buckets carry a
 * per-model breakdown (`byModel`) used for stacking, the hover tooltip, and the
 * click-to-drill target. The model/provider filter is applied throughout.
 */
export function trend(snap: RollupSnapshot, state: ViewState): PeriodBucket[] {
	const w = periodWindow(snap, state);
	const windowed = filterDays(snap.dayModel, w.from, w.to);
	const grain = trendGrain(w.from, w.to);
	const coverageFold = { map: snap.coverage, days: enumerateDays(w.from, w.to) };
	const present = aggregateByPeriod(
		windowed,
		grain,
		asFilter(state.modelFilter),
		asFilter(state.providerFilter),
		coverageFold
	);
	if (grain !== 'day') {
		// Coarse grain: aggregateByPeriod already collapses sparse weeks/months and
		// drops empty ones. A few absent buckets in a long span don't hurt
		// legibility (the point of bucketing), and zero-filling every calendar
		// week/month adds little. Return the present buckets in start-day order.
		return present;
	}
	const byDay = new Map(present.map((b) => [b.key, b]));
	const out: PeriodBucket[] = [];
	for (let day = w.from; day <= w.to; day = addDaysISO(day, 1)) {
		out.push(
			byDay.get(day) ?? {
				key: day,
				startDay: day,
				tokens: zeroTokensLocal(),
				requests: 0,
				cost: 0,
				costUnknownRequests: 0,
				byModel: new Map(),
				// no spend rows for this day -> its coverage is whatever the map says, else
				// `missing`. This is what lets the chart tell a frozen $0 apart from a gap.
				coverage: { states: { [dayCoverageState(day, snap.coverage)]: 1 }, worst: dayCoverageState(day, snap.coverage) }
			}
		);
	}
	return out;
}

function zeroTokensLocal() {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * The inclusive day range a trend bucket covers, derived from its key shape:
 * a bare day (`YYYY-MM-DD`) is a single day; an ISO week (`YYYY-Www`) spans its
 * Monday..Sunday; a month (`YYYY-MM`) spans the 1st..last calendar day. Used so
 * a click on a coarse (week/month) bar drills the whole bucket, not just its
 * first day. `startDay` (the earliest day with data in the bucket) is the
 * fallback range start when present.
 *
 * `clamp` (the active period window) bounds the range to the days the bar
 * actually aggregated: an edge week/month bucket can spill before `clamp.from`
 * or after `clamp.to` (the window cuts mid-bucket), and the drilled detail must
 * sum to exactly the bar, not the whole calendar week/month. Without the clamp
 * the first/last coarse bar would drill days that were never in it.
 */
export function bucketDayRange(
	bucket: PeriodBucket,
	clamp?: { from: string; to: string }
): { from: string; to: string } {
	const { key, startDay } = bucket;
	let from: string;
	let to: string;
	// ISO week key: YYYY-Www -> Monday..Sunday of that ISO week.
	const week = /^(\d{4})-W(\d{2})$/.exec(key);
	const month = /^(\d{4})-(\d{2})$/.exec(key);
	if (week) {
		const isoYear = Number(week[1]);
		const isoWeek = Number(week[2]);
		// Monday of ISO week 1 contains Jan 4th; find it, then add (week-1) weeks.
		const jan4 = new Date(Date.UTC(isoYear, 0, 4));
		const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0
		const week1Mon = new Date(jan4);
		week1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
		const mon = new Date(week1Mon);
		mon.setUTCDate(week1Mon.getUTCDate() + (isoWeek - 1) * 7);
		from = mon.toISOString().slice(0, 10);
		to = addDaysISO(from, 6);
	} else if (month) {
		// Month key: YYYY-MM -> 1st..last day of the month.
		const y = Number(month[1]);
		const m = Number(month[2]);
		from = `${month[1]}-${month[2]}-01`;
		const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
		to = `${month[1]}-${month[2]}-${String(lastDay).padStart(2, '0')}`;
	} else {
		// Plain day key (or anything else): single day.
		from = startDay;
		to = startDay;
	}
	if (clamp) {
		if (from < clamp.from) from = clamp.from;
		if (to > clamp.to) to = clamp.to;
	}
	return { from, to };
}

/** Per-model totals in scope (drives donut + legend + filter). Provider filter applied. */
export function models(snap: RollupSnapshot, state: ViewState): ModelTotal[] {
	const providers = asFilter(state.providerFilter);
	const grain = providers
		? scopedGrain(snap, state).filter((dm) => providers.has(dm.provider))
		: scopedGrain(snap, state);
	return aggregateByModel(grain);
}

/** Per-provider totals over the scoped grain (the provider filter row uses the full set). */
export function providers(snap: RollupSnapshot, state: ViewState): ProviderTotal[] {
	return aggregateByProvider(scopedGrain(snap, state));
}

export interface PeriodWindow {
	from: string;
	to: string;
	priorFrom: string;
	priorTo: string;
	label: string;
}

/** Rolling-window span in days for a fixed-length period, or null for "all". */
function periodSpan(period: Period): number | null {
	switch (period) {
		case 'day':
			return 1;
		case 'week':
			return 7;
		case 'month':
			return 30;
		case 'quarter':
			return 90;
		case 'all':
			return null;
	}
}

/**
 * Rolling window for the selected period, anchored at the latest day with data.
 * day = latest day, week = last 7 days, month = last 30 days, quarter = last 90
 * days, all = earliest..latest (the full banked history). Prior = the
 * immediately-preceding equal-length window (for the delta). Rolling windows
 * (vs calendar buckets) avoid the "5 days into the month" overlap where the
 * latest week and latest month coincide, and always give distinct, meaningful
 * figures.
 *
 * For the "all" period there is no meaningful equal-length prior window (it would
 * predate the data entirely), so the prior collapses onto the day before earliest
 * — heroTotals then correctly reports `priorHasBaseline=false` and the UI
 * suppresses the delta.
 */
export function periodWindow(snap: RollupSnapshot, state: ViewState): PeriodWindow {
	const to = snap.latestDay ?? snap.earliestDay ?? '1970-01-01';
	const span = periodSpan(state.period);
	if (span === null) {
		// All-time: span the full data range; prior window is the (data-less) day
		// before earliest, which heroTotals reads as "no baseline".
		const from = snap.earliestDay ?? to;
		const priorTo = addDaysISO(from, -1);
		return { from, to, priorFrom: priorTo, priorTo, label: 'All time' };
	}
	const from = addDaysISO(to, -(span - 1));
	const priorTo = addDaysISO(from, -1);
	const priorFrom = addDaysISO(priorTo, -(span - 1));
	const label =
		state.period === 'day'
			? 'Today'
			: state.period === 'week'
				? 'Last 7 days'
				: state.period === 'month'
					? 'Last 30 days'
					: 'Last 90 days';
	return { from, to, priorFrom, priorTo, label };
}

/**
 * Current-period and prior-period totals for the hero + delta.
 *
 * `priorHasBaseline` gates whether the period-over-period delta may render. The
 * comparison is only honest when a GENUINE equal-length prior window of real
 * data exists. Concretely we require ALL of:
 *
 *   1. The data range is known (earliestDay/latestDay are set).
 *   2. The ENTIRE prior window lies within the days we actually have data for —
 *      `priorFrom >= earliestDay` AND `priorTo <= latestDay`. A prior window
 *      that runs off either end of the data (partly/wholly before we started
 *      logging, or — for a rolling window — past the latest day) is not a full
 *      baseline; comparing against it manufactures garbage like "+563% vs prior
 *      $1539".
 *   3. The prior total is NON-ZERO. A $0 prior makes the percentage meaningless
 *      (every positive current reads as "new"/∞%) and risks divide-by-zero, so
 *      we suppress rather than show a misleading figure.
 *
 * When any condition fails, `priorHasBaseline` is false and the hero shows an
 * honest "no prior baseline" state ("—") instead of a percentage. The all-time
 * window always fails (its prior window predates earliest), which is correct:
 * there is nothing to compare a full-history total against.
 */
export function heroTotals(
	snap: RollupSnapshot,
	state: ViewState
): { current: Totals; prior: Totals; label: string; priorHasBaseline: boolean } {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	const w = periodWindow(snap, state);
	const current = sumGrain(snap.dayModel, {
		from: w.from,
		to: w.to,
		models: modelFilter,
		providers: providerFilter,
		coverage: { map: snap.coverage, days: enumerateDays(w.from, w.to) }
	});
	const prior = sumGrain(snap.dayModel, {
		from: w.priorFrom,
		to: w.priorTo,
		models: modelFilter,
		providers: providerFilter,
		coverage: { map: snap.coverage, days: enumerateDays(w.priorFrom, w.priorTo) }
	});
	// Honest baseline, now reading the ONE typed coverage source (design D5): the prior
	// window is a valid comparison only when EVERY day in it is authoritative (`frozen` or
	// `zero`) AND the prior cost is non-zero. A `partial`/`missing` prior day suppresses the
	// delta. This is strictly more honest than the old `earliestDay`/`latestDay` bounds
	// check and stays identical for the existing all-frozen-past fixtures.
	const priorHasBaseline = priorIsAuthoritative(prior.coverage.states) && prior.cost > 0;
	return { current, prior, label: w.label, priorHasBaseline };
}

/** True when a window's coverage states are entirely authoritative (only frozen / zero). */
function priorIsAuthoritative(states: Partial<Record<DayCoverage, number>>): boolean {
	const total = (states.frozen ?? 0) + (states.zero ?? 0) + (states.partial ?? 0) + (states.missing ?? 0);
	if (total === 0) return false; // an empty / data-less prior window is no baseline
	return (states.partial ?? 0) === 0 && (states.missing ?? 0) === 0;
}

/**
 * Grand totals in scope for the summary cards. Scoped to the selected period
 * window (so the cards move with Day/Week/Month), with the model + provider
 * filters applied.
 */
export function scopedTotals(snap: RollupSnapshot, state: ViewState): Totals {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	const w = periodWindow(snap, state);
	return sumGrain(snap.dayModel, {
		from: w.from,
		to: w.to,
		models: modelFilter,
		providers: providerFilter,
		coverage: { map: snap.coverage, days: enumerateDays(w.from, w.to) }
	});
}

/** UTC `YYYY-MM-DD` day of an epoch-ms timestamp (matches the engine's `isoDayUTC`). */
export function dayOf(ts: number): string {
	return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Does a session's activity overlap the inclusive day window `[from, to]`? Overlap, not
 * containment (design D3): in-window iff the session's first-activity day is on/before `to`
 * AND its last-activity day is on/after `from`. We compare by UTC day strings (not raw ms) so
 * the rule lines up with how days are frozen/aggregated — a session is "on" every UTC day it
 * touched. A session that started 23:50 yesterday and ran past midnight into the window counts
 * (its `lastTs` day >= `from`); one wholly before `from` or wholly after `to` does not. The
 * honest consequence is that a midnight-straddling session legitimately appears in BOTH adjacent
 * windows whose ranges its activity overlaps.
 */
export function inWindow(session: SessionSummary, from: string, to: string): boolean {
	return dayOf(session.firstTs) <= to && dayOf(session.lastTs) >= from;
}

/**
 * Sessions in scope. Date-windows the session index by the active period window
 * (`periodWindow`) via the overlap rule (`inWindow`, design D3) — the missing piece that made
 * "Recent sessions" identical across Day/Week/Month — then applies the model + provider filters
 * (all three AND-compose). A pinned `focusedDay` (sibling `chaching-day-nav`) narrows the window
 * to that single day so the explorer/list scopes to the pin, matching the rest of the dashboard.
 */
export function scopedSessions(snap: RollupSnapshot, state: ViewState): SessionSummary[] {
	const w = periodWindow(snap, state);
	const from = state.focusedDay ?? w.from;
	const to = state.focusedDay ?? w.to;
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	return snap.sessions.filter((s) => {
		if (!inWindow(s, from, to)) return false;
		if (modelFilter && !s.models.some((m) => modelFilter.has(m))) return false;
		if (providerFilter && !providerFilter.has(s.provider)) return false;
		return true;
	});
}

/**
 * All banked sessions (frozen ∪ live), with only the model + provider filters applied — no date
 * window. The session explorer's default "which sessions" selector (design D2): its whole point
 * is cross-day, so it does NOT period-scope. Pure + framework-free so the explorer stays a thin
 * shell and the TUI can reuse it.
 */
export function allSessions(snap: RollupSnapshot, state: ViewState): SessionSummary[] {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	if (!modelFilter && !providerFilter) return snap.sessions;
	return snap.sessions.filter((s) => {
		if (modelFilter && !s.models.some((m) => modelFilter.has(m))) return false;
		if (providerFilter && !providerFilter.has(s.provider)) return false;
		return true;
	});
}

/** UTC `YYYY-MM-DD` for "now" (the live-tail day). Injectable for deterministic tests. */
export function todayUTC(now: number = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

/**
 * Is a session live (still accumulating today) vs frozen (sealed in history)? Live iff its last
 * activity day is today (design D4) — derived, never stored, so no new field on `SessionSummary`.
 */
export function isLive(session: SessionSummary, now: number = Date.now()): boolean {
	return dayOf(session.lastTs) === todayUTC(now);
}

// ---------------------------------------------------------------------------
// Day-grain heatmap + focused-day (zoomed-in) derivations — design D1, D6.
// Additive: these never touch the rolling-window math above; they re-aggregate
// the same flat grain to one cell per calendar day and scope the panels to a
// single pinned day. Shared + framework-free so the future TUI can reuse them.
// ---------------------------------------------------------------------------

/**
 * One `DayCell` per calendar day in `[earliestDay, latestDay]` inclusive (design D1).
 *
 * Single pass: aggregate the flat grain to day grain once via `aggregateByPeriod(_, 'day')`,
 * index by day, then walk every calendar day from earliest to latest filling gaps with a
 * zero cell. The model/provider filters are ignored here on purpose — the heatmap is a
 * full-history navigation surface (cost-shaded over ALL spend), not a filtered view. Each
 * cell's `coverage` is read from the snapshot map, defaulting to `missing` for a gap day
 * (the same range-relative rule as the trend). Empty when there's no data.
 */
export function byDay(snap: RollupSnapshot): DayCell[] {
	const from = snap.earliestDay;
	const to = snap.latestDay;
	if (from == null || to == null) return [];
	const present = new Map(aggregateByPeriod(snap.dayModel, 'day').map((b) => [b.key, b]));
	const out: DayCell[] = [];
	for (let day = from; day <= to; day = addDaysISO(day, 1)) {
		const b = present.get(day);
		out.push({
			day,
			cost: b?.cost ?? 0,
			requests: b?.requests ?? 0,
			hasData: b != null,
			coverage: dayCoverageState(day, snap.coverage)
		});
	}
	return out;
}

/**
 * Totals for a single pinned day, scoped to the active model/provider filters (design D6).
 * Equivalent to `sumGrain` over the one-day window `[day, day]` — the same helper the hero
 * and cards use — so the focused numbers are identically derived, just over a tighter window.
 */
export function focusedTotals(snap: RollupSnapshot, day: string, state: ViewState): Totals {
	return sumGrain(snap.dayModel, {
		from: day,
		to: day,
		models: asFilter(state.modelFilter),
		providers: asFilter(state.providerFilter),
		coverage: { map: snap.coverage, days: [day] }
	});
}

/** Per-model totals for a single pinned day (drives the donut), provider filter applied. */
export function focusedModels(snap: RollupSnapshot, day: string, state: ViewState): ModelTotal[] {
	const providers = asFilter(state.providerFilter);
	let grain = filterDays(snap.dayModel, day, day);
	if (providers) grain = grain.filter((dm) => providers.has(dm.provider));
	return aggregateByModel(grain);
}

/**
 * Sessions whose activity intersects the pinned day (design D6). A session intersects day
 * `D` when its [firstTs, lastTs] span overlaps D's UTC calendar window. The model/provider
 * filters compose exactly as in `scopedSessions`.
 */
export function focusedSessions(snap: RollupSnapshot, day: string, state: ViewState): SessionSummary[] {
	const dayStart = new Date(day + 'T00:00:00Z').getTime();
	const dayEnd = dayStart + 86400000; // exclusive
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	return snap.sessions.filter((s) => {
		if (s.firstTs >= dayEnd || s.lastTs < dayStart) return false;
		if (modelFilter && !s.models.some((m) => modelFilter.has(m))) return false;
		if (providerFilter && !providerFilter.has(s.provider)) return false;
		return true;
	});
}

/** Clamp a day into `[earliestDay, latestDay]`; returns null when there's no data range. */
export function clampDay(snap: RollupSnapshot, day: string): string | null {
	const lo = snap.earliestDay;
	const hi = snap.latestDay;
	if (lo == null || hi == null) return null;
	if (day < lo) return lo;
	if (day > hi) return hi;
	return day;
}
