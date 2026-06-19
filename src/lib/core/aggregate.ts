// Pure, isomorphic re-aggregation helpers over the per-(day, provider, model) grain.
// The server ships `DayModelAgg[]`; the client re-aggregates to day/week/month,
// to per-model splits, and to period buckets — all in-memory, no server round trip.

import type { DayModelAgg, Period, TokenCounts } from '../types';

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

/** The bucket key for a day under a given period granularity. */
export function periodKey(day: string, period: Period): string {
	switch (period) {
		case 'day':
			return day;
		case 'week':
			return isoWeekKey(day);
		case 'month':
			return day.slice(0, 7); // YYYY-MM
	}
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
}

export interface GrainFilter {
	from?: string;
	to?: string;
	models?: Set<string> | null;
	providers?: Set<string> | null;
}

/** Aggregate the (day,provider,model) grain into period buckets, sorted by start day asc. */
export function aggregateByPeriod(
	dayModel: DayModelAgg[],
	period: Period,
	modelFilter?: Set<string> | null,
	providerFilter?: Set<string> | null
): PeriodBucket[] {
	const buckets = new Map<string, PeriodBucket>();

	for (const dm of dayModel) {
		if (modelFilter && modelFilter.size > 0 && !modelFilter.has(dm.model)) continue;
		if (providerFilter && providerFilter.size > 0 && !providerFilter.has(dm.provider)) continue;
		const key = periodKey(dm.day, period);
		let b = buckets.get(key);
		if (!b) {
			b = {
				key,
				startDay: dm.day,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				costUnknownRequests: 0,
				byModel: new Map()
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
}

/** Sum the grain (optionally filtered to a day range [from, to] inclusive and/or models). */
export function sumGrain(
	dayModel: DayModelAgg[],
	opts: GrainFilter = {}
): Totals {
	const t: Totals = { tokens: zeroTokens(), cost: 0, requests: 0, costUnknownRequests: 0 };
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
	return t;
}

/** Filter the grain to a day range (inclusive). */
export function filterDays(dayModel: DayModelAgg[], from?: string, to?: string): DayModelAgg[] {
	if (!from && !to) return dayModel;
	return dayModel.filter((dm) => (!from || dm.day >= from) && (!to || dm.day <= to));
}
