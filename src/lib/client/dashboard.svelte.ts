// Dashboard view-model (Svelte 5 runes). Owns period, model filter, zoom range,
// and drill selection, and exposes $derived aggregates over the feed snapshot.
// Persists period + filter to localStorage so reopening the tab lands in place.

import type { Period, RollupSnapshot, SessionSummary } from '$lib/types';
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
} from '$lib/core/aggregate';

const LS_KEY = 'chaching.ui.v1';

/** Add (or subtract) whole days to a YYYY-MM-DD string, in UTC. */
function addDaysISO(day: string, delta: number): string {
	const d = new Date(day + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

function zeroTotals(): Totals {
	return { tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, cost: 0, requests: 0, costUnknownRequests: 0 };
}

export interface DrillTarget {
	kind: 'period' | 'session';
	label: string;
	// period drill
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
}

export class Dashboard {
	period = $state<Period>('week');
	/** empty = all models; otherwise scope the whole dashboard to these models */
	modelFilter = $state<Set<string>>(new Set());
	providerFilter = $state<Set<string>>(new Set());
	/** active zoom window over the trend (inclusive day range), null = full range */
	zoom = $state<{ from: string; to: string } | null>(null);
	drill = $state<DrillTarget | null>(null);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (raw) {
					const p = JSON.parse(raw) as PersistedUI;
					if (p.period) this.period = p.period;
					if (Array.isArray(p.models)) this.modelFilter = new Set(p.models);
					if (Array.isArray(p.providers)) this.providerFilter = new Set(p.providers);
				}
			} catch {
				/* ignore */
			}
		}
	}

	private persist(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			const data: PersistedUI = { period: this.period, models: [...this.modelFilter], providers: [...this.providerFilter] };
			localStorage.setItem(LS_KEY, JSON.stringify(data));
		} catch {
			/* ignore */
		}
	}

	setPeriod(p: Period): void {
		this.period = p;
		this.zoom = null;
		this.persist();
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

	setZoom(from: string, to: string): void {
		this.zoom = { from, to };
	}

	resetZoom(): void {
		this.zoom = null;
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

	private filterSet(): Set<string> | null {
		return this.modelFilter.size > 0 ? this.modelFilter : null;
	}

	private providerSet(): Set<string> | null {
		return this.providerFilter.size > 0 ? this.providerFilter : null;
	}

	/** The day-grain currently in scope (zoom window applied). */
	scopedGrain(snap: RollupSnapshot) {
		const z = this.zoom;
		return z ? filterDays(snap.dayModel, z.from, z.to) : snap.dayModel;
	}

	/** Trend buckets for the chart at the current period + zoom + model filter. */
	trend(snap: RollupSnapshot): PeriodBucket[] {
		// when zoomed, drop to a finer grain automatically (month->day, week->day)
		const effectivePeriod: Period = this.zoom ? (this.period === 'month' ? 'day' : 'day') : this.period;
		return aggregateByPeriod(this.scopedGrain(snap), effectivePeriod, this.filterSet(), this.providerSet());
	}

	/** Per-model totals in scope (drives donut + legend + filter). */
	models(snap: RollupSnapshot): ModelTotal[] {
		const providers = this.providerSet();
		const grain = providers ? this.scopedGrain(snap).filter((dm) => providers.has(dm.provider)) : this.scopedGrain(snap);
		return aggregateByModel(grain);
	}

	providers(snap: RollupSnapshot): ProviderTotal[] {
		return aggregateByProvider(this.scopedGrain(snap));
	}

	/**
	 * Rolling window for the selected period, anchored at the latest day with data.
	 * day = latest day, week = last 7 days, month = last 30 days. Prior = the
	 * immediately-preceding equal-length window (for the delta). Rolling windows
	 * (vs calendar buckets) avoid the "5 days into the month" overlap where the
	 * latest week and latest month coincide, and always give Day/Week/Month
	 * distinct, meaningful figures.
	 */
	periodWindow(snap: RollupSnapshot): {
		from: string;
		to: string;
		priorFrom: string;
		priorTo: string;
		label: string;
	} {
		const to = snap.latestDay ?? snap.earliestDay ?? '1970-01-01';
		const span = this.period === 'day' ? 1 : this.period === 'week' ? 7 : 30;
		const from = addDaysISO(to, -(span - 1));
		const priorTo = addDaysISO(from, -1);
		const priorFrom = addDaysISO(priorTo, -(span - 1));
		const label = this.period === 'day' ? 'Today' : this.period === 'week' ? 'Last 7 days' : 'Last 30 days';
		return { from, to, priorFrom, priorTo, label };
	}

	/** Current-period and prior-period totals for the hero + delta. */
	heroTotals(snap: RollupSnapshot): { current: Totals; prior: Totals; label: string } {
		const models = this.filterSet();
		// zoom overrides the period window for the headline figures.
		if (this.zoom) {
			const cur = sumGrain(snap.dayModel, { from: this.zoom.from, to: this.zoom.to, models, providers: this.providerSet() });
			return { current: cur, prior: zeroTotals(), label: 'Zoom range' };
		}
		const w = this.periodWindow(snap);
		return {
			current: sumGrain(snap.dayModel, { from: w.from, to: w.to, models, providers: this.providerSet() }),
			prior: sumGrain(snap.dayModel, { from: w.priorFrom, to: w.priorTo, models, providers: this.providerSet() }),
			label: w.label
		};
	}

	/**
	 * Grand totals in scope for the summary cards. Scoped to the selected period
	 * window (so the cards move with Day/Week/Month), with the model filter
	 * applied. A zoom selection overrides the period window.
	 */
	scopedTotals(snap: RollupSnapshot): Totals {
		const models = this.filterSet();
		if (this.zoom) {
			return sumGrain(snap.dayModel, { from: this.zoom.from, to: this.zoom.to, models, providers: this.providerSet() });
		}
		const w = this.periodWindow(snap);
		return sumGrain(snap.dayModel, { from: w.from, to: w.to, models, providers: this.providerSet() });
	}

	/** Sessions in scope (model filter applied via model mix, zoom via lastTs). */
	scopedSessions(snap: RollupSnapshot): SessionSummary[] {
		const filter = this.filterSet();
		let sessions = snap.sessions;
		if (filter) sessions = sessions.filter((s) => s.models.some((m) => filter.has(m)));
		const providerFilter = this.providerSet();
		if (providerFilter) sessions = sessions.filter((s) => providerFilter.has(s.provider));
		return sessions;
	}
}
