// MCP tool handlers — the read-only spend/cache/headroom/pricing surface (tasks
// 1.2, 1.3). Every handler is a PURE function over a `ToolContext` snapshot facade
// and delegates to the SAME view-model / subsidisation / pricing derivations the
// dashboard and receipt use: this is the "one engine, three consumers" third
// consumer, with NO second accounting path. Nothing here reads disk or holds
// engine state, so each handler is unit-testable against a fixture snapshot.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Period, RollupSnapshot, TokenCounts } from '../../lib/types.js';
import {
	defaultViewState,
	periodWindow,
	heroTotals,
	focusedTotals,
	scopedGrain,
	todayUTC
} from '../../lib/core/view-model.js';
import {
	aggregateByProvider,
	filterDays,
	dayCoverageState,
	type ProviderTotal
} from '../../lib/core/aggregate.js';
import {
	buildSubsidisation,
	type ProviderSubsidisationConfig,
	type SubsidisedProvider
} from '../../lib/core/subsidisation.js';
import { cacheCostBreakdown } from '../../lib/core/pricing/cache-breakdown.js';
import { resolvePrice, costFromPriceEntry } from '../../lib/core/pricing/cost.js';
import { resolveModelsDevPrice } from '../../lib/core/pricing/modelsdev.js';
import { toolResult } from './serialize.js';

/**
 * The snapshot facade a tool handler reads. The live-engine server (server.ts)
 * rebuilds this per call from the latest `engine.snapshot()`; unit tests pass a
 * fixture. `subsidyConfig` is the per-provider subscription slice (mirrors the
 * receipt/wrapped assembly); `providerErrors` is the engine's ingest-health map;
 * `now` is the clock seam so tests can pin "today".
 */
export interface ToolContext {
	snapshot: RollupSnapshot;
	subsidyConfig: Record<SubsidisedProvider, ProviderSubsidisationConfig>;
	providerErrors: Record<string, string>;
	now: number;
}

const PERIODS = ['day', 'week', 'month', 'quarter', 'all'] as const;

/** Round a dollar/rate figure to kill float noise; non-finite → 0 (cost honesty). */
function money(x: number): number {
	return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0;
}

/** Round a percentage/multiple to 2dp; non-finite → 0. */
function round2(x: number): number {
	return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

/** A multiple/ratio that is `null` (free tier / no baseline) stays null; else 2dp. */
function nullableMultiple(x: number | null): number | null {
	return x == null ? null : round2(x);
}

/** Per-provider aggregate slice, content-free (provider id + figures only). */
function providerSlices(grain: ProviderTotal[]): Record<string, unknown>[] {
	return grain.map((p) => ({
		provider: p.provider,
		cost: money(p.cost),
		requests: p.requests,
		tokens: p.tokens
	}));
}

function tokensOf(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): TokenCounts {
	return { input, output, cacheCreation: cacheWrite, cacheRead };
}

// ── Handlers (pure) ─────────────────────────────────────────────────────────────

/** Today's spend so far (current UTC day), with its live coverage state. */
export function spendToday(ctx: ToolContext): Record<string, unknown> {
	const day = todayUTC(ctx.now);
	const state = defaultViewState('day');
	const totals = focusedTotals(ctx.snapshot, day, state);
	const grain = filterDays(ctx.snapshot.dayModel, day, day);
	return {
		advisory: true,
		day,
		coverage: totals.coverage.worst,
		cost: money(totals.cost),
		requests: totals.requests,
		costUnknownRequests: totals.costUnknownRequests,
		tokens: totals.tokens,
		byProvider: providerSlices(aggregateByProvider(grain))
	};
}

/** Period-scoped burn (rolling window anchored at the latest day with data). */
export function burnSince(ctx: ToolContext, period: Period): Record<string, unknown> {
	const state = defaultViewState(period);
	const w = periodWindow(ctx.snapshot, state);
	const { current, prior, label, priorHasBaseline } = heroTotals(ctx.snapshot, state);
	const grain = filterDays(ctx.snapshot.dayModel, w.from, w.to);
	const deltaPct =
		priorHasBaseline && prior.cost > 0
			? round2(((current.cost - prior.cost) / prior.cost) * 100)
			: null;
	return {
		advisory: true,
		period,
		label,
		from: w.from,
		to: w.to,
		coverage: current.coverage.worst,
		cost: money(current.cost),
		requests: current.requests,
		costUnknownRequests: current.costUnknownRequests,
		tokens: current.tokens,
		prior: priorHasBaseline
			? { from: w.priorFrom, to: w.priorTo, cost: money(prior.cost) }
			: null,
		deltaPct,
		byProvider: providerSlices(aggregateByProvider(grain))
	};
}

/** Cache economics over the period window: billed read/write + saved-vs-uncached. */
export function cacheEfficiency(ctx: ToolContext, period: Period): Record<string, unknown> {
	const state = defaultViewState(period);
	const w = periodWindow(ctx.snapshot, state);
	const bd = cacheCostBreakdown(scopedGrain(ctx.snapshot, state)).combined;
	// What the cache reads WOULD have cost at the full input rate = actual read cost
	// + the modelled saving. The fraction of that avoided is the read-side efficiency.
	const uncachedReadCost = bd.cacheReadCost + bd.savedVsUncached;
	const readSavingsPct = uncachedReadCost > 0 ? round2((bd.savedVsUncached / uncachedReadCost) * 100) : null;
	return {
		advisory: true,
		period,
		from: w.from,
		to: w.to,
		cacheReadTokens: bd.cacheReadTokens,
		cacheReadCost: money(bd.cacheReadCost),
		cacheWriteTokens: bd.cacheWriteTokens,
		cacheWriteCost: money(bd.cacheWriteCost),
		savedVsUncached: money(bd.savedVsUncached),
		readSavingsPct,
		unknownTokens: bd.unknownTokens,
		hasUnknownPricing: bd.unknownTokens > 0
	};
}

/** Subscription subsidy: how much API value the flat monthly fee bought, month-to-date. */
export function subscriptionHeadroom(ctx: ToolContext): Record<string, unknown> {
	const roll = buildSubsidisation(ctx.snapshot.dayModel, ctx.subsidyConfig, new Date(ctx.now));
	const shape = (
		monthlyUsd: number,
		mtd: { apiEquivalentUsd: number; netSubsidyUsd: number; multiple: number | null },
		projected: { apiEquivalentUsd: number; multiple: number | null }
	) => ({
		monthlyUsd,
		apiEquivalentUsd: money(mtd.apiEquivalentUsd),
		netSubsidyUsd: money(mtd.netSubsidyUsd),
		// null multiple = free ($0) tier: "∞ — all of it". Marker crosses the wire intact.
		multiple: nullableMultiple(mtd.multiple),
		headroomUsd: money(Math.max(0, monthlyUsd - mtd.apiEquivalentUsd)),
		projectedApiEquivalentUsd: money(projected.apiEquivalentUsd),
		projectedMultiple: nullableMultiple(projected.multiple)
	});
	return {
		advisory: true,
		// NOTE: calendar-MTD is the documented subsidy-reconciliation frame (monthly fee);
		// it intentionally differs from the dashboard subsidy card's rolling window.
		basis: 'calendar-month-to-date',
		month: roll.monthLabel,
		elapsedDays: roll.elapsedDays,
		daysInMonth: roll.daysInMonth,
		combined: shape(roll.combined.monthlyUsd, roll.combined.mtd, roll.combined.projected),
		providers: roll.providers.map((p) => ({
			provider: p.provider,
			enabled: p.enabled,
			tier: p.tier,
			...shape(p.monthlyUsd, p.mtd, p.projected)
		}))
	};
}

/** Provider ingest health + coverage. Error MESSAGES are never surfaced (may carry paths). */
export function providerStatus(ctx: ToolContext): Record<string, unknown> {
	const snap = ctx.snapshot;
	const day = todayUTC(ctx.now);
	const names = new Set<string>([...snap.providers, ...Object.keys(ctx.providerErrors)]);
	const providers = [...names]
		.sort()
		.map((provider) => ({
			provider,
			// Status only — the raw error string can embed a filesystem path, so it is
			// deliberately not exposed (the content-free contract; the guard would reject it).
			status: ctx.providerErrors[provider] ? 'error' : 'ok'
		}));
	return {
		advisory: true,
		generatedAt: snap.generatedAt,
		earliestDay: snap.earliestDay,
		latestDay: snap.latestDay,
		todayCoverage: dayCoverageState(day, snap.coverage),
		providers,
		unknownPriceModels: snap.unknownPriceModels,
		scan: {
			filesScanned: snap.stats.filesScanned,
			recordsCounted: snap.stats.recordsCounted,
			duplicatesSkipped: snap.stats.duplicatesSkipped
		}
	};
}

export interface QuoteArgs {
	model: string;
	provider?: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/** Price a hypothetical token mix for a model. Unpriceable → cost null + unknown marker. */
export function quoteTokens(_ctx: ToolContext, args: QuoteArgs): Record<string, unknown> {
	const tokens = tokensOf(args.input, args.output, args.cacheRead, args.cacheWrite);
	const provider = args.provider?.trim() || null;
	// Route non-Claude/Codex providers through the models.dev resolver (OpenCode/Zen/
	// Cursor-ACP economics); default to the LiteLLM/overrides resolver by model id.
	const price =
		provider && provider !== 'claude' && provider !== 'codex'
			? resolveModelsDevPrice(provider, args.model)
			: resolvePrice(args.model);
	if (!price) {
		return { advisory: true, model: args.model, provider, tokens, cost: null, unknown: true };
	}
	return {
		advisory: true,
		model: args.model,
		provider,
		tokens,
		cost: money(costFromPriceEntry(price, tokens)),
		unknown: false
	};
}

/** Models seen with no known price + their token volumes (cost null, cost-honesty). */
export function unknownPricing(ctx: ToolContext): Record<string, unknown> {
	const unknown = new Set(ctx.snapshot.unknownPriceModels);
	const acc = new Map<
		string,
		{ providers: Set<string>; requests: number; tokens: TokenCounts }
	>();
	for (const dm of ctx.snapshot.dayModel) {
		if (!unknown.has(dm.model)) continue;
		let a = acc.get(dm.model);
		if (!a) {
			a = { providers: new Set(), requests: 0, tokens: tokensOf() };
			acc.set(dm.model, a);
		}
		a.providers.add(dm.provider);
		a.requests += dm.requests;
		a.tokens.input += dm.tokens.input;
		a.tokens.output += dm.tokens.output;
		a.tokens.cacheCreation += dm.tokens.cacheCreation;
		a.tokens.cacheRead += dm.tokens.cacheRead;
	}
	const models = [...acc.entries()]
		.map(([model, a]) => ({
			model,
			providers: [...a.providers].sort(),
			requests: a.requests,
			tokens: a.tokens,
			cost: null,
			unknown: true
		}))
		.sort((x, y) => y.requests - x.requests || (x.model < y.model ? -1 : 1));
	return { advisory: true, count: models.length, models };
}

// ── SDK registration ────────────────────────────────────────────────────────────

const ADVISORY = 'Read-only and advisory: reports observed spend, it does not enforce any budget.';
const periodShape = { period: z.enum(PERIODS).optional() };

/**
 * Register every tool on the McpServer. `getContext` is called fresh inside each
 * handler so every tool call reads the latest engine snapshot. Each tool wraps its
 * pure result through `toolResult`, the single content-free serializer.
 */
export function registerTools(server: McpServer, getContext: () => ToolContext): void {
	server.registerTool(
		'spend_today',
		{
			title: 'Spend today',
			description: `Total spend for the current UTC day so far, per provider, with its coverage state. ${ADVISORY}`
		},
		async () => toolResult(spendToday(getContext()))
	);

	server.registerTool(
		'burn_since',
		{
			title: 'Burn over a period',
			description: `Spend over a rolling period (day/week/month/quarter/all, default week) anchored at the latest day with data, with the prior-window delta. ${ADVISORY}`,
			inputSchema: periodShape
		},
		async ({ period }) => toolResult(burnSince(getContext(), period ?? 'week'))
	);

	server.registerTool(
		'cache_efficiency',
		{
			title: 'Cache efficiency',
			description: `Billed cache read/write tokens and cost, plus modelled saving vs uncached, over the period window (default week). ${ADVISORY}`,
			inputSchema: periodShape
		},
		async ({ period }) => toolResult(cacheEfficiency(getContext(), period ?? 'week'))
	);

	server.registerTool(
		'subscription_headroom',
		{
			title: 'Subscription headroom',
			description: `How much API-equivalent value your flat monthly subscription fee has bought this calendar month to date, per subsidised provider (Claude, Codex), with a projected full-month figure. ${ADVISORY}`
		},
		async () => toolResult(subscriptionHeadroom(getContext()))
	);

	server.registerTool(
		'provider_status',
		{
			title: 'Provider status',
			description: `Per-provider ingest health (ok/error), today's data coverage, and models seen with no known price. ${ADVISORY}`
		},
		async () => toolResult(providerStatus(getContext()))
	);

	server.registerTool(
		'quote_tokens',
		{
			title: 'Quote token cost',
			description: `Price a hypothetical token mix (input/output/cacheRead/cacheWrite) for a model id via the same resolvers chaching uses. Unpriceable model → cost null with an unknown marker (never a fabricated $0). ${ADVISORY}`,
			inputSchema: {
				model: z.string().min(1),
				provider: z.string().optional(),
				input: z.number().int().nonnegative().optional(),
				output: z.number().int().nonnegative().optional(),
				cacheRead: z.number().int().nonnegative().optional(),
				cacheWrite: z.number().int().nonnegative().optional()
			}
		},
		async (args) => toolResult(quoteTokens(getContext(), args))
	);

	server.registerTool(
		'unknown_pricing',
		{
			title: 'Unknown pricing',
			description: `Models observed in your usage that have no known price, with their token volumes (cost reported as null, never $0). ${ADVISORY}`
		},
		async () => toolResult(unknownPricing(getContext()))
	);
}
