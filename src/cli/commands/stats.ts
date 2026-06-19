// `chaching stats` — one-shot summary via runOnce().

import { runOnce } from '../../lib/core/engine.js';
import { loadConfig } from '../../lib/core/config.js';
import {
	aggregateByModel,
	aggregateByProvider,
	filterDays,
	sumGrain
} from '../../lib/core/aggregate.js';
import { money, compactTokens, providerLabel, modelLabel, int } from '../../lib/format.js';
import type { Period, RollupSnapshot } from '../../lib/types.js';

const TOP_MODELS = 8;

export interface StatsFlags {
	period?: Period;
	providers?: string[];
	json?: boolean;
}

export async function runStats(flags: StatsFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	// --json: emit only the raw snapshot, respecting any --period/--provider scoping.
	// A script that passes --period week --provider codex --json should get scoped data.
	if (flags.json) {
		if (flags.period || flags.providers) {
			// Produce a scoped snapshot by filtering dayModel and recomputing totals.
			const providerFilter = flags.providers && flags.providers.length > 0
				? new Set(flags.providers)
				: null;
			const { from, to } = periodDayRange(flags.period);
			let grain = filterDays(snapshot.dayModel, from, to);
			if (providerFilter) {
				grain = grain.filter((dm) => providerFilter.has(dm.provider));
			}
			const scoped: RollupSnapshot = {
				...snapshot,
				dayModel: grain
			};
			process.stdout.write(JSON.stringify(scoped) + '\n');
		} else {
			process.stdout.write(JSON.stringify(snapshot) + '\n');
		}
		return;
	}

	printHuman(snapshot, flags);
}

function periodDayRange(period: Period | undefined): { from: string | undefined; to: string | undefined } {
	if (!period) return { from: undefined, to: undefined };
	const now = new Date();
	const todayUTC = now.toISOString().slice(0, 10);

	if (period === 'day') {
		return { from: todayUTC, to: todayUTC };
	}

	if (period === 'week') {
		// Start of ISO week (Monday)
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const dow = (d.getUTCDay() + 6) % 7; // Mon=0
		d.setUTCDate(d.getUTCDate() - dow);
		const from = d.toISOString().slice(0, 10);
		return { from, to: todayUTC };
	}

	if (period === 'month') {
		const from = `${todayUTC.slice(0, 7)}-01`;
		return { from, to: todayUTC };
	}

	return { from: undefined, to: undefined };
}

function printHuman(snapshot: RollupSnapshot, flags: StatsFlags): void {
	const providerFilter = flags.providers && flags.providers.length > 0
		? new Set(flags.providers)
		: null;

	const { from, to } = periodDayRange(flags.period);

	// Filter the dayModel grain
	let grain = filterDays(snapshot.dayModel, from, to);
	if (providerFilter) {
		grain = grain.filter((dm) => providerFilter.has(dm.provider));
	}

	// If no data at all (original snapshot is also empty), friendly empty state
	if (snapshot.dayModel.length === 0) {
		console.log('chaching: no data found.');
		console.log('');
		console.log('Run `chaching init` to configure your providers and start tracking spend.');
		return;
	}

	// Filtered data can be empty even if there is some data
	if (grain.length === 0) {
		const label = flags.providers ? `provider(s): ${flags.providers.join(', ')}` : '';
		const periodLabel = flags.period ? ` for period: ${flags.period}` : '';
		console.log(`chaching: no data found for ${label}${periodLabel}.`);
		return;
	}

	const totals = sumGrain(grain);
	const byProvider = aggregateByProvider(grain);
	const byModel = aggregateByModel(grain).slice(0, TOP_MODELS);

	const totalToks = totals.tokens.input + totals.tokens.output
		+ totals.tokens.cacheCreation + totals.tokens.cacheRead;

	const periodLabel = flags.period
		? `  period: ${flags.period}${from ? ` (${from} → ${to ?? 'today'})` : ''}`
		: '';
	const provLabel = providerFilter
		? `  provider filter: ${flags.providers?.join(', ')}`
		: '';

	console.log('');
	console.log('  chaching — spend summary');
	if (periodLabel) console.log(periodLabel);
	if (provLabel) console.log(provLabel);
	if (snapshot.earliestDay) {
		console.log(`  data since: ${snapshot.earliestDay}`);
	}
	console.log('');
	console.log(`  Total cost:    ${money(totals.cost)}`);
	console.log(`  Total tokens:  ${compactTokens(totalToks)}`);
	console.log(`    Input:       ${compactTokens(totals.tokens.input)}`);
	console.log(`    Output:      ${compactTokens(totals.tokens.output)}`);
	console.log(`    Cache read:  ${compactTokens(totals.tokens.cacheRead)}`);
	console.log(`    Cache write: ${compactTokens(totals.tokens.cacheCreation)}`);
	console.log(`  Requests:      ${int(totals.requests)}`);
	if (totals.costUnknownRequests > 0) {
		console.log(`  (${int(totals.costUnknownRequests)} request(s) with unknown pricing)`);
	}

	if (byProvider.length > 0) {
		console.log('');
		console.log('  By provider:');
		for (const p of byProvider) {
			const toks = p.tokens.input + p.tokens.output + p.tokens.cacheCreation + p.tokens.cacheRead;
			console.log(`    ${providerLabel(p.provider).padEnd(16)} ${money(p.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(p.requests).padStart(6)} req`);
		}
	}

	if (byModel.length > 0) {
		console.log('');
		console.log(`  By model (top ${Math.min(TOP_MODELS, byModel.length)}):`);
		for (const m of byModel) {
			const toks = m.tokens.input + m.tokens.output + m.tokens.cacheCreation + m.tokens.cacheRead;
			console.log(`    ${modelLabel(m.model).padEnd(20)} ${money(m.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(m.requests).padStart(6)} req`);
		}
	}

	console.log('');
}
