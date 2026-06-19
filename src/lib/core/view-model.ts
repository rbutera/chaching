// Framework-free view-model derivations shared by BOTH the web dashboard
// (`src/lib/client/dashboard.svelte.ts`) and the Ink TUI (`src/cli/tui/`).
//
// These are pure functions over a `RollupSnapshot` + a small `ViewState`
// (period + model filter + provider filter + optional zoom). Extracting them
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
	/** active zoom window over the trend (inclusive day range), null = full range */
	zoom: { from: string; to: string } | null;
}

export function defaultViewState(period: Period = 'week'): ViewState {
	return { period, modelFilter: new Set(), providerFilter: new Set(), zoom: null };
}

/** A filter set, normalized to null when empty (the aggregate helpers treat null = all). */
function asFilter(set: Set<string>): Set<string> | null {
	return set.size > 0 ? set : null;
}

/** The day-grain currently in scope (zoom window applied). */
export function scopedGrain(snap: RollupSnapshot, state: ViewState) {
	const z = state.zoom;
	return z ? filterDays(snap.dayModel, z.from, z.to) : snap.dayModel;
}

/** Trend buckets for the chart at the current period + zoom + model/provider filter. */
export function trend(snap: RollupSnapshot, state: ViewState): PeriodBucket[] {
	// when zoomed, drop to a finer grain automatically (month/week -> day).
	const effectivePeriod: Period = state.zoom ? 'day' : state.period;
	return aggregateByPeriod(
		scopedGrain(snap, state),
		effectivePeriod,
		asFilter(state.modelFilter),
		asFilter(state.providerFilter)
	);
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

/** Current-period and prior-period totals for the hero + delta. */
export function heroTotals(
	snap: RollupSnapshot,
	state: ViewState
): { current: Totals; prior: Totals; label: string } {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	// zoom overrides the period window for the headline figures.
	if (state.zoom) {
		const cur = sumGrain(snap.dayModel, {
			from: state.zoom.from,
			to: state.zoom.to,
			models: modelFilter,
			providers: providerFilter
		});
		return { current: cur, prior: zeroTotals(), label: 'Zoom range' };
	}
	const w = periodWindow(snap, state);
	return {
		current: sumGrain(snap.dayModel, { from: w.from, to: w.to, models: modelFilter, providers: providerFilter }),
		prior: sumGrain(snap.dayModel, {
			from: w.priorFrom,
			to: w.priorTo,
			models: modelFilter,
			providers: providerFilter
		}),
		label: w.label
	};
}

/**
 * Grand totals in scope for the summary cards. Scoped to the selected period
 * window (so the cards move with Day/Week/Month), with the model + provider
 * filters applied. A zoom selection overrides the period window.
 */
export function scopedTotals(snap: RollupSnapshot, state: ViewState): Totals {
	const modelFilter = asFilter(state.modelFilter);
	const providerFilter = asFilter(state.providerFilter);
	if (state.zoom) {
		return sumGrain(snap.dayModel, {
			from: state.zoom.from,
			to: state.zoom.to,
			models: modelFilter,
			providers: providerFilter
		});
	}
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
