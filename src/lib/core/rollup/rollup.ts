// In-memory rollup state. Holds per-(day, provider, model) aggregates + a session index +
// derived totals/blocks. Records are added once (after dedup); the rollup answers
// snapshot/delta queries. Week/month + month-to-day-to-session re-aggregation are
// pure operations the CLIENT does over `dayModel` — the server just ships the
// finest persistent grain (per-day-per-provider-per-model) plus the session index.

import type {
	BlockSummary,
	CoverageMap,
	DayCoverage,
	DayModelAgg,
	RollupDelta,
	RollupSnapshot,
	SessionSummary,
	TokenCounts,
	UsageRecord
} from '../../types';
import { getPricingMeta, hasPrice } from '../pricing/cost';
import { isoDayUTC } from '../ingest/parse';
import { BlockAccumulator } from './blocks';

const KEY_SEP = '\u001f';

function zeroTokens(): TokenCounts {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function addTokens(into: TokenCounts, from: TokenCounts): void {
	into.input += from.input;
	into.output += from.output;
	into.cacheCreation += from.cacheCreation;
	into.cacheRead += from.cacheRead;
}

interface SessionState {
	sessionId: string;
	provider: string;
	project: string;
	firstTs: number;
	lastTs: number;
	tokens: TokenCounts;
	requests: number;
	cost: number;
	costUnknownRequests: number;
	modelCounts: Map<string, number>;
}

/** The extra per-day-model counters the freeze store persists but the snapshot omits. */
interface DayModelExtra {
	cacheCreation1h: number;
	cacheCreation5m: number;
	webSearchRequests: number;
	webFetchRequests: number;
}

/** A frozen-candidate aggregate: the public agg plus the persisted-only extras. */
export type FrozenAgg = DayModelAgg & DayModelExtra;

/**
 * The two facts the engine owns that the rollup can't see, injected so the rollup can
 * classify per-day coverage (design D2):
 * - `today`: the canonical UTC day, so "today" reads `partial` (live tail).
 * - `scanPartial`: this run's freeze-gating signal (`scanIsPartial()`), so a scanned-but-
 *   unfrozen PAST day reads `partial` rather than authoritative.
 * - `historyEnabled`: with history off nothing is ever frozen; a scanned past day with
 *   spend is then marked `partial` (authoritative-equivalent for display) so the
 *   view-model never mislabels it `missing` (the history-disabled degrade rule).
 */
export interface CoverageInput {
	today: string;
	scanPartial: boolean;
	historyEnabled: boolean;
}

function zeroExtra(): DayModelExtra {
	return { cacheCreation1h: 0, cacheCreation5m: 0, webSearchRequests: 0, webFetchRequests: 0 };
}

export class Rollup {
	/** key: `${day}\u001f${provider}\u001f${model}` */
	private dayModel = new Map<string, DayModelAgg>();
	/** parallel per-day-model extras (1h/5m/web) — persisted on freeze, omitted from snapshot. */
	private dayModelExtra = new Map<string, DayModelExtra>();
	private sessions = new Map<string, SessionState>();
	private modelCost = new Map<string, number>();
	private providerCost = new Map<string, number>();
	private unknownPriceModels = new Set<string>();
	/** days (YYYY-MM-DD UTC) already frozen in the DB — their records are skipped on scan. */
	private frozenDays = new Set<string>();

	private totalTokens = zeroTokens();
	private totalRequests = 0;
	private totalCost = 0;
	private totalCostUnknown = 0;

	private earliestDay: string | null = null;
	private latestDay: string | null = null;

	private filesScanned = 0;
	private linesSkipped = 0;
	private duplicatesSkipped = 0;
	private recordsCounted = 0;

	private cutoverTs: number | null = null;

	private dirtyDayModel = new Set<string>();
	private dirtySessions = new Set<string>();
	private dirtyAny = false;

	setCutover(ts: number | null): void {
		this.cutoverTs = ts;
	}

	markFileScanned(): void {
		this.filesScanned++;
	}

	addSkipped(n = 1): void {
		this.linesSkipped += n;
	}

	addDuplicate(n = 1): void {
		this.duplicatesSkipped += n;
	}

	/**
	 * Mark days as already frozen in the DB. Records whose UTC day is in this set are
	 * skipped by `add()` — those days are complete + authoritative in the DB, so
	 * re-counting them from logs (which may now be pruned/partial) would double-count.
	 */
	setFrozenDays(days: Iterable<string>): void {
		for (const d of days) this.frozenDays.add(d);
	}

	/** True if `day` is frozen in the DB (and so should be skipped on the live scan). */
	isFrozenDay(day: string): boolean {
		return this.frozenDays.has(day);
	}

	/** Add a single already-deduped usage record to the rollup. */
	add(rec: UsageRecord): void {
		// Skip records for days already frozen in the DB — the DB copy is authoritative.
		if (this.frozenDays.has(rec.day)) return;

		this.recordsCounted++;
		this.dirtyAny = true;

		const cost = rec.cost ?? 0;
		const unknown = rec.cost == null ? 1 : 0;
		if (rec.cost == null && !hasPrice(rec.model)) {
			this.unknownPriceModels.add(rec.model);
		}

		const dmKey = recordKey(rec.day, rec.provider, rec.model);
		let dm = this.dayModel.get(dmKey);
		if (!dm) {
			dm = {
				day: rec.day,
				provider: rec.provider,
				model: rec.model,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				costUnknownRequests: 0
			};
			this.dayModel.set(dmKey, dm);
		}
		addTokens(dm.tokens, rec.tokens);
		dm.requests++;
		dm.cost += cost;
		dm.costUnknownRequests += unknown;
		this.dirtyDayModel.add(dmKey);

		// extras (persisted on freeze, omitted from the snapshot contract)
		let extra = this.dayModelExtra.get(dmKey);
		if (!extra) {
			extra = zeroExtra();
			this.dayModelExtra.set(dmKey, extra);
		}
		extra.cacheCreation1h += rec.cacheCreation1h;
		extra.cacheCreation5m += rec.cacheCreation5m;
		extra.webSearchRequests += rec.webSearchRequests;
		extra.webFetchRequests += rec.webFetchRequests;

		// session index
		const recSessionKey = sessionKey(rec.provider, rec.sessionId);
		let s = this.sessions.get(recSessionKey);
		if (!s) {
			s = {
				sessionId: rec.sessionId,
				provider: rec.provider,
				project: rec.project,
				firstTs: rec.timestamp,
				lastTs: rec.timestamp,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				costUnknownRequests: 0,
				modelCounts: new Map()
			};
			this.sessions.set(recSessionKey, s);
		}
		addTokens(s.tokens, rec.tokens);
		s.requests++;
		s.cost += cost;
		s.costUnknownRequests += unknown;
		s.firstTs = Math.min(s.firstTs, rec.timestamp);
		s.lastTs = Math.max(s.lastTs, rec.timestamp);
		s.modelCounts.set(rec.model, (s.modelCounts.get(rec.model) ?? 0) + 1);
		this.dirtySessions.add(recSessionKey);

		// totals
		addTokens(this.totalTokens, rec.tokens);
		this.totalRequests++;
		this.totalCost += cost;
		this.totalCostUnknown += unknown;
		this.modelCost.set(rec.model, (this.modelCost.get(rec.model) ?? 0) + cost);
		this.providerCost.set(rec.provider, (this.providerCost.get(rec.provider) ?? 0) + cost);

		// 5h block accumulator
		this.blockAccumulator.add(rec);

		// coverage
		if (this.earliestDay == null || rec.day < this.earliestDay) this.earliestDay = rec.day;
		if (this.latestDay == null || rec.day > this.latestDay) this.latestDay = rec.day;
	}

	/**
	 * Seed the rollup with pre-aggregated frozen rows from the history DB. These are
	 * finalized past-day aggregates: they are merged directly into the day-model index,
	 * session index, totals, cost maps, and coverage WITHOUT per-record dedup and WITHOUT
	 * marking anything dirty (they are not a live delta). Blocks are intentionally NOT
	 * fed — they are a rolling 5h window that only spans recent/live time, and frozen
	 * days are strictly in the past, outside any active block.
	 *
	 * Call this BEFORE the live scan so the scan can skip frozen days (no overlap).
	 */
	loadAggregates(aggregates: readonly FrozenAgg[], sessions: readonly SessionSummary[]): void {
		for (const a of aggregates) {
			const dmKey = recordKey(a.day, a.provider, a.model);
			let dm = this.dayModel.get(dmKey);
			if (!dm) {
				dm = {
					day: a.day,
					provider: a.provider,
					model: a.model,
					tokens: zeroTokens(),
					requests: 0,
					cost: 0,
					costUnknownRequests: 0
				};
				this.dayModel.set(dmKey, dm);
			}
			addTokens(dm.tokens, a.tokens);
			dm.requests += a.requests;
			dm.cost += a.cost;
			dm.costUnknownRequests += a.costUnknownRequests;

			let extra = this.dayModelExtra.get(dmKey);
			if (!extra) {
				extra = zeroExtra();
				this.dayModelExtra.set(dmKey, extra);
			}
			extra.cacheCreation1h += a.cacheCreation1h;
			extra.cacheCreation5m += a.cacheCreation5m;
			extra.webSearchRequests += a.webSearchRequests;
			extra.webFetchRequests += a.webFetchRequests;

			// totals + cost maps + coverage
			addTokens(this.totalTokens, a.tokens);
			this.totalRequests += a.requests;
			this.totalCost += a.cost;
			this.totalCostUnknown += a.costUnknownRequests;
			this.recordsCounted += a.requests;
			this.modelCost.set(a.model, (this.modelCost.get(a.model) ?? 0) + a.cost);
			this.providerCost.set(a.provider, (this.providerCost.get(a.provider) ?? 0) + a.cost);
			if (a.costUnknownRequests > 0 && !hasPrice(a.model)) this.unknownPriceModels.add(a.model);
			if (this.earliestDay == null || a.day < this.earliestDay) this.earliestDay = a.day;
			if (this.latestDay == null || a.day > this.latestDay) this.latestDay = a.day;
		}

		for (const s of sessions) {
			const key = sessionKey(s.provider, s.sessionId);
			if (this.sessions.has(key)) continue; // finalized session already present; don't double-add
			// Reconstruct modelCounts preserving the persisted most-used-first order via
			// descending synthetic counts (real per-model counts aren't persisted).
			const modelCounts = new Map<string, number>();
			let rank = s.models.length;
			for (const m of s.models) modelCounts.set(m, rank--);
			this.sessions.set(key, {
				sessionId: s.sessionId,
				provider: s.provider,
				project: s.project,
				firstTs: s.firstTs,
				lastTs: s.lastTs,
				tokens: { ...s.tokens },
				requests: s.requests,
				cost: s.cost,
				costUnknownRequests: s.costUnknownRequests,
				modelCounts
			});
		}
	}

	/**
	 * Extract the freeze candidates for the given set of days: the full per-(day,
	 * provider, model) aggregates (with persisted-only extras) plus the sessions whose
	 * last activity falls on one of those days. Callers freeze only NOT-yet-frozen days.
	 */
	freezeCandidates(days: ReadonlySet<string>): { aggregates: FrozenAgg[]; sessions: SessionSummary[] } {
		const aggregates: FrozenAgg[] = [];
		for (const [key, dm] of this.dayModel) {
			if (!days.has(dm.day)) continue;
			const extra = this.dayModelExtra.get(key) ?? zeroExtra();
			aggregates.push({
				...dm,
				tokens: { ...dm.tokens },
				cacheCreation1h: extra.cacheCreation1h,
				cacheCreation5m: extra.cacheCreation5m,
				webSearchRequests: extra.webSearchRequests,
				webFetchRequests: extra.webFetchRequests
			});
		}
		// Sessions are persisted once their LAST activity falls on a frozen day (the session
		// is keyed by its whole lifetime, not split per day). The day/week/month aggregates
		// above are the authoritative spend numbers and are always correct; the session index
		// is a secondary drill-down. Known limitation: a session that straddles a freeze
		// boundary AND a process restart can persist an under-counted summary, because the
		// earlier day's records are skipped on reload. Spend totals are unaffected (the
		// day-model aggregates already captured those tokens); only that session's drill-down
		// row is short. Fixing this fully needs per-day session fragments — out of scope here.
		const sessions: SessionSummary[] = [];
		for (const s of this.sessions.values()) {
			if (days.has(isoDayUTC(s.lastTs))) sessions.push(this.sessionSummary(s));
		}
		return { aggregates, sessions };
	}

	/** The set of days currently marked frozen (seeded from the DB on load). */
	frozenDaySet(): Set<string> {
		return new Set(this.frozenDays);
	}

	/** Distinct days present in the rollup (from the day-model index). */
	scannedDays(): Set<string> {
		const days = new Set<string>();
		for (const dm of this.dayModel.values()) days.add(dm.day);
		return days;
	}

	/**
	 * Days that have at least one row with real activity (requests > 0). A frozen day
	 * present in the index only as all-zero rows is a genuine `$0` day (state `zero`),
	 * NOT a day with spend. Requests is the activity signal: a day can have rows whose
	 * cost is 0 (unknown-price model) yet still represent real usage.
	 */
	private daysWithSpend(): Set<string> {
		const days = new Set<string>();
		for (const dm of this.dayModel.values()) {
			if (dm.requests > 0) days.add(dm.day);
		}
		return days;
	}

	/**
	 * Classify per-day coverage from facts the layer holds (frozen set, scanned days,
	 * per-day spend, latestDay) plus the engine-injected `{ today, scanPartial,
	 * historyEnabled }`. Emits ONLY days the layer has an opinion about (frozen / zero /
	 * partial). `missing` is never a key here — it is range-relative and filled by the
	 * view-model. Priority order matches design D1.
	 */
	private buildCoverage(input: CoverageInput): CoverageMap {
		const { today, scanPartial, historyEnabled } = input;
		const frozen = this.frozenDays;
		const withSpend = this.daysWithSpend();
		const coverage: CoverageMap = {};

		// Every frozen PAST day gets an opinion: frozen (has spend) or zero (genuine $0).
		// A frozen "today" or future day is nonsensical (today is partial by definition);
		// today is handled below so it always reads `partial`, never frozen/zero.
		for (const day of frozen) {
			if (day >= today) continue;
			coverage[day] = withSpend.has(day) ? 'frozen' : 'zero';
		}

		// Today is partial by definition whenever the layer has touched it at all (scanned
		// live, or — pathologically — marked frozen). It can never read frozen/zero.
		if (this.scannedDays().has(today) || frozen.has(today)) {
			coverage[today] = 'partial';
		}

		// Past scanned (live, not-frozen) days are partial only when this run's scan was
		// gated partial (the freeze couldn't run), OR — history-disabled degrade — when
		// history is off (nothing ever freezes) and the day has spend, so it never reads
		// `missing` downstream. Otherwise (history on, clean scan, somehow un-frozen) the
		// layer has no authoritative opinion and the view-model treats it as missing.
		for (const day of this.scannedDays()) {
			if (coverage[day]) continue; // today / a frozen classification already won
			if (day < today && (scanPartial || (!historyEnabled && withSpend.has(day)))) {
				coverage[day] = 'partial';
			}
		}

		return coverage;
	}

	private modelsByCost(): string[] {
		return [...this.modelCost.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
	}

	private providersByCost(): string[] {
		return [...this.providerCost.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
	}

	private sessionSummary(s: SessionState): SessionSummary {
		const models = [...s.modelCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
		return {
			sessionId: s.sessionId,
			provider: s.provider,
			project: s.project,
			firstTs: s.firstTs,
			lastTs: s.lastTs,
			tokens: { ...s.tokens },
			requests: s.requests,
			cost: s.cost,
			costUnknownRequests: s.costUnknownRequests,
			models
		};
	}

	private blockAccumulator = new BlockAccumulator();

	/** Rolling 5-hour blocks (ccusage window model), newest first. */
	computeBlocks(now = Date.now()): BlockSummary[] {
		return this.blockAccumulator.snapshot(now);
	}

	snapshot(now = Date.now(), coverageInput?: CoverageInput): RollupSnapshot {
		const meta = getPricingMeta();
		void meta; // meta exposed via separate endpoint; kept here for future inline use
		// Coverage is classified from the engine-injected facts. When no input is supplied
		// (e.g. a bare unit test that doesn't exercise coverage), emit an empty map: the
		// view-model then treats every in-window day as `missing`, which is honest for a
		// snapshot whose provenance the caller never declared.
		const coverage = coverageInput ? this.buildCoverage(coverageInput) : {};
		return {
			generatedAt: now,
			earliestDay: this.earliestDay,
			latestDay: this.latestDay,
			totals: {
				tokens: { ...this.totalTokens },
				requests: this.totalRequests,
				cost: this.totalCost,
				costUnknownRequests: this.totalCostUnknown
			},
			dayModel: [...this.dayModel.values()].map((d) => ({ ...d, tokens: { ...d.tokens } })),
			sessions: [...this.sessions.values()]
				.map((s) => this.sessionSummary(s))
				.sort((a, b) => b.lastTs - a.lastTs),
			blocks: this.blockAccumulator.snapshot(now),
			models: this.modelsByCost(),
			providers: this.providersByCost(),
			unknownPriceModels: [...this.unknownPriceModels],
			stats: {
				filesScanned: this.filesScanned,
				recordsCounted: this.recordsCounted,
				linesSkipped: this.linesSkipped,
				duplicatesSkipped: this.duplicatesSkipped
			},
			cutoverTs: this.cutoverTs,
			coverage
		};
	}

	hasDirty(): boolean {
		return this.dirtyAny;
	}

	/** Drain accumulated changes into a delta and reset the dirty sets. */
	drainDelta(now = Date.now()): RollupDelta | null {
		if (!this.dirtyAny) return null;

		const dayModel: DayModelAgg[] = [];
		for (const k of this.dirtyDayModel) {
			const dm = this.dayModel.get(k);
			if (dm) dayModel.push({ ...dm, tokens: { ...dm.tokens } });
		}
		const sessions: SessionSummary[] = [];
		for (const id of this.dirtySessions) {
			const s = this.sessions.get(id);
			if (s) sessions.push(this.sessionSummary(s));
		}

		this.dirtyDayModel.clear();
		this.dirtySessions.clear();
		this.dirtyAny = false;

		return {
			generatedAt: now,
			dayModel,
			sessions,
			blocks: this.blockAccumulator.snapshot(now),
			totals: {
				tokens: { ...this.totalTokens },
				requests: this.totalRequests,
				cost: this.totalCost,
				costUnknownRequests: this.totalCostUnknown
			},
			earliestDay: this.earliestDay,
			latestDay: this.latestDay,
			models: this.modelsByCost(),
			providers: this.providersByCost(),
			unknownPriceModels: [...this.unknownPriceModels],
			stats: {
				filesScanned: this.filesScanned,
				recordsCounted: this.recordsCounted,
				linesSkipped: this.linesSkipped,
				duplicatesSkipped: this.duplicatesSkipped
			}
		};
	}
}

function recordKey(day: string, provider: string, model: string): string {
	return `${day}${KEY_SEP}${provider}${KEY_SEP}${model}`;
}

function sessionKey(provider: string, sessionId: string): string {
	return `${provider}${KEY_SEP}${sessionId}`;
}
