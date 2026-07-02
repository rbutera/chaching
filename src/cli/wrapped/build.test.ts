import { describe, it, expect } from 'vitest';
import type {
	CoverageMap,
	DayModelAgg,
	RollupSnapshot,
	SessionSummary,
	TokenCounts
} from '../../lib/types.js';
import { sumGrain } from '../../lib/core/aggregate.js';
import { enumerateDays } from '../../lib/core/view-model.js';
import { buildWrapped } from './build.js';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

function dm(
	day: string,
	provider: string,
	model: string,
	cost: number,
	tokens: TokenCounts,
	requests = 1,
	costUnknownRequests = 0
): DayModelAgg {
	return { day, provider, model, tokens, requests, cost, costUnknownRequests };
}

function session(
	sessionId: string,
	provider: string,
	project: string,
	firstDay: string,
	lastDay: string,
	cost: number,
	requests = 1
): SessionSummary {
	return {
		sessionId,
		provider,
		project,
		firstTs: Date.parse(`${firstDay}T09:00:00Z`),
		lastTs: Date.parse(`${lastDay}T17:00:00Z`),
		tokens: toks(1000),
		requests,
		cost,
		costUnknownRequests: 0,
		models: [provider === 'claude' ? 'claude-opus-4-8' : 'claude-sonnet-4-6']
	};
}

/** Mark every day in [from, to] with one coverage state. */
function coverAll(from: string, to: string, state: CoverageMap[string]): CoverageMap {
	const map: CoverageMap = {};
	for (const day of enumerateDays(from, to)) map[day] = state;
	return map;
}

function snapFrom(
	grain: DayModelAgg[],
	opts: { sessions?: SessionSummary[]; coverage?: CoverageMap } = {}
): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const totals = sumGrain(grain);
	return {
		generatedAt: 0,
		earliestDay: days[0] ?? null,
		latestDay: days[days.length - 1] ?? null,
		totals: {
			tokens: totals.tokens,
			requests: totals.requests,
			cost: totals.cost,
			costUnknownRequests: totals.costUnknownRequests
		},
		dayModel: grain,
		sessions: opts.sessions ?? [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: opts.coverage ?? {}
	};
}

// now = mid-July 2026 (so the current month is 2026-07, month-to-date to the 15th).
const NOW = Date.parse('2026-07-15T12:00:00Z');

// A July grain: opus (biggest), sonnet, plus cache reads on opus.
const julyGrain: DayModelAgg[] = [
	dm('2026-07-03', 'claude', 'claude-opus-4-8', 12.5, toks(1_000_000, 500_000, 0, 2_000_000), 100),
	dm('2026-07-10', 'claude', 'claude-opus-4-8', 8.0, toks(400_000, 200_000, 0, 800_000), 40),
	dm('2026-07-10', 'codex', 'claude-sonnet-4-6', 1.5, toks(500_000, 0, 0, 0), 20)
];

describe('buildWrapped — windowing + headline', () => {
	it('defaults to the current calendar month, month-to-date', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		expect(m.month).toBe('2026-07');
		expect(m.monthToDate).toBe(true);
		expect(m.monthLabel).toBe('July 2026');
		// covered range comes from the grain (real data bounds)
		expect(m.from).toBe('2026-07-03');
		expect(m.to).toBe('2026-07-10');
	});

	it('headline totals equal sumGrain over the month exactly', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		expect(m.headline.cost).toBeCloseTo(sumGrain(julyGrain).cost, 10);
		expect(m.headline.requests).toBe(160);
		expect(m.headline.tokens).toBeGreaterThan(0);
	});

	it('an explicit past --month spans the FULL calendar month (not month-to-date)', () => {
		// Put spend on the last day of June; a past month must include it.
		const grain = [dm('2026-06-30', 'claude', 'claude-opus-4-8', 5, toks(100_000), 10)];
		const snap = snapFrom(grain);
		const m = buildWrapped(snap, { now: NOW, month: '2026-06' });
		expect(m.month).toBe('2026-06');
		expect(m.monthToDate).toBe(false);
		expect(m.headline.cost).toBeCloseTo(5, 10);
	});

	it('a month with no data is empty', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW, month: '2026-01' });
		expect(m.empty).toBe(true);
		expect(m.headline.cost).toBe(0);
		expect(m.topModel).toBeNull();
		expect(m.biggestDay).toBeNull();
	});
});

describe('buildWrapped — top model + project + biggest day', () => {
	it('picks the highest-cost model with its share of spend', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		expect(m.topModel?.model).toBe('claude-opus-4-8');
		expect(m.topModel?.modelLabel).toContain('Opus');
		// opus = 12.5 + 8 = 20.5 of 22 total
		expect(m.topModel?.share).toBeCloseTo(20.5 / 22.0, 6);
	});

	it('picks the highest-cost project from the month sessions (overlap rule)', () => {
		const sessions = [
			session('s1', 'claude', '/home/u/dev/web-app', '2026-07-02', '2026-07-04', 15),
			session('s2', 'codex', '/home/u/dev/side-quest', '2026-07-10', '2026-07-10', 5)
		];
		const snap = snapFrom(julyGrain, { sessions });
		const m = buildWrapped(snap, { now: NOW });
		expect(m.topProject?.display).toBe('web-app');
		expect(m.topProject?.cost).toBeCloseTo(15, 10);
		expect(m.topProject?.sessionCount).toBe(1);
		expect(m.topProject?.isUnknown).toBe(false);
	});

	it('finds the single most expensive day', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		// 2026-07-03 = 12.5; 2026-07-10 = 8 + 1.5 = 9.5 → biggest is the 3rd
		expect(m.biggestDay?.day).toBe('2026-07-03');
		expect(m.biggestDay?.cost).toBeCloseTo(12.5, 10);
	});

	it('carries cache savings for the month (savedVsUncached present)', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		expect(m.cache.cacheReadTokens).toBe(2_800_000);
		expect(m.cache.savedVsUncached).toBeGreaterThan(0);
	});
});

describe('buildWrapped — month-over-month delta gating (honesty rule)', () => {
	// June is the prior month for a July recap.
	const junePriorGrain = [dm('2026-06-15', 'claude', 'claude-opus-4-8', 10, toks(500_000), 50)];

	it('renders the delta when the prior month is a full frozen baseline', () => {
		const grain = [...julyGrain, ...junePriorGrain];
		const coverage = {
			...coverAll('2026-06-01', '2026-06-30', 'frozen'),
			...coverAll('2026-07-01', '2026-07-15', 'partial')
		};
		const snap = snapFrom(grain, { coverage });
		const m = buildWrapped(snap, { now: NOW });
		expect(m.momDelta).not.toBeNull();
		expect(m.momDelta?.priorMonth).toBe('2026-06');
		expect(m.momDelta?.priorCost).toBeCloseTo(10, 10);
		// July = 22, June = 10 → +120%
		expect(m.momDelta?.deltaPct).toBeCloseTo((22 - 10) / 10, 6);
	});

	it('SUPPRESSES the delta when a prior-month day is missing (not fully covered)', () => {
		const grain = [...julyGrain, ...junePriorGrain];
		// cover all of June EXCEPT one day → that day is `missing` → not authoritative.
		const coverage = coverAll('2026-06-01', '2026-06-30', 'frozen');
		delete coverage['2026-06-20'];
		const snap = snapFrom(grain, { coverage });
		const m = buildWrapped(snap, { now: NOW });
		expect(m.momDelta).toBeNull();
	});

	it('SUPPRESSES the delta when the prior month had zero spend', () => {
		// July data only, June fully frozen but with no spend rows → prior cost 0.
		const coverage = coverAll('2026-06-01', '2026-06-30', 'zero');
		const snap = snapFrom(julyGrain, { coverage });
		const m = buildWrapped(snap, { now: NOW });
		expect(m.momDelta).toBeNull();
	});

	it('SUPPRESSES the delta when there is no coverage for the prior month at all', () => {
		const grain = [...julyGrain, ...junePriorGrain];
		const snap = snapFrom(grain, { coverage: {} });
		const m = buildWrapped(snap, { now: NOW });
		expect(m.momDelta).toBeNull();
	});
});

describe('buildWrapped — subscription subsidy', () => {
	const sub = {
		claude: { enabled: true, tier: 'max', monthlyUsd: 100 },
		codex: { enabled: false, tier: 'free', monthlyUsd: 0 }
	};

	it('includes the subsidy block when a subsidised provider is enabled', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW, subscription: sub });
		expect(m.subsidy).not.toBeNull();
		expect(m.subsidy?.monthlyUsd).toBe(100);
		// claude July burn = 20.5 → multiple = 20.5/100
		expect(m.subsidy?.apiEquivalentUsd).toBeCloseTo(20.5, 6);
		expect(m.subsidy?.multiple).toBeCloseTo(20.5 / 100, 6);
	});

	it('omits the subsidy block when no subscription is supplied', () => {
		const snap = snapFrom(julyGrain);
		const m = buildWrapped(snap, { now: NOW });
		expect(m.subsidy).toBeNull();
	});
});

describe('buildWrapped — determinism', () => {
	it('same snapshot + month → identical barcode + ref (not time-of-render)', () => {
		const snap = snapFrom(julyGrain);
		const a = buildWrapped(snap, { now: NOW });
		const b = buildWrapped(snap, { now: NOW + 3_600_000 });
		expect(a.barcode).toBe(b.barcode);
		expect(a.ref).toBe(b.ref);
	});
});
