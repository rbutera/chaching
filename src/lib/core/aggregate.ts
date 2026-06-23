// Pure, isomorphic re-aggregation helpers over the per-(day, provider, model) grain.
// The server ships `DayModelAgg[]`; the client re-aggregates to day/week/month,
// to per-model splits, and to period buckets — all in-memory, no server round trip.

import type { CoverageMap, DayCoverage, DayModelAgg, Period, TokenCounts } from '../types';

/**
 * The grains the re-aggregation supports as bucket keys. A subset of `Period`:
 * `quarter`/`all` are window selections (rolling spans), not bucket grains — the
 * trend renders them as week/month buckets, never a single "all" bucket.
 */
export type BucketGrain = Extract<Period, 'day' | 'week' | 'month'>;

export function zeroTokens(): TokenCounts {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

export function totalTokens(t: TokenCounts): number {
	return t.input + t.output + t.cacheCreation + t.cacheRead;
}

function addInto(into: TokenCounts, from: TokenCounts): void {
	into.input += from.input;
	into.output += from.output;
	into.cacheCreation += from.cacheCreation;
	into.cacheRead += from.cacheRead;
}

/** Parse a YYYY-MM-DD day string as a UTC Date. */
function dayToUTC(day: string): Date {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

/** ISO-8601 week key, e.g. "2026-W23". Weeks start Monday (UTC). */
function isoWeekKey(day: string): string {
	const date = dayToUTC(day);
	// ISO week: Thursday of the current week determines the year.
	const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
	date.setUTCDate(date.getUTCDate() - dayNum + 3); // move to Thursday
	const isoYear = date.getUTCFullYear();
	const jan1 = new Date(Date.UTC(isoYear, 0, 1));
	const week = Math.floor((date.getTime() - jan1.getTime()) / (7 * 86400000)) + 1;
	return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** The bucket key for a day under a given grain. */
export function periodKey(day: string, grain: BucketGrain): string {
	switch (grain) {
		case 'day':
			return day;
		case 'week':
			return isoWeekKey(day);
		case 'month':
			return day.slice(0, 7); // YYYY-MM
	}
}

/**
 * A coverage summary over a span of days (a bucket, or a whole window). `states` counts
 * how many contributing days were in each coverage state; `worst` is the least-trustworthy
 * state present, so a single bar/card can pick one provenance mark cheaply (design D4).
 */
export interface CoverageSummary {
	states: Partial<Record<DayCoverage, number>>;
	worst: DayCoverage;
}

/** worst = least trustworthy. Order: missing > partial > zero > frozen. */
const COVERAGE_RANK: Record<DayCoverage, number> = {
	missing: 3,
	partial: 2,
	zero: 1,
	frozen: 0
};

/** The less-trustworthy of two states (used to fold `worst`). */
function worseCoverage(a: DayCoverage, b: DayCoverage): DayCoverage {
	return COVERAGE_RANK[a] >= COVERAGE_RANK[b] ? a : b;
}

/**
 * Classify the coverage state of a single in-window day from the snapshot's coverage map.
 * A day the layer has an opinion about uses that opinion; any other in-window day is
 * `missing` (range-relative, materialized here — design D1/D5).
 */
export function dayCoverageState(day: string, coverage: CoverageMap): DayCoverage {
	return coverage[day] ?? 'missing';
}

/**
 * Fold a list of (already in-window) days into a coverage summary using the coverage map.
 * Every day is classified exactly once; absent-from-map days count as `missing`.
 */
export function summarizeCoverage(days: Iterable<string>, coverage: CoverageMap): CoverageSummary {
	const states: Partial<Record<DayCoverage, number>> = {};
	let worst: DayCoverage = 'frozen';
	let any = false;
	for (const day of days) {
		const state = dayCoverageState(day, coverage);
		states[state] = (states[state] ?? 0) + 1;
		worst = any ? worseCoverage(worst, state) : state;
		any = true;
	}
	return { states, worst };
}

export interface PeriodBucket {
	key: string;
	/** representative start day of the bucket (for x-axis ordering / labels) */
	startDay: string;
	tokens: TokenCounts;
	requests: number;
	cost: number;
	costUnknownRequests: number;
	/** per-model breakdown within the bucket */
	byModel: Map<string, { tokens: TokenCounts; cost: number; requests: number }>;
	/** coverage provenance over the days contributing to this bucket */
	coverage: CoverageSummary;
}

export interface GrainFilter {
	from?: string;
	to?: string;
	models?: Set<string> | null;
	providers?: Set<string> | null;
	/** in-window day list + the snapshot coverage map, to summarize provenance over the window */
	coverage?: CoverageFold;
}

/**
 * Coverage inputs for the aggregation fold. `map` is the snapshot's coverage map; `days`
 * is the in-window calendar-day list the view-model enumerates (so days with NO spend rows
 * — `missing` / frozen-`zero` — are still counted in their bucket). Coverage is
 * filter-invariant: it is a property of the DAY, not the model/provider slice (design D-cross).
 */
export interface CoverageFold {
	map: CoverageMap;
	days: string[];
}

const EMPTY_COVERAGE: CoverageSummary = { states: {}, worst: 'frozen' };

/** Aggregate the (day,provider,model) grain into period buckets, sorted by start day asc. */
export function aggregateByPeriod(
	dayModel: DayModelAgg[],
	grain: BucketGrain,
	modelFilter?: Set<string> | null,
	providerFilter?: Set<string> | null,
	coverageFold?: CoverageFold
): PeriodBucket[] {
	const buckets = new Map<string, PeriodBucket>();

	for (const dm of dayModel) {
		if (modelFilter && modelFilter.size > 0 && !modelFilter.has(dm.model)) continue;
		if (providerFilter && providerFilter.size > 0 && !providerFilter.has(dm.provider)) continue;
		const key = periodKey(dm.day, grain);
		let b = buckets.get(key);
		if (!b) {
			b = {
				key,
				startDay: dm.day,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				costUnknownRequests: 0,
				byModel: new Map(),
				coverage: EMPTY_COVERAGE
			};
			buckets.set(key, b);
		}
		if (dm.day < b.startDay) b.startDay = dm.day;
		addInto(b.tokens, dm.tokens);
		b.requests += dm.requests;
		b.cost += dm.cost;
		b.costUnknownRequests += dm.costUnknownRequests;

		let m = b.byModel.get(dm.model);
		if (!m) {
			m = { tokens: zeroTokens(), cost: 0, requests: 0 };
			b.byModel.set(dm.model, m);
		}
		addInto(m.tokens, dm.tokens);
		m.cost += dm.cost;
		m.requests += dm.requests;
	}

	if (coverageFold) {
		// Group every in-window calendar day by its bucket key (filter-invariant: a day's
		// coverage doesn't depend on which models/providers were selected), summarize per
		// bucket, and attach. A day with NO spend rows still lands in its bucket here, so
		// a `missing` / frozen-`zero` day is counted even though the grain loop never saw it.
		const daysByBucket = new Map<string, string[]>();
		for (const day of coverageFold.days) {
			const key = periodKey(day, grain);
			let list = daysByBucket.get(key);
			if (!list) {
				list = [];
				daysByBucket.set(key, list);
			}
			list.push(day);
		}
		for (const [key, days] of daysByBucket) {
			const summary = summarizeCoverage(days, coverageFold.map);
			let b = buckets.get(key);
			if (!b) {
				// A bucket with coverage-relevant days but no spend rows (all missing/zero):
				// materialize it so the chart can render a provenance-only slot.
				b = {
					key,
					startDay: days.reduce((a, d) => (d < a ? d : a), days[0]),
					tokens: zeroTokens(),
					requests: 0,
					cost: 0,
					costUnknownRequests: 0,
					byModel: new Map(),
					coverage: summary
				};
				buckets.set(key, b);
			} else {
				b.coverage = summary;
			}
		}
	}

	return [...buckets.values()].sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : 0));
}

export interface ModelTotal {
	model: string;
	tokens: TokenCounts;
	cost: number;
	requests: number;
}

export interface ProviderTotal {
	provider: string;
	tokens: TokenCounts;
	cost: number;
	requests: number;
}

/** Total per model across the (optionally day-windowed) grain. */
export function aggregateByModel(dayModel: DayModelAgg[]): ModelTotal[] {
	const m = new Map<string, ModelTotal>();
	for (const dm of dayModel) {
		let t = m.get(dm.model);
		if (!t) {
			t = { model: dm.model, tokens: zeroTokens(), cost: 0, requests: 0 };
			m.set(dm.model, t);
		}
		addInto(t.tokens, dm.tokens);
		t.cost += dm.cost;
		t.requests += dm.requests;
	}
	return [...m.values()].sort((a, b) => b.cost - a.cost);
}

export function aggregateByProvider(dayModel: DayModelAgg[]): ProviderTotal[] {
	const providers = new Map<string, ProviderTotal>();
	for (const dm of dayModel) {
		let t = providers.get(dm.provider);
		if (!t) {
			t = { provider: dm.provider, tokens: zeroTokens(), cost: 0, requests: 0 };
			providers.set(dm.provider, t);
		}
		addInto(t.tokens, dm.tokens);
		t.cost += dm.cost;
		t.requests += dm.requests;
	}
	return [...providers.values()].sort((a, b) => b.cost - a.cost);
}

export interface Totals {
	tokens: TokenCounts;
	cost: number;
	requests: number;
	costUnknownRequests: number;
	/** coverage provenance over the days in the summed window (filter-invariant) */
	coverage: CoverageSummary;
}

/** Sum the grain (optionally filtered to a day range [from, to] inclusive and/or models). */
export function sumGrain(
	dayModel: DayModelAgg[],
	opts: GrainFilter = {}
): Totals {
	const t: Totals = {
		tokens: zeroTokens(),
		cost: 0,
		requests: 0,
		costUnknownRequests: 0,
		coverage: EMPTY_COVERAGE
	};
	for (const dm of dayModel) {
		if (opts.from && dm.day < opts.from) continue;
		if (opts.to && dm.day > opts.to) continue;
		if (opts.models && opts.models.size > 0 && !opts.models.has(dm.model)) continue;
		if (opts.providers && opts.providers.size > 0 && !opts.providers.has(dm.provider)) continue;
		addInto(t.tokens, dm.tokens);
		t.cost += dm.cost;
		t.requests += dm.requests;
		t.costUnknownRequests += dm.costUnknownRequests;
	}
	// Coverage folds over the in-window DAY list (filter-invariant), not the spend rows, so
	// a window with retention gaps reports `missing` even though no row exists for those days.
	if (opts.coverage) {
		t.coverage = summarizeCoverage(opts.coverage.days, opts.coverage.map);
	}
	return t;
}

/** Filter the grain to a day range (inclusive). */
export function filterDays(dayModel: DayModelAgg[], from?: string, to?: string): DayModelAgg[] {
	if (!from && !to) return dayModel;
	return dayModel.filter((dm) => (!from || dm.day >= from) && (!to || dm.day <= to));
}
