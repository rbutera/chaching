// Counterfactual scenario math (tasks 1.2–1.5). CLIENT-SAFE: no Node imports.
// The single per-token cost formula (`costFromPriceEntry`) and the two price
// resolvers are INJECTED (see resolve.ts for the server wiring), so this module
// never re-implements pricing and never drags cost.ts's node:url IO into the
// browser bundle — the same discipline as cache-breakdown-core.ts.
//
// Cost-honesty hard rule (CLAUDE.md): when a source OR target price is unknown
// (`null`), the slice is excluded from BOTH the actual and the counterfactual
// totals and reported — never silently zeroed, never excluded from one side only
// (which would fabricate a delta).

import { FEE_PRORATA_DAYS } from '../subsidisation';
import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '../subscription-presets';
import {
	PRICE_ONLY_COUNTERFACTUAL,
	type CostFn,
	type PriceResolver,
	type ScenarioExclusion,
	type ScenarioResult,
	type UsageSlice,
	type WhatifInput
} from './types';

/**
 * Vendored plan-price snapshot date. The plan table itself is SUBSCRIPTION_PRESETS
 * (client-safe, already carrying monthlyUsd); this records WHEN those fees were
 * last verified, the same snapshot discipline the price maps use. Refresh both
 * together when a provider changes a tier price.
 */
export const PLAN_PRICES_SNAPSHOT = '2026-06';

function buildExclusion(excluded: UsageSlice[]): ScenarioExclusion {
	return {
		modelCount: excluded.length,
		models: excluded.map((s) => `${s.provider}/${s.model}`),
		spendUsd: excluded.reduce((n, s) => n + s.actualCost, 0)
	};
}

/** Inclusive day count of [from, to] (UTC), matching subsidisation's window basis. */
function inclusiveDays(from: string, to: string): number {
	if (to < from) return 0;
	const a = new Date(from + 'T00:00:00Z').getTime();
	const b = new Date(to + 'T00:00:00Z').getTime();
	return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Alternate-model scenario (task 1.2): reprice every included slice at the TARGET
 * model's resolved price via the injected cost formula. Target-catalog cache
 * economics: if the target has no cache-write price (e.g. an OpenAI catalog entry
 * — `cache_creation_input_token_cost === 0`), the cache-write tokens are folded
 * into input and billed at the target's input rate, with a substitution note.
 * Slices whose source OR target price is null are excluded from both sides.
 */
export function altModelScenario(
	input: WhatifInput,
	targetModel: string,
	resolver: PriceResolver,
	cost: CostFn
): ScenarioResult {
	const target = resolver.target(targetModel);
	const included: UsageSlice[] = [];
	const excluded: UsageSlice[] = [];
	let actualUsd = 0;
	let totalUsd = 0;
	let substitutedTokens = 0;

	for (const slice of input.slices) {
		const src = resolver.source(slice.provider, slice.model);
		if (!src || !target) {
			excluded.push(slice);
			continue;
		}
		included.push(slice);
		actualUsd += cost(src, slice.tokens);

		if (target.cache_creation_input_token_cost === 0 && slice.tokens.cacheCreation > 0) {
			// Target catalog has no cache-write price → those tokens are ordinary input.
			const folded = {
				...slice.tokens,
				input: slice.tokens.input + slice.tokens.cacheCreation,
				cacheCreation: 0
			};
			totalUsd += cost(target, folded);
			substitutedTokens += slice.tokens.cacheCreation;
		} else {
			// (Cache-READ follows the target's resolved cache-read rate, per spec 1.2.)
			totalUsd += cost(target, slice.tokens);
		}
	}

	const notes = [PRICE_ONLY_COUNTERFACTUAL];
	if (substitutedTokens > 0) {
		notes.push(
			`Target ${targetModel} has no cache-write price; ${substitutedTokens.toLocaleString('en-US')} cache-write tokens billed at its input rate.`
		);
	}
	if (excluded.length > 0) {
		notes.push(
			`$${buildExclusion(excluded).spendUsd.toFixed(2)} of usage across ${excluded.length} model(s) could not be repriced and was excluded from both sides.`
		);
	}

	return {
		id: `alt-model:${targetModel}`,
		kind: 'alt-model',
		label: `Everything at ${targetModel} prices`,
		basis: `observed tokens repriced at ${targetModel}`,
		totalUsd,
		actualUsd,
		deltaUsd: totalUsd - actualUsd,
		exclusions: buildExclusion(excluded),
		notes
	};
}

/**
 * No-cache scenario (task 1.3): rebill every slice's cache reads AND writes at
 * that slice's OWN base input rate — the honest upper bound of what caching
 * saved. `delta = total − actual` is therefore the cache saving (positive).
 * Slices with an unknown source price are excluded from both sides.
 */
export function noCacheScenario(
	input: WhatifInput,
	resolver: PriceResolver,
	cost: CostFn
): ScenarioResult {
	const included: UsageSlice[] = [];
	const excluded: UsageSlice[] = [];
	let actualUsd = 0;
	let totalUsd = 0;

	for (const slice of input.slices) {
		const src = resolver.source(slice.provider, slice.model);
		if (!src) {
			excluded.push(slice);
			continue;
		}
		included.push(slice);
		actualUsd += cost(src, slice.tokens);
		const noCache = {
			input: slice.tokens.input + slice.tokens.cacheRead + slice.tokens.cacheCreation,
			output: slice.tokens.output,
			cacheRead: 0,
			cacheCreation: 0
		};
		totalUsd += cost(src, noCache);
	}

	const notes = [
		PRICE_ONLY_COUNTERFACTUAL,
		"Upper bound: every cached token rebilled at each model's base input rate — the most caching could have saved."
	];
	if (excluded.length > 0) {
		notes.push(
			`$${buildExclusion(excluded).spendUsd.toFixed(2)} of usage across ${excluded.length} model(s) had no known price and was excluded from both sides.`
		);
	}

	return {
		id: 'no-cache',
		kind: 'no-cache',
		label: 'If nothing had been cached',
		basis: 'cache reads + writes rebilled at base input rate',
		totalUsd,
		actualUsd,
		deltaUsd: totalUsd - actualUsd,
		exclusions: buildExclusion(excluded),
		notes
	};
}

/**
 * Plan-fit (task 1.4): for each subsidised provider with usage in the window,
 * compare the window's computed pay-as-you-go burn (normalized to a monthly
 * figure on the same 30-day basis subsidisation.ts uses for windows) against the
 * cheapest known flat plan. Free/Custom presets are excluded as fit candidates: a
 * $0 tier carries no paid-equivalent capacity to compare against a real burn.
 * Requires a window to normalize against; returns [] if none was provided.
 */
export function planFitScenarios(
	input: WhatifInput,
	resolver: PriceResolver,
	cost: CostFn,
	planTable: Record<string, SubscriptionPreset[]> = SUBSCRIPTION_PRESETS,
	snapshotDate: string = PLAN_PRICES_SNAPSHOT
): ScenarioResult[] {
	if (!input.window) return [];
	const { from, to } = input.window;
	const windowDays = inclusiveDays(from, to);
	if (windowDays <= 0) return [];

	const results: ScenarioResult[] = [];

	for (const provider of Object.keys(planTable)) {
		const providerSlices = input.slices.filter((s) => s.provider === provider);
		if (providerSlices.length === 0) continue;

		const excluded: UsageSlice[] = [];
		let windowBurn = 0;
		for (const slice of providerSlices) {
			const src = resolver.source(slice.provider, slice.model);
			if (!src) {
				excluded.push(slice);
				continue;
			}
			windowBurn += cost(src, slice.tokens);
		}

		const monthlyPayg = (windowBurn / windowDays) * FEE_PRORATA_DAYS;

		const paidPlans = planTable[provider].filter((p) => !p.custom && p.monthlyUsd > 0);
		let cheapest: SubscriptionPreset | null = null;
		for (const plan of paidPlans) {
			if (!cheapest || plan.monthlyUsd < cheapest.monthlyUsd) cheapest = plan;
		}

		const windowNote = `Window: ${from} → ${to} (${windowDays}d, normalized to a ${FEE_PRORATA_DAYS}-day month).`;
		const snapshotNote = `Plan prices snapshot: ${snapshotDate}.`;
		const boundedNote =
			'Bounded: plan usage limits are not modelled; Free/Custom presets excluded as candidates.';

		let totalUsd: number;
		let basis: string;
		const notes = [PRICE_ONLY_COUNTERFACTUAL];

		if (cheapest && cheapest.monthlyUsd < monthlyPayg) {
			totalUsd = cheapest.monthlyUsd;
			basis = `cheapest flat plan (${cheapest.label}) vs pay-as-you-go`;
			notes.push(
				`Cheapest plan for this window: ${cheapest.label} ($${cheapest.monthlyUsd}/mo) vs $${monthlyPayg.toFixed(2)}/mo pay-as-you-go.`
			);
		} else {
			totalUsd = monthlyPayg;
			basis = 'pay-as-you-go beats every flat plan';
			notes.push(
				`No flat plan beats pay-as-you-go for this window ($${monthlyPayg.toFixed(2)}/mo).`
			);
		}
		notes.push(windowNote, snapshotNote, boundedNote);
		if (excluded.length > 0) {
			notes.push(
				`$${buildExclusion(excluded).spendUsd.toFixed(2)} of ${provider} usage across ${excluded.length} model(s) had no known price and was excluded from the burn.`
			);
		}

		results.push({
			id: `plan-fit:${provider}`,
			kind: 'plan-fit',
			label: `Plan-fit — ${provider}`,
			basis,
			totalUsd,
			actualUsd: monthlyPayg,
			deltaUsd: totalUsd - monthlyPayg,
			exclusions: buildExclusion(excluded),
			notes
		});
	}

	return results;
}
