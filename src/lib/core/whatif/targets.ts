// Alternate-model target suggestions for the Counterfactual Lab picker (web) and
// the `chaching whatif` CLI default. CLIENT-SAFE: no Node imports — the web
// scenario picker imports this to build its `<select>`, and the CLI reuses the
// SAME helper so both surfaces offer the same target set. Pricing RESOLUTION of
// the chosen target still happens server-side (resolve.ts); this module only
// proposes ids to reprice against. (`../aggregate` is itself client-safe — pure
// re-aggregation over the grain, type-only imports — so importing it here keeps
// this module browser-importable.)

import { aggregateByModel, filterDays } from '../aggregate';
import type { DayModelAgg } from '../../types';

/**
 * The models present in a window's UNFILTERED grain, cost-desc — the exact set the
 * whatif engine reprices (buildScenarios takes the whole `[from, to]` window, NOT
 * the dashboard's provider/day/pool-filtered view). Both the CLI default-target
 * derivation and the web target menu call this, so the two can never disagree with
 * what the endpoint actually reprices for a given window: a menu fed off the
 * filtered view would offer/derive targets the endpoint doesn't reprice.
 */
export function windowModelsPresent(
	dayModel: readonly DayModelAgg[],
	from: string,
	to: string
): string[] {
	return aggregateByModel(filterDays([...dayModel], from, to)).map((m) => m.model);
}

/**
 * Canonical cheaper alternatives offered IN ADDITION to the models already present
 * in the window. Real ids the default resolver knows (Claude/Codex via cost.ts,
 * others via models.dev). Vendored constants, same snapshot discipline as the price
 * maps — refresh when a cheaper canonical model ships. Ordered cheap-ish first so
 * the default target lands on a genuinely lighter model.
 */
export const CANONICAL_ALT_TARGETS: readonly string[] = [
	'claude-haiku-4-5',
	'claude-sonnet-4-6',
	'gpt-5-codex'
];

/**
 * The target ids to offer: every model actually present in the window (dedup,
 * order preserved — usually cost-desc from `aggregateByModel`) followed by the
 * canonical cheaper alternatives not already present. Repricing a model at its own
 * id is a legitimate (zero-delta) choice, so present models are kept.
 */
export function altModelTargets(modelsPresent: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const m of modelsPresent) {
		if (m && !seen.has(m)) {
			seen.add(m);
			out.push(m);
		}
	}
	for (const m of CANONICAL_ALT_TARGETS) {
		if (!seen.has(m)) {
			seen.add(m);
			out.push(m);
		}
	}
	return out;
}

/**
 * The default alt-model target for a window: the first canonical cheaper
 * alternative that is NOT already present in the window (a real counterfactual, not
 * a zero-delta reprice-at-itself), else — only when every canonical alternative is
 * already present, or there are none — the first offered target, else null (no
 * models at all → the caller skips the alt-model row). Kept deterministic (no price
 * lookups — resolution is server-side) so web and CLI pick the same default for the
 * same window.
 */
export function defaultAltTarget(modelsPresent: readonly string[]): string | null {
	const present = new Set(modelsPresent.filter(Boolean));
	const cheaperAlt = CANONICAL_ALT_TARGETS.find((m) => !present.has(m));
	if (cheaperAlt) return cheaperAlt;
	// Every canonical alternative is already in the window (or there are none): fall
	// back to the first offered target so the row still renders (may be zero-delta).
	return altModelTargets(modelsPresent)[0] ?? null;
}
