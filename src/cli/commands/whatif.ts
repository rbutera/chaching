// `chaching whatif` — the Counterfactual Lab as a ranked CLI ledger (task 2.1).
//
// One-shot via runOnce(). Reprices the selected window's real usage under three
// bases (alternate-model, no-cache, subscription plan-fit) through the SAME
// engine + resolvers the web region uses (design decision 6 — one ScenarioResult
// shape, two renderers), so the two surfaces agree for the same window. Every
// figure is a price-only counterfactual (bounds, not promises); unknown-priced
// usage is excluded and surfaced, and a null total renders "unavailable", never a
// fabricated $0 (cost-honesty hard rule).

import { runOnce } from '../../lib/core/engine.js';
import { writeSync } from 'node:fs';
import { loadConfig } from '../../lib/core/config.js';
import { buildScenarios } from '../../lib/core/whatif/engine.js';
import { PRICE_ONLY_COUNTERFACTUAL } from '../../lib/core/whatif/types.js';
import type { ScenarioResult, ScenarioExclusion } from '../../lib/core/whatif/types.js';
import { defaultAltTarget, windowModelsPresent } from '../../lib/core/whatif/targets.js';
import { filterDays, sumGrain } from '../../lib/core/aggregate.js';
import type { Totals } from '../../lib/core/aggregate.js';
import { defaultViewState, periodWindow } from '../../lib/core/view-model.js';
import { money, int } from '../../lib/format.js';
import type { Period, RollupSnapshot } from '../../lib/types.js';
import { noArt as resolveNoArt, wordmark, emptyLine, dim } from '../theme/personality.js';

// Synchronous stdout write — the launcher force-exits one-shot commands, so an
// async write to a pipe (`chaching whatif --json | jq`) can truncate. Mirrors the
// stats/receipt commands.
function writeStdoutSync(text: string): void {
	const buf = Buffer.from(text, 'utf8');
	let offset = 0;
	while (offset < buf.length) {
		try {
			offset += writeSync(1, buf, offset, buf.length - offset);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EAGAIN') continue;
			throw err;
		}
	}
}

export interface WhatifFlags {
	period?: Period;
	/** explicit alternate-model target; omit to derive a sensible default from the window */
	model?: string;
	json?: boolean;
	/** Suppress ASCII art + decorative copy (--no-art flag or CHACHING_NO_ART env). */
	noArt?: boolean;
}

/** Signed money for a delta: "-$4.20" (cheaper) / "+$8.10" (dearer) / "$0.00". */
function signedMoney(v: number): string {
	if (v > 0) return `+${money(v)}`;
	if (v < 0) return `-${money(-v)}`;
	return money(0);
}

/**
 * Window-frame scenarios (alt-model, no-cache) ranked cheapest engine-total first;
 * unavailable (null total) rows sink to the bottom. The window-wide actual bill is
 * the anchor LINE, never a ranked row: its scope (all slices, including any excluded
 * from repricing) is incompatible with these included-only scenario totals, so
 * ranking them together would mislead. Each row's own `deltaUsd` carries the honest
 * per-scenario comparison. Plan-fit (a different, monthly frame) is excluded here.
 */
export function rankWindowScenarios(results: ScenarioResult[]): ScenarioResult[] {
	return results
		.filter((r) => r.kind !== 'plan-fit')
		.sort((a, b) => {
			if (a.totalUsd == null && b.totalUsd == null) return 0;
			if (a.totalUsd == null) return 1;
			if (b.totalUsd == null) return -1;
			return a.totalUsd - b.totalUsd;
		});
}

/**
 * The CLI exclusion line, mirroring the web region: nullable excluded spend renders
 * "spend unknown" (the types.ts:80 contract), never a fabricated $0. Returns null
 * when nothing was excluded.
 */
export function exclusionLine(ex: ScenarioExclusion): string | null {
	if (ex.modelCount === 0) return null;
	const amount = ex.spendUsd == null ? 'spend unknown' : money(ex.spendUsd);
	return `${int(ex.modelCount)} model(s) excluded · ${amount}`;
}

export async function runWhatif(flags: WhatifFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	const period: Period = flags.period ?? 'month';
	const state = defaultViewState(period);
	const window = periodWindow(snapshot, state);
	const grain = filterDays(snapshot.dayModel, window.from, window.to);
	const targetModel =
		flags.model ?? defaultAltTarget(windowModelsPresent(snapshot.dayModel, window.from, window.to));

	const results = buildScenarios(snapshot.dayModel, {
		window: { from: window.from, to: window.to },
		targetModel,
		noCache: true,
		planFit: true
	});

	// The window-wide recorded bill: the honest anchor both renderers show, summed
	// once here (never per-renderer) from the same grain the engine repriced.
	const windowActual = sumGrain(grain);

	if (flags.json) {
		writeStdoutSync(
			JSON.stringify({
				window: { from: window.from, to: window.to, label: window.label },
				targetModel,
				actual: {
					// window-wide: the whole window's real bill, including slices the
					// scenarios excluded from repricing — labelled so consumers don't
					// conflate it with a scenario's included-only actualUsd.
					scope: 'window-wide',
					costUsd: windowActual.cost,
					costUnknownRequests: windowActual.costUnknownRequests
				},
				label: PRICE_ONLY_COUNTERFACTUAL,
				results
			}) + '\n'
		);
		return;
	}

	printHuman(snapshot, grain, windowActual, window, results, flags);
}

function printHuman(
	snapshot: RollupSnapshot,
	grain: RollupSnapshot['dayModel'],
	windowActual: Totals,
	window: { from: string; to: string; label: string },
	results: ScenarioResult[],
	flags: WhatifFlags
): void {
	const isNoArt = flags.noArt ?? resolveNoArt();

	// No data at all → the same friendly empty state as stats.
	if (snapshot.dayModel.length === 0) {
		console.log('');
		if (!isNoArt) {
			const wm = wordmark({ noArt: false });
			if (wm) console.log(`  ${wm}`);
			console.log('');
			console.log(`  ${emptyLine()}`);
		} else {
			console.log('chaching: no data found.');
		}
		console.log('');
		console.log('  Run `chaching init` to configure your providers and start tracking spend.');
		return;
	}

	if (grain.length === 0) {
		console.log(`chaching: no data found for period: ${flags.period ?? 'month'}.`);
		return;
	}

	console.log('');
	if (!isNoArt) {
		const wm = wordmark({ noArt: false });
		if (wm) console.log(`  ${wm}`);
	} else {
		console.log('  chaching — counterfactual lab');
	}
	console.log('');
	console.log(`  counterfactual lab · ${window.label} (${window.from} → ${window.to})`);
	console.log(`  ${dim(PRICE_ONLY_COUNTERFACTUAL)}`);
	console.log('');
	// The anchor: the WHOLE window's recorded bill, OUTSIDE the ranked list. It is
	// window-wide (every slice), so it is not comparable to the included-only scenario
	// totals below — each scenario's own `deltaUsd` carries the honest comparison.
	console.log(`  You actually billed (window-wide):   ${money(windowActual.cost)}`);
	if (windowActual.costUnknownRequests > 0) {
		console.log(
			`  ${dim(`(${int(windowActual.costUnknownRequests)} request(s) with unknown pricing — the recorded bill is a floor)`)}`
		);
	}

	// Window-frame scenarios (alt-model, no-cache): ranked cheapest engine-total
	// first. Plan-fit is a DIFFERENT (monthly) frame and renders in its own block
	// below — never mixed into this ranking.
	const ranked = rankWindowScenarios(results);
	const planFits = results.filter((r) => r.kind === 'plan-fit');

	console.log('');
	console.log('  Priced under a different basis (ranked cheapest first):');
	console.log('');
	for (const r of ranked) {
		if (r.totalUsd == null || r.deltaUsd == null) {
			console.log(`    ${r.label.padEnd(34)} ${'unavailable'.padStart(11)}`);
		} else {
			console.log(
				`    ${r.label.padEnd(34)} ${money(r.totalUsd).padStart(11)}   ${signedMoney(r.deltaUsd)} vs actual`
			);
		}
		console.log(`      ${dim(r.basis)}`);
		const excl = exclusionLine(r.exclusions);
		if (excl) console.log(`      ${dim(excl)}`);
		// Notes minus the region-wide label (already printed once at the top).
		for (const note of r.notes) {
			if (note === PRICE_ONLY_COUNTERFACTUAL) continue;
			console.log(`      ${dim(note)}`);
		}
	}

	if (planFits.length > 0) {
		console.log('');
		console.log('  Subscription plan-fit (monthly-normalized — a different frame to the window totals above):');
		console.log('');
		for (const r of planFits) {
			if (r.totalUsd == null || r.actualUsd == null || r.deltaUsd == null) {
				console.log(`    ${r.label.padEnd(34)} ${'unavailable'.padStart(11)}`);
			} else {
				const verdict = r.deltaUsd < 0 ? `saves ${money(-r.deltaUsd)}/mo` : `costs ${money(r.deltaUsd)}/mo more`;
				console.log(`    ${r.label.padEnd(34)} ${money(r.totalUsd).padStart(11)}/mo   ${verdict}`);
			}
			const excl = exclusionLine(r.exclusions);
			if (excl) console.log(`      ${dim(excl)}`);
			for (const note of r.notes) {
				if (note === PRICE_ONLY_COUNTERFACTUAL) continue;
				console.log(`      ${dim(note)}`);
			}
		}
	}

	console.log('');
}
