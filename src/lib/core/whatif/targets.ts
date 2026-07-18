// Alternate-model target suggestions for the Counterfactual Lab picker (web) and
// the `chaching whatif` CLI default. CLIENT-SAFE: no Node imports — the web
// scenario picker imports this to build its `<select>`, and the CLI reuses the
// SAME helper so both surfaces offer the same target set. Pricing RESOLUTION of
// the chosen target still happens server-side (resolve.ts); this module only
// proposes ids to reprice against.

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
 * alternative that isn't already the sole present model, else the first offered
 * target, else null (no models at all → the caller skips the alt-model row). Kept
 * deterministic (no price lookups — resolution is server-side) so web and CLI pick
 * the same default for the same window.
 */
export function defaultAltTarget(modelsPresent: readonly string[]): string | null {
	const targets = altModelTargets(modelsPresent);
	const canonical = targets.find((m) => CANONICAL_ALT_TARGETS.includes(m));
	return canonical ?? targets[0] ?? null;
}
