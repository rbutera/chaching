// Counterfactual Lab engine entrypoint. NODE-side: it wires the default server
// resolver + the single cost formula into the pure scenario math and returns the
// serializable ScenarioResult[] the CLI ledger and the web region both render
// (design decision 6). The CLI passes a runOnce() snapshot's grain; the web
// server passes the live rollup's grain — same aggregation either way.

import type { DayModelAgg } from '../../types';
import { buildWhatifInput } from './aggregate';
import { altModelScenario, noCacheScenario, planFitScenarios } from './scenarios';
import { defaultCostFn, defaultResolver } from './resolve';
import type { CostFn, PriceResolver, ScenarioResult, UsageWindow, WhatifInput } from './types';

export interface BuildScenariosOptions {
	/** inclusive [from, to] window to reprice; omit to reprice the full grain (plan-fit then skipped) */
	window?: UsageWindow | null;
	/** target model id for the alternate-model scenario; omit to skip that scenario */
	targetModel?: string | null;
	/** include the no-cache scenario (default true) */
	noCache?: boolean;
	/** include plan-fit (default true; still requires a window) */
	planFit?: boolean;
	/** override the price resolver (tests / future client-side wiring) */
	resolver?: PriceResolver;
	/** override the cost formula (tests) */
	cost?: CostFn;
}

/**
 * Build the ranked scenario ledger over the grain. Ordering: alternate-model (if a
 * target was given), then no-cache, then one plan-fit row per subsidised provider
 * with usage. Every result carries the mandatory price-only-counterfactual label.
 */
export function buildScenarios(
	dayModel: DayModelAgg[],
	options: BuildScenariosOptions = {}
): ScenarioResult[] {
	const resolver = options.resolver ?? defaultResolver;
	const cost = options.cost ?? defaultCostFn;
	const input: WhatifInput = buildWhatifInput(dayModel, options.window ?? null);

	const results: ScenarioResult[] = [];
	if (options.targetModel) {
		results.push(altModelScenario(input, options.targetModel, resolver, cost));
	}
	if (options.noCache !== false) {
		results.push(noCacheScenario(input, resolver, cost));
	}
	if (options.planFit !== false) {
		results.push(...planFitScenarios(input, resolver, cost));
	}
	return results;
}
