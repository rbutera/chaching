// Dashboard view-model (Svelte 5 runes). Owns period, model filter, provider
// filter, and drill selection, and exposes $derived aggregates over the feed snapshot.
// Persists period + filter to localStorage so reopening the tab lands in place.
//
// The derivations themselves are pure functions in `$lib/core/view-model`, shared
// with the Ink TUI so the two faces can never drift (design D4). This class is a
// thin Svelte shell that holds reactive state + persistence and delegates the math.

import type { Period, RollupSnapshot, SessionSummary } from '$lib/types';
import type { ModelTotal, PeriodBucket, ProviderTotal, Totals } from '$lib/core/aggregate';
import * as vm from '$lib/core/view-model';
import type { DayCell } from '$lib/core/view-model';

const LS_KEY = 'chaching.ui.v1';

export interface DrillTarget {
	kind: 'period' | 'session';
	label: string;
	// period / day drill
	from?: string;
	to?: string;
	periodKey?: string;
	// session drill
	session?: SessionSummary;
}

interface PersistedUI {
	period: Period;
	models: string[];
	providers: string[];
	/** the pinned single-day focus (YYYY-MM-DD), or absent/null for rolling-period mode */
	focusedDay?: string | null;
}

export class Dashboard {
	period = $state<Period>('week');
	/** empty = all models; otherwise scope the whole dashboard to these models */
	modelFilter = $state<Set<string>>(new Set());
	providerFilter = $state<Set<string>>(new Set());
	drill = $state<DrillTarget | null>(null);
	/**
	 * The zoomed-in single-day pin (design D5). `null` = rolling-period mode (default).
	 * A `YYYY-MM-DD` pins the hero/cards/donut/session-list to that one day. Clamped to
	 * `[earliestDay, latestDay]`; persisted; cleared on a period switch.
	 */
	focusedDay = $state<string | null>(null);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (raw) {
					const p = JSON.parse(raw) as PersistedUI;
					if (p.period) this.period = p.period;
					if (Array.isArray(p.models)) this.modelFilter = new Set(p.models);
					if (Array.isArray(p.providers)) this.providerFilter = new Set(p.providers);
					// Hydrate the pinned day; clamping against a (possibly shrunk) data range
					// happens once the snapshot lands, via reconcileFocusedDay().
					if (typeof p.focusedDay === 'string') this.focusedDay = p.focusedDay;
				}
			} catch {
				/* ignore */
			}
		}
	}

	private persist(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			const data: PersistedUI = {
				period: this.period,
				models: [...this.modelFilter],
				providers: [...this.providerFilter],
				focusedDay: this.focusedDay
			};
			localStorage.setItem(LS_KEY, JSON.stringify(data));
		} catch {
			/* ignore */
		}
	}

	/** Snapshot the current selection into the shared, framework-free view-state. */
	private state(): vm.ViewState {
		return { period: this.period, modelFilter: this.modelFilter, providerFilter: this.providerFilter };
	}

	setPeriod(p: Period): void {
		this.period = p;
		// Switching the zoomed-out period exits the zoomed-in pin: one obvious transition
		// (design D6 / cross-element), so the period switcher and a pinned day never silently
		// disagree about what the panels are showing.
		this.focusedDay = null;
		this.persist();
	}

	/** Pin the dashboard to a single day, clamped to `[earliestDay, latestDay]` (design D5/D8). */
	setFocusedDay(snap: RollupSnapshot, day: string): void {
		this.focusedDay = vm.clampDay(snap, day);
		this.persist();
	}

	/** Step the pinned day by ±n calendar days, clamped (no wrap, no-op at the bounds). */
	stepFocusedDay(snap: RollupSnapshot, delta: number): void {
		if (this.focusedDay == null) return;
		this.focusedDay = vm.clampDay(snap, vm.addDaysISO(this.focusedDay, delta));
		this.persist();
	}

	/** Exit pinned mode, back to the rolling-period view. */
	clearFocusedDay(): void {
		this.focusedDay = null;
		this.persist();
	}

	/**
	 * Once a snapshot is available, clamp/clear a persisted focusedDay that fell outside a
	 * (possibly shrunk) data range — an out-of-range value snaps to the nearest bound, and a
	 * pin with no data at all clears (design D8). Idempotent; safe to call on every snapshot.
	 */
	reconcileFocusedDay(snap: RollupSnapshot): void {
		if (this.focusedDay == null) return;
		const clamped = vm.clampDay(snap, this.focusedDay);
		if (clamped !== this.focusedDay) {
			this.focusedDay = clamped;
			this.persist();
		}
	}

	toggleModel(model: string): void {
		const next = new Set(this.modelFilter);
		if (next.has(model)) next.delete(model);
		else next.add(model);
		this.modelFilter = next;
		this.persist();
	}

	clearModelFilter(): void {
		this.modelFilter = new Set();
		this.persist();
	}

	toggleProvider(provider: string): void {
		const next = new Set(this.providerFilter);
		if (next.has(provider)) next.delete(provider);
		else next.add(provider);
		this.providerFilter = next;
		this.persist();
	}

	clearProviderFilter(): void {
		this.providerFilter = new Set();
		this.persist();
	}

	openPeriodDrill(t: { from: string; to: string; periodKey: string; label: string }): void {
		this.drill = { kind: 'period', ...t };
	}

	openSessionDrill(session: SessionSummary): void {
		this.drill = { kind: 'session', session, label: session.sessionId.slice(0, 8) };
	}

	closeDrill(): void {
		this.drill = null;
	}

	/** The full day-grain in scope. */
	scopedGrain(snap: RollupSnapshot) {
		return vm.scopedGrain(snap, this.state());
	}

	/** Trend buckets for the stacked bar chart (day grain short-span, week/month for long spans). */
	trend(snap: RollupSnapshot): PeriodBucket[] {
		return vm.trend(snap, this.state());
	}

	/**
	 * The inclusive day range a trend bucket covers (single day, or a week/month
	 * span), clamped to the active period window so a click on an edge coarse bar
	 * drills exactly the days that bar aggregated.
	 */
	bucketDayRange(snap: RollupSnapshot, bucket: PeriodBucket): { from: string; to: string } {
		const w = vm.periodWindow(snap, this.state());
		return vm.bucketDayRange(bucket, { from: w.from, to: w.to });
	}

	/** Per-model totals in scope (drives donut + legend + filter). */
	models(snap: RollupSnapshot): ModelTotal[] {
		return vm.models(snap, this.state());
	}

	providers(snap: RollupSnapshot): ProviderTotal[] {
		return vm.providers(snap, this.state());
	}

	periodWindow(snap: RollupSnapshot): vm.PeriodWindow {
		return vm.periodWindow(snap, this.state());
	}

	/** Current-period and prior-period totals for the hero + delta. */
	heroTotals(snap: RollupSnapshot): { current: Totals; prior: Totals; label: string; priorHasBaseline: boolean } {
		return vm.heroTotals(snap, this.state());
	}

	/**
	 * Grand totals in scope for the summary cards. Scoped to the selected period
	 * window (so the cards move with Day/Week/Month), with the model filter applied.
	 */
	scopedTotals(snap: RollupSnapshot): Totals {
		return vm.scopedTotals(snap, this.state());
	}

	/** Sessions in scope (model filter applied via model mix, provider filter applied). */
	scopedSessions(snap: RollupSnapshot): SessionSummary[] {
		return vm.scopedSessions(snap, this.state());
	}

	/** One cell per calendar day in the banked range (the calendar heatmap series). */
	byDay(snap: RollupSnapshot): DayCell[] {
		return vm.byDay(snap);
	}

	/** Totals for the pinned day (hero + summary cards), filters applied. */
	focusedTotals(snap: RollupSnapshot, day: string): Totals {
		return vm.focusedTotals(snap, day, this.state());
	}

	/** Per-model totals for the pinned day (donut + legend), provider filter applied. */
	focusedModels(snap: RollupSnapshot, day: string): ModelTotal[] {
		return vm.focusedModels(snap, day, this.state());
	}

	/** Sessions intersecting the pinned day, filters applied. */
	focusedSessions(snap: RollupSnapshot, day: string): SessionSummary[] {
		return vm.focusedSessions(snap, day, this.state());
	}
}
