// Framework-free view-model derivations shared by BOTH the web dashboard
// (`src/lib/client/dashboard.svelte.ts`) and the Ink TUI (`src/cli/tui/`).
//
// These are pure functions over a `RollupSnapshot` + a small `ViewState`
// (period + model filter + provider filter). Extracting them
// here is design D4: "the derivations port directly" — one source of truth so
// the web and TUI can never drift. The Svelte class and the React root are both
// thin shells that hold state and call into here.

import type { Period, RollupSnapshot, SessionSummary } from '../types';
import {
	aggregateByModel,
	aggregateByProvider,
	aggregateByPeriod,
	filterDays,
	sumGrain,
	type ModelTotal,
	type PeriodBucket,
	type ProviderTotal,
	type Totals
} from './aggregate';

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
		costUnknownRequests: 0
	};
}

/** The minimal UI selection both faces own. Sets may be empty (= "all"). */
export interface ViewState {
	period: Period;
	/** empty = all models */
	modelFilter: Set<string>;
	/** empty = all providers */
	providerFilter: Set<string>;
}

export function defaultViewState(period: Period = 'week'): ViewState {
	return { period, modelFilter: new Set(), providerFilter: new Set() };
}

/** A filter set, normalized to null when empty (the aggregate helpers treat null = all). */
function asFilter(set: Set<string>): Set<string> | null {
	return set.size > 0 ? set : null;
}

/** The full day-grain in scope (no windowing here; trend/hero apply windows). */
export function scopedGrain(snap: RollupSnapshot, _state: ViewState) {
	return snap.dayModel;
}

/**
 * Trend buckets for the chart: one DAY bucket per day in the current period
 * window, with the model/provider filter applied. Always day-grain so the
 * stacked bar chart renders one bar per day. The bars carry a per-model
 * breakdown (`byModel`) used for stacking, the hover tooltip, and the
 * click-to-drill day target.
 */
export function trend(snap: RollupSnapshot, state: ViewState): PeriodBucket[] {
	const w = periodWindow(snap, state);
	const windowed = filterDays(snap.dayModel, w.from, w.to);
	return aggregateByPeriod(windowed, 'day', asFilter(state.modelFilter), asFilter(state.providerFilter));
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

/**
 * Rolling window for the selected period, anchored at the latest day with data.
 * day = latest day, week = last 7 days, month = last 30 days. Prior = the
 * immediately-preceding equal-length window (for the delta). Rolling windows
 * (vs calendar buckets) avoid the "5 days into the month" overlap where the
 * latest week and latest month coincide, and always give Day/Week/Month
 * distinct, meaningful figures.
 */
export function periodWindow(snap: RollupSnapshot, state: ViewState): PeriodWindow {
	const to = snap.latestDay ?? snap.earliestDay ?? '1970-01-01';
	const span = state.period === 'day' ? 1 : state.period === 'week' ? 7 : 30;
	const from = addDaysISO(to, -(span - 1));
	const priorTo = addDaysISO(from, -1);
	const priorFrom = addDaysISO(priorTo, -(span - 1));
	const label = state.period === 'day' ? 'Today' : state.period === 'week' ? 'Last 7 days' : 'Last 30 days';
	return { from, to, priorFrom, priorTo, label };
}

/**
 * Current-period and prior-period totals for the hero + delta.
 *
 * `priorHasBaseline` is false when the prior window predates our earliest data,
 * i.e. there is genuinely nothing to compare against (as opposed to a real $0
 * prior). The hero uses this to SUPPRESS the period-over-period % rather than
 * show a misleading "new"/percentage when no baseline exists.
 */
export function heroTotals(
	snap: RollupSnapshot,
	state: ViewState
): { current: Totals; prior: Totals; label: string; priorHasBaseline: boolean } {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	const w = periodWindow(snap, state);
	// No baseline when the entire prior window falls before the earliest day we
	// have data for (priorTo < earliestDay). A prior window that overlaps our
	// data but happens to sum to $0 is a real baseline and keeps the delta.
	const earliest = snap.earliestDay;
	const priorHasBaseline = earliest != null && w.priorTo >= earliest;
	return {
		current: sumGrain(snap.dayModel, { from: w.from, to: w.to, models: modelFilter, providers: providerFilter }),
		prior: sumGrain(snap.dayModel, {
			from: w.priorFrom,
			to: w.priorTo,
			models: modelFilter,
			providers: providerFilter
		}),
		label: w.label,
		priorHasBaseline
	};
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
	return sumGrain(snap.dayModel, { from: w.from, to: w.to, models: modelFilter, providers: providerFilter });
}

/** Sessions in scope (model filter applied via model mix, provider filter applied directly). */
export function scopedSessions(snap: RollupSnapshot, state: ViewState): SessionSummary[] {
	const modelFilter = asFilter(state.modelFilter);
	let sessions = snap.sessions;
	if (modelFilter) sessions = sessions.filter((s) => s.models.some((m) => modelFilter.has(m)));
	const providerFilter = asFilter(state.providerFilter);
	if (providerFilter) sessions = sessions.filter((s) => providerFilter.has(s.provider));
	return sessions;
}
