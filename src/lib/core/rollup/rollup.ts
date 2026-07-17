// In-memory rollup state. Holds per-(day, provider, model) aggregates + a session index +
// derived totals/blocks. Records are added once (after dedup); the rollup answers
// snapshot/delta queries. Week/month + month-to-day-to-session re-aggregation are
// pure operations the CLIENT does over `dayModel` — the server just ships the
// finest persistent grain (per-day-per-provider-per-model) plus the session index.

import type {
	BlockSummary,
	CoverageMap,
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
	machineId?: string;
	subscriptionId?: string | null;
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
 * An hour-bucketed aggregate (epoch-ms floored to the hour, UTC). Published to the sync
 * ledger for the last ~48h so pooled 5-hour-cap windows can be reconstructed at hour grain
 * across machines. Coarser than the per-record local block accumulator by design (a pooled
 * decision recorded for wave B).
 */
export interface HourAgg {
	hourTs: number;
	provider: string;
	model: string;
	tokens: TokenCounts;
	requests: number;
	cost: number;
	costUnknownRequests: number;
}

interface HourState {
	tokens: TokenCounts;
	requests: number;
	cost: number;
	costUnknownRequests: number;
}

/** A snapshot of the publish-dirty key sets (see `publishDirtySnapshot`), C3. */
export interface PublishDirtySnapshot {
	days: ReadonlySet<string>;
	hours: ReadonlySet<string>;
	sessions: ReadonlySet<string>;
}

const HOUR_MS = 60 * 60 * 1000;

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
	/** Local SQLite frozen days also suppress source-log re-ingestion. */
	private skipFrozenDays = new Set<string>();
	/** parallel per-(hour, provider, model) buckets — published to the pooled ledger. */
	private hourModel = new Map<string, HourState>();

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

	/**
	 * Publish-dirty sets (independent of the delta-dirty sets above): (day,provider,model),
	 * (hour,provider,model), and session keys touched by `add()` since the last
	 * `clearPublishDirty()`. The pooled engine publishes only these each burst — a
	 * full-replacement upsert per key, so a failed burst just republishes next time.
	 */
	private pubDirtyDays = new Set<string>();
	private pubDirtyHours = new Set<string>();
	private pubDirtySessions = new Set<string>();

	/**
	 * Immutable capture of the publish-dirty key sets at a single instant. A caller takes one
	 * right before it materializes a publish payload, then — on success — clears EXACTLY these
	 * keys, so a record `add()`ed during the (awaited) publish stays dirty for the next burst
	 * instead of being wiped by a blanket clear (the publish-dirty success-path race, C3).
	 */

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
		for (const d of days) {
			this.frozenDays.add(d);
			this.skipFrozenDays.add(d);
		}
	}

	/** True if `day` is frozen in the DB (and so should be skipped on the live scan). */
	isFrozenDay(day: string): boolean {
		return this.frozenDays.has(day);
	}

	/** Add a single already-deduped usage record to the rollup. */
	add(rec: UsageRecord): void {
		// Skip records for days already frozen in the DB — the DB copy is authoritative.
		if (this.skipFrozenDays.has(rec.day)) return;

		this.recordsCounted++;
		this.dirtyAny = true;

		const cost = rec.cost ?? 0;
		const unknown = rec.cost == null ? 1 : 0;
		if (rec.cost == null && !hasPrice(rec.model)) {
			this.unknownPriceModels.add(rec.model);
		}

		const dmKey = recordKey(rec.day, rec.provider, rec.model, rec.machineId, rec.subscriptionId);
		let dm = this.dayModel.get(dmKey);
		if (!dm) {
			dm = {
				day: rec.day,
				provider: rec.provider,
				model: rec.model,
				machineId: rec.machineId,
				subscriptionId: rec.subscriptionId,
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
		this.pubDirtyDays.add(dayKey(rec.day, rec.provider, rec.model));

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

		// hour bucket (published to the pooled ledger for 5h-cap-window reconstruction)
		const hrTs = Math.floor(rec.timestamp / HOUR_MS) * HOUR_MS;
		const hrKey = hourKey(hrTs, rec.provider, rec.model);
		let hour = this.hourModel.get(hrKey);
		if (!hour) {
			hour = { tokens: zeroTokens(), requests: 0, cost: 0, costUnknownRequests: 0 };
			this.hourModel.set(hrKey, hour);
		}
		addTokens(hour.tokens, rec.tokens);
		hour.requests++;
		hour.cost += cost;
		hour.costUnknownRequests += unknown;
		this.pubDirtyHours.add(hrKey);

		// session index
		const recSessionKey = sessionKey(rec.provider, rec.sessionId, rec.machineId, rec.subscriptionId);
		let s = this.sessions.get(recSessionKey);
		if (!s) {
			s = {
				sessionId: rec.sessionId,
				provider: rec.provider,
				machineId: rec.machineId,
				subscriptionId: rec.subscriptionId,
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
		this.pubDirtySessions.add(recSessionKey);

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
			const dmKey = recordKey(a.day, a.provider, a.model, a.machineId, a.subscriptionId);
			let dm = this.dayModel.get(dmKey);
			if (!dm) {
				dm = {
					day: a.day,
					provider: a.provider,
					model: a.model,
					machineId: a.machineId,
					subscriptionId: a.subscriptionId,
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
			const key = sessionKey(s.provider, s.sessionId, s.machineId, s.subscriptionId);
			if (this.sessions.has(key)) continue; // finalized session already present; don't double-add
			// Reconstruct modelCounts preserving the persisted most-used-first order via
			// descending synthetic counts (real per-model counts aren't persisted).
			const modelCounts = new Map<string, number>();
			let rank = s.models.length;
			for (const m of s.models) modelCounts.set(m, rank--);
			this.sessions.set(key, {
				sessionId: s.sessionId,
				provider: s.provider,
				machineId: s.machineId,
				subscriptionId: s.subscriptionId,
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

	// ── Pooled publish surface ────────────────────────────────────────────────────
	// Full-row aggregates the pooled engine publishes to the ledger. Each row is the
	// CURRENT total for its key, so publishing is an idempotent full-replacement upsert.

	private aggregateForKey(dmKey: string, dm: DayModelAgg): FrozenAgg {
		const extra = this.dayModelExtra.get(dmKey) ?? zeroExtra();
		return {
			...dm,
			tokens: { ...dm.tokens },
			cacheCreation1h: extra.cacheCreation1h,
			cacheCreation5m: extra.cacheCreation5m,
			webSearchRequests: extra.webSearchRequests,
			webFetchRequests: extra.webFetchRequests
		};
	}

	/** Every day aggregate currently held (used for the full publish on pool join/cold start). */
	allDayAggregates(): FrozenAgg[] {
		return [...this.dayModel].map(([key, dm]) => this.aggregateForKey(key, dm));
	}

	/** Day aggregates touched since the last `clearPublishDirty()` (the per-burst delta). */
	dirtyDayAggregates(): FrozenAgg[] {
		const out: FrozenAgg[] = [];
		for (const [key, dm] of this.dayModel) {
			if (this.pubDirtyDays.has(dayKey(dm.day, dm.provider, dm.model))) {
				out.push(this.aggregateForKey(key, dm));
			}
		}
		return out;
	}

	private hourAggregate(key: string, hour: HourState): HourAgg {
		const [tsRaw, provider, model] = key.split(KEY_SEP);
		return {
			hourTs: Number(tsRaw),
			provider,
			model,
			tokens: { ...hour.tokens },
			requests: hour.requests,
			cost: hour.cost,
			costUnknownRequests: hour.costUnknownRequests
		};
	}

	/** Hour aggregates at or after `minHourTs` (the retention floor, e.g. now − 48h). */
	allHourAggregates(minHourTs: number): HourAgg[] {
		const out: HourAgg[] = [];
		for (const [key, hour] of this.hourModel) {
			const agg = this.hourAggregate(key, hour);
			if (agg.hourTs >= minHourTs) out.push(agg);
		}
		return out;
	}

	/** Hour aggregates touched since the last `clearPublishDirty()` and within the window. */
	dirtyHourAggregates(minHourTs: number): HourAgg[] {
		const out: HourAgg[] = [];
		for (const key of this.pubDirtyHours) {
			const hour = this.hourModel.get(key);
			if (!hour) continue;
			const agg = this.hourAggregate(key, hour);
			if (agg.hourTs >= minHourTs) out.push(agg);
		}
		return out;
	}

	/** Every session summary currently held (full publish on pool join/cold start). */
	allSessionSummaries(): SessionSummary[] {
		return [...this.sessions.values()].map((s) => this.sessionSummary(s));
	}

	/** Session summaries touched since the last `clearPublishDirty()`. */
	dirtySessionSummaries(): SessionSummary[] {
		const out: SessionSummary[] = [];
		for (const key of this.pubDirtySessions) {
			const s = this.sessions.get(key);
			if (s) out.push(this.sessionSummary(s));
		}
		return out;
	}

	/** True when any publish-dirty key is pending. */
	hasPublishDirty(): boolean {
		return this.pubDirtyDays.size > 0 || this.pubDirtyHours.size > 0 || this.pubDirtySessions.size > 0;
	}

	/**
	 * Capture the publish-dirty key sets as they stand right now. Pair with
	 * `clearPublishDirty(snapshot)` so a burst clears only what it actually published (C3).
	 */
	publishDirtySnapshot(): PublishDirtySnapshot {
		return {
			days: new Set(this.pubDirtyDays),
			hours: new Set(this.pubDirtyHours),
			sessions: new Set(this.pubDirtySessions)
		};
	}

	/**
	 * Clear publish-dirty keys after a successful burst. With no argument this drops every
	 * pending key (the legacy blanket clear); with a `snapshot` it removes ONLY the keys that
	 * snapshot captured, leaving anything dirtied since (e.g. a record added during the publish
	 * await) intact for the next burst — the fix for the publish-dirty success-path race (C3).
	 */
	clearPublishDirty(snapshot?: PublishDirtySnapshot): void {
		if (!snapshot) {
			this.pubDirtyDays.clear();
			this.pubDirtyHours.clear();
			this.pubDirtySessions.clear();
			return;
		}
		for (const k of snapshot.days) this.pubDirtyDays.delete(k);
		for (const k of snapshot.hours) this.pubDirtyHours.delete(k);
		for (const k of snapshot.sessions) this.pubDirtySessions.delete(k);
	}

	/**
	 * Feed peer hour aggregates into the block accumulator so pooled 5-hour-cap windows
	 * include every machine's recent spend (hour grain — see `HourAgg`). Used only on a
	 * peer-overlay rollup, never on the local rollup.
	 */
	loadHourAggregates(hours: readonly HourAgg[]): void {
		for (const h of hours) this.blockAccumulator.addBucket(h.hourTs, h.tokens, h.cost, h.requests);
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
			machineId: s.machineId,
			subscriptionId: s.subscriptionId,
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

	/** Seeded durable records belong to the initial snapshot, not the first live delta. */
	clearDirty(): void {
		this.dirtyDayModel.clear();
		this.dirtySessions.clear();
		this.dirtyAny = false;
	}

	/** Drain accumulated changes into a delta and reset the dirty sets. */
	drainDelta(now = Date.now(), coverageInput?: CoverageInput): RollupDelta | null {
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
			},
			coverage: coverageInput ? this.buildCoverage(coverageInput) : {}
		};
	}
}

function recordKey(
	day: string,
	provider: string,
	model: string,
	machineId?: string,
	subscriptionId?: string | null
): string {
	return `${machineId ?? ''}${KEY_SEP}${subscriptionId ?? ''}${KEY_SEP}${day}${KEY_SEP}${provider}${KEY_SEP}${model}`;
}

function sessionKey(
	provider: string,
	sessionId: string,
	machineId?: string,
	subscriptionId?: string | null
): string {
	return `${machineId ?? ''}${KEY_SEP}${subscriptionId ?? ''}${KEY_SEP}${provider}${KEY_SEP}${sessionId}`;
}

/** Publish-grain day key: (day, provider, model), independent of machine/subscription. */
function dayKey(day: string, provider: string, model: string): string {
	return `${day}${KEY_SEP}${provider}${KEY_SEP}${model}`;
}

/** Hour-bucket key: (hourTs, provider, model). `hourTs` is parsed back out on export. */
function hourKey(hourTs: number, provider: string, model: string): string {
	return `${hourTs}${KEY_SEP}${provider}${KEY_SEP}${model}`;
}
