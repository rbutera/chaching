// In-memory rollup state. Holds per-(day, provider, model) aggregates + a session index +
// derived totals/blocks. Records are added once (after dedup); the rollup answers
// snapshot/delta queries. Week/month + month-to-day-to-session re-aggregation are
// pure operations the CLIENT does over `dayModel` — the server just ships the
// finest persistent grain (per-day-per-provider-per-model) plus the session index.

import type {
	BlockSummary,
	DayModelAgg,
	RollupDelta,
	RollupSnapshot,
	SessionSummary,
	TokenCounts,
	UsageRecord
} from '$lib/types';
import { getPricingMeta, hasPrice } from '$lib/server/pricing/cost';
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

export class Rollup {
	/** key: `${day}\u001f${provider}\u001f${model}` */
	private dayModel = new Map<string, DayModelAgg>();
	private sessions = new Map<string, SessionState>();
	private modelCost = new Map<string, number>();
	private providerCost = new Map<string, number>();
	private unknownPriceModels = new Set<string>();

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

	/** Add a single already-deduped usage record to the rollup. */
	add(rec: UsageRecord): void {
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

	snapshot(now = Date.now()): RollupSnapshot {
		const meta = getPricingMeta();
		void meta; // meta exposed via separate endpoint; kept here for future inline use
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
			cutoverTs: this.cutoverTs
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
