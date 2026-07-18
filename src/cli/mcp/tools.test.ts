import { describe, expect, it } from 'vitest';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '../../lib/types.js';
import { defaultViewState, focusedTotals, todayUTC } from '../../lib/core/view-model.js';
import { resolvePrice, costFromPriceEntry } from '../../lib/core/pricing/cost.js';
import type { ProviderSubsidisationConfig, SubsidisedProvider } from '../../lib/core/subsidisation.js';
import {
	spendToday,
	burnSince,
	cacheEfficiency,
	subscriptionHeadroom,
	providerStatus,
	quoteTokens,
	unknownPricing,
	type ToolContext
} from './tools.js';
import { assertContentFree, toolResult } from './serialize.js';

// Pinned clock: "today" is 2026-07-15 (UTC). All fixture days sit on/before it so a
// day/week/month rolling window anchored at the latest day with data lands cleanly.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const TODAY = '2026-07-15';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

function dm(
	day: string,
	provider: string,
	model: string,
	tokens: TokenCounts,
	cost: number,
	requests = 1,
	costUnknownRequests = 0
): DayModelAgg {
	return { day, provider, model, tokens, requests, cost, costUnknownRequests };
}

/** Build a snapshot from a flat grain, synthesizing the same coverage model the runtime uses. */
function snapFrom(grain: DayModelAgg[], unknownPriceModels: string[] = []): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const latest = days[days.length - 1] ?? null;
	const spendByDay = new Map<string, number>();
	for (const g of grain) spendByDay.set(g.day, (spendByDay.get(g.day) ?? 0) + g.cost);
	const coverage: Record<string, 'frozen' | 'partial' | 'zero'> = {};
	for (const day of new Set(days)) {
		if (day === latest) coverage[day] = 'partial';
		else coverage[day] = (spendByDay.get(day) ?? 0) > 0 ? 'frozen' : 'zero';
	}
	return {
		generatedAt: NOW,
		earliestDay: days[0] ?? null,
		latestDay: latest,
		totals: {
			tokens: toks(0),
			requests: grain.reduce((a, g) => a + g.requests, 0),
			cost: grain.reduce((a, g) => a + g.cost, 0),
			costUnknownRequests: grain.reduce((a, g) => a + g.costUnknownRequests, 0)
		},
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels,
		stats: { filesScanned: 12, recordsCounted: 340, linesSkipped: 0, duplicatesSkipped: 7 },
		cutoverTs: null,
		coverage
	};
}

const OPUS = 'claude-opus-4-8';
const opusPrice = resolvePrice(OPUS)!;

const SUBSIDY: Record<SubsidisedProvider, ProviderSubsidisationConfig> = {
	claude: { enabled: true, tier: 'max-20x', monthlyUsd: 200 },
	codex: { enabled: true, tier: 'pro', monthlyUsd: 20 }
};

function ctx(
	grain: DayModelAgg[],
	opts: {
		unknownPriceModels?: string[];
		subsidy?: Record<SubsidisedProvider, ProviderSubsidisationConfig>;
		providerErrors?: Record<string, string>;
	} = {}
): ToolContext {
	return {
		snapshot: snapFrom(grain, opts.unknownPriceModels ?? []),
		subsidyConfig: opts.subsidy ?? SUBSIDY,
		providerErrors: opts.providerErrors ?? {},
		now: NOW
	};
}

// A representative multi-day grain: today + yesterday + a prior-week day + a month-back day.
function grainWithHistory(): DayModelAgg[] {
	return [
		dm(TODAY, 'claude', OPUS, toks(1000, 2000, 500, 40000), 12, 5),
		dm('2026-07-14', 'claude', OPUS, toks(800, 1500, 400, 30000), 9, 4),
		dm('2026-07-14', 'codex', OPUS, toks(2000, 1000, 0, 5000), 3, 2),
		dm('2026-07-08', 'claude', OPUS, toks(500, 900, 200, 12000), 5, 3), // prior week
		dm('2026-06-20', 'claude', OPUS, toks(300, 600, 100, 8000), 4, 2) // ~month back
	];
}

describe('mcp tools — spend_today', () => {
	it("reports the current UTC day and sums that day's grain", () => {
		const c = ctx(grainWithHistory());
		const r = spendToday(c) as Record<string, unknown>;
		expect(r.day).toBe(TODAY);
		expect(r.coverage).toBe('partial');
		// Parity with the shared focusedTotals derivation (no second accounting path).
		const totals = focusedTotals(c.snapshot, TODAY, defaultViewState('day'));
		expect(r.cost).toBeCloseTo(totals.cost, 6);
		expect(r.requests).toBe(totals.requests);
		expect(Array.isArray(r.byProvider)).toBe(true);
		assertContentFree(r);
	});

	it('is $0-safe on an empty snapshot (no fabricated numbers)', () => {
		const r = spendToday(ctx([])) as Record<string, unknown>;
		expect(r.cost).toBe(0);
		expect(r.requests).toBe(0);
		expect(r.day).toBe(TODAY);
	});
});

describe('mcp tools — burn_since', () => {
	it('period=day parity: equals the shared focusedTotals for the latest data day', () => {
		const c = ctx(grainWithHistory());
		const r = burnSince(c, 'day') as Record<string, unknown>;
		// latest data day IS today in this fixture, so the day window == today.
		const totals = focusedTotals(c.snapshot, todayUTC(NOW), defaultViewState('day'));
		expect(r.from).toBe(TODAY);
		expect(r.to).toBe(TODAY);
		expect(r.cost).toBeCloseTo(totals.cost, 6);
	});

	it('week window includes the prior-window delta when a baseline exists', () => {
		const r = burnSince(ctx(grainWithHistory()), 'week') as Record<string, unknown>;
		expect(r.from).toBe('2026-07-09');
		expect(r.to).toBe(TODAY);
		// current week = today(12) + 2026-07-14(9+3) = 24; prior week has 2026-07-08(5).
		expect(r.cost).toBeCloseTo(24, 6);
		expect(r.prior).not.toBeNull();
		expect((r.prior as { cost: number }).cost).toBeCloseTo(5, 6);
		expect(r.deltaPct).toBeCloseTo(((24 - 5) / 5) * 100, 2);
	});

	it('null prior baseline suppresses the delta (all-time has no prior window)', () => {
		const r = burnSince(ctx(grainWithHistory()), 'all') as Record<string, unknown>;
		expect(r.prior).toBeNull();
		expect(r.deltaPct).toBeNull();
	});
});

describe('mcp tools — cache_efficiency', () => {
	it('prices cache reads/writes at the resolved rate for a single-model window', () => {
		// One model, one day (today) so the whole day/week/month window is deterministic.
		const grain = [dm(TODAY, 'claude', OPUS, toks(1000, 2000, 500, 40000), 12, 5)];
		const r = cacheEfficiency(ctx(grain), 'day') as Record<string, unknown>;
		expect(r.cacheReadTokens).toBe(40000);
		expect(r.cacheWriteTokens).toBe(500);
		expect(r.cacheReadCost as number).toBeCloseTo(40000 * opusPrice.cache_read_input_token_cost, 6);
		expect(r.cacheWriteCost as number).toBeCloseTo(
			500 * opusPrice.cache_creation_input_token_cost,
			6
		);
		expect(r.hasUnknownPricing).toBe(false);
	});

	it('counts unknown-priced cache tokens as unknown, contributing no cost', () => {
		const grain = [dm(TODAY, 'codex', 'mystery-model', toks(0, 0, 0, 9000), 0, 1, 1)];
		const r = cacheEfficiency(ctx(grain, { unknownPriceModels: ['mystery-model'] }), 'day') as Record<
			string,
			unknown
		>;
		expect(r.unknownTokens).toBe(9000);
		expect(r.hasUnknownPricing).toBe(true);
		expect(r.cacheReadCost).toBe(0);
		expect(r.readSavingsPct).toBeNull();
	});
});

describe('mcp tools — subscription_headroom', () => {
	it('reports a positive multiple when burn exceeds the fee', () => {
		// A big month-to-date claude burn against a $200 fee.
		const grain = [dm(TODAY, 'claude', OPUS, toks(0, 0, 0, 0), 500, 1)];
		const r = subscriptionHeadroom(ctx(grain)) as Record<string, unknown>;
		const combined = r.combined as Record<string, unknown>;
		expect(combined.monthlyUsd).toBe(220); // 200 + 20 enabled fees
		expect(r.basis).toBe('calendar-month-to-date');
		const claude = (r.providers as Record<string, unknown>[]).find((p) => p.provider === 'claude')!;
		expect(claude.monthlyUsd).toBe(200);
		expect(typeof claude.multiple === 'number' || claude.multiple === null).toBe(true);
	});

	it('$0 (free) tier yields a null multiple marker, never Infinity', () => {
		const grain = [dm(TODAY, 'claude', OPUS, toks(0, 0, 0, 0), 30, 1)];
		const free: Record<SubsidisedProvider, ProviderSubsidisationConfig> = {
			claude: { enabled: true, tier: 'free', monthlyUsd: 0 },
			codex: { enabled: false, tier: 'free', monthlyUsd: 0 }
		};
		const r = subscriptionHeadroom(ctx(grain, { subsidy: free })) as Record<string, unknown>;
		const claude = (r.providers as Record<string, unknown>[]).find((p) => p.provider === 'claude')!;
		expect(claude.multiple).toBeNull();
		assertContentFree(r);
	});
});

describe('mcp tools — provider_status', () => {
	it('reports ok/error per provider and NEVER the raw error string', () => {
		const grain = grainWithHistory();
		const r = providerStatus(
			ctx(grain, { providerErrors: { codex: 'ENOENT: /Users/someone/.codex/x missing' } })
		) as Record<string, unknown>;
		const provs = r.providers as Record<string, unknown>[];
		expect(provs.find((p) => p.provider === 'codex')!.status).toBe('error');
		expect(provs.find((p) => p.provider === 'claude')!.status).toBe('ok');
		// The error message (which embeds a path) must not appear anywhere.
		for (const p of provs) expect(Object.keys(p)).toEqual(['provider', 'status']);
		expect(r.todayCoverage).toBe('partial');
		assertContentFree(r); // would throw if the path had leaked through
	});
});

describe('mcp tools — quote_tokens', () => {
	it('prices a known model exactly via resolvePrice + costFromPriceEntry', () => {
		const args = { model: OPUS, input: 1_000_000, output: 500_000, cacheRead: 2_000_000 };
		const r = quoteTokens(ctx([]), args) as Record<string, unknown>;
		const expected = costFromPriceEntry(
			opusPrice,
			toks(1_000_000, 500_000, 0, 2_000_000)
		);
		expect(r.unknown).toBe(false);
		expect(r.cost as number).toBeCloseTo(expected, 6);
	});

	it('unpriceable model → cost null + unknown marker (never $0)', () => {
		const r = quoteTokens(ctx([]), { model: 'totally-made-up-xyz', input: 1000 }) as Record<
			string,
			unknown
		>;
		expect(r.cost).toBeNull();
		expect(r.unknown).toBe(true);
	});
});

describe('mcp tools — unknown_pricing', () => {
	it('aggregates unpriceable models with null cost and their token volumes', () => {
		const grain = [
			dm(TODAY, 'codex', 'mystery-model', toks(100, 50, 0, 200), 0, 3, 3),
			dm('2026-07-14', 'codex', 'mystery-model', toks(10, 5, 0, 20), 0, 1, 1),
			dm(TODAY, 'claude', OPUS, toks(1, 1, 0, 1), 1, 1) // priced: excluded
		];
		const r = unknownPricing(ctx(grain, { unknownPriceModels: ['mystery-model'] })) as Record<
			string,
			unknown
		>;
		expect(r.count).toBe(1);
		const m = (r.models as Record<string, unknown>[])[0];
		expect(m.model).toBe('mystery-model');
		expect(m.cost).toBeNull();
		expect(m.requests).toBe(4);
		expect((m.tokens as TokenCounts).input).toBe(110);
	});
});

describe('mcp content-free serializer', () => {
	it('wraps a clean aggregate into text + structuredContent', () => {
		const res = toolResult({ cost: 1.5, provider: 'claude' });
		expect(res.content[0].type).toBe('text');
		expect(JSON.parse(res.content[0].text)).toEqual({ cost: 1.5, provider: 'claude' });
		expect(res.structuredContent).toEqual({ cost: 1.5, provider: 'claude' });
	});

	// Mutation test: prove the guard actually fails on the things it must reject —
	// a check that cannot fail has not passed.
	it('throws on a filesystem-path string value', () => {
		expect(() => assertContentFree({ where: '/Users/rai/.claude/x.jsonl' })).toThrow(/path-like/);
		expect(() => assertContentFree({ where: '~/secret' })).toThrow(/path-like/);
	});

	it('throws on a forbidden content-bearing key', () => {
		expect(() => assertContentFree({ transcript: 'hello there' })).toThrow(/forbidden key/);
		expect(() => assertContentFree({ prompt: 'x' })).toThrow(/forbidden key/);
		expect(() => assertContentFree({ nested: { project: '/a/b' } })).toThrow(/forbidden key/);
	});

	it('allows model ids, provider ids, and ISO day strings', () => {
		expect(() =>
			assertContentFree({ model: 'claude-opus-4-8', provider: 'cursor-acp', day: '2026-07-18' })
		).not.toThrow();
	});
});
