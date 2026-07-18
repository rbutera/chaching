// Counterfactual Lab — public API surface for the CLI (task 2) and web (task 3)
// waves. The engine + resolver are Node-side; types are client-safe (import them
// from './whatif/types' directly in browser code to avoid the Node edge).

export { buildScenarios, type BuildScenariosOptions } from './engine';
export { buildWhatifInput, aggregateSlices } from './aggregate';
export {
	altModelScenario,
	noCacheScenario,
	planFitScenarios,
	PLAN_PRICES_SNAPSHOT
} from './scenarios';
export { defaultResolver, defaultCostFn } from './resolve';
export {
	PRICE_ONLY_COUNTERFACTUAL,
	type ScenarioResult,
	type ScenarioKind,
	type ScenarioExclusion,
	type UsageSlice,
	type UsageWindow,
	type WhatifInput,
	type PriceResolver,
	type CostFn
} from './types';
