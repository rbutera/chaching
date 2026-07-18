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
import type { ScenarioResult } from '../../lib/core/whatif/types.js';
import { defaultAltTarget } from '../../lib/core/whatif/targets.js';
import { aggregateByModel, filterDays, sumGrain } from '../../lib/core/aggregate.js';
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

export async function runWhatif(flags: WhatifFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	const period: Period = flags.period ?? 'month';
	const state = defaultViewState(period);
	const window = periodWindow(snapshot, state);
	const grain = filterDays(snapshot.dayModel, window.from, window.to);
	const modelsPresent = aggregateByModel(grain).map((m) => m.model);
	const targetModel = flags.model ?? defaultAltTarget(modelsPresent);

	const results = buildScenarios(snapshot.dayModel, {
		window: { from: window.from, to: window.to },
		targetModel,
		noCache: true,
		planFit: true
	});

	if (flags.json) {
		const windowActual = sumGrain(grain);
		writeStdoutSync(
			JSON.stringify({
				window: { from: window.from, to: window.to, label: window.label },
				targetModel,
				actual: {
					costUsd: windowActual.cost,
					costUnknownRequests: windowActual.costUnknownRequests
				},
				label: PRICE_ONLY_COUNTERFACTUAL,
				results
			}) + '\n'
		);
		return;
	}

	printHuman(snapshot, grain, window, targetModel, results, flags);
}

function printHuman(
	snapshot: RollupSnapshot,
	grain: RollupSnapshot['dayModel'],
	window: { from: string; to: string; label: string },
	targetModel: string | null,
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

	const windowActual = sumGrain(grain);

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
	console.log(`  You actually billed:   ${money(windowActual.cost)}`);
	if (windowActual.costUnknownRequests > 0) {
		console.log(
			`  ${dim(`(${int(windowActual.costUnknownRequests)} request(s) with unknown pricing — the recorded bill is a floor)`)}`
		);
	}

	// Window-frame scenarios (alt-model, no-cache): ranked with the actual as an
	// anchor row, cheapest total first. Plan-fit is a DIFFERENT (monthly) frame and
	// renders in its own block below — never mixed into this ranking.
	const windowScenarios = results.filter((r) => r.kind !== 'plan-fit');
	const planFits = results.filter((r) => r.kind === 'plan-fit');

	type Row = { label: string; total: number | null; result: ScenarioResult | null };
	const rows: Row[] = [
		{ label: 'What you actually billed', total: windowActual.cost, result: null },
		...windowScenarios.map((r) => ({ label: r.label, total: r.totalUsd, result: r }))
	];
	// Rank by total ascending; unavailable (null) rows sink to the bottom.
	rows.sort((a, b) => {
		if (a.total == null && b.total == null) return 0;
		if (a.total == null) return 1;
		if (b.total == null) return -1;
		return a.total - b.total;
	});

	console.log('');
	console.log('  Priced under a different basis (ranked cheapest first):');
	console.log('');
	for (const row of rows) {
		if (!row.result) {
			// The actual-bill anchor row.
			console.log(`    ${row.label.padEnd(34)} ${money(row.total ?? 0).padStart(11)}   ${dim('← what you paid')}`);
			continue;
		}
		const r = row.result;
		if (r.totalUsd == null || r.deltaUsd == null) {
			console.log(`    ${r.label.padEnd(34)} ${'unavailable'.padStart(11)}`);
		} else {
			console.log(
				`    ${r.label.padEnd(34)} ${money(r.totalUsd).padStart(11)}   ${signedMoney(r.deltaUsd)} vs actual`
			);
		}
		console.log(`      ${dim(r.basis)}`);
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
			for (const note of r.notes) {
				if (note === PRICE_ONLY_COUNTERFACTUAL) continue;
				console.log(`      ${dim(note)}`);
			}
		}
	}

	console.log('');
}
