// `chaching stats` — one-shot summary via runOnce().

import { runOnce } from '../../lib/core/engine.js';
import { writeSync } from 'node:fs';
import { loadConfig } from '../../lib/core/config.js';
import { getPricingMeta } from '../../lib/core/pricing/cost.js';

// Synchronous stdout write. The launcher force-exits one-shot commands, and a
// large async `process.stdout.write` to a pipe is still draining when exit hits,
// truncating the output (e.g. `chaching stats --json | jq`). Writing synchronously
// guarantees the whole payload lands before exit. Handles partial writes + EAGAIN
// (stdout can be a non-blocking pipe).
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
import {
	aggregateByModel,
	aggregateByProvider,
	filterDays,
	sumGrain
} from '../../lib/core/aggregate.js';
import { aggregateProjects, inWindow } from '../../lib/core/view-model.js';
import { money, compactTokens, providerLabel, modelLabel, int } from '../../lib/format.js';
import type { Period, RollupSnapshot } from '../../lib/types.js';
import {
	noArt as resolveNoArt,
	wordmark,
	emptyLine,
	flourishFor,
	formatFlourish,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
} from '../theme/personality.js';

const TOP_MODELS = 8;
const TOP_PROJECTS = 8;

export interface StatsFlags {
	period?: Period;
	providers?: string[];
	json?: boolean;
	/** Suppress ASCII art + decorative copy (--no-art flag or CHACHING_NO_ART env). */
	noArt?: boolean;
}

export async function runStats(flags: StatsFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	// --json: emit only the raw snapshot. ZERO art/decoration regardless of flags.
	// A script that passes --period week --provider codex --json gets scoped data only.
	if (flags.json) {
		// _pricing exposes which price snapshot resolved (and confirms it loaded at
		// all) — useful for scripts and a guard against the cwd/layout resolution bug.
		const pricing = getPricingMeta();
		if (flags.period || flags.providers) {
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
			writeStdoutSync(JSON.stringify({ ...scoped, _pricing: pricing }) + '\n');
		} else {
			writeStdoutSync(JSON.stringify({ ...snapshot, _pricing: pricing }) + '\n');
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
	const isNoArt = flags.noArt ?? resolveNoArt();
	const providerFilter = flags.providers && flags.providers.length > 0
		? new Set(flags.providers)
		: null;

	const { from, to } = periodDayRange(flags.period);

	let grain = filterDays(snapshot.dayModel, from, to);
	if (providerFilter) {
		grain = grain.filter((dm) => providerFilter.has(dm.provider));
	}

	// If no data at all, friendly empty state
	if (snapshot.dayModel.length === 0) {
		if (!isNoArt) {
			console.log('');
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
	// By project: window the session index to the SAME period + provider filter the rest of
	// this command uses (its calendar range, not the dashboard's rolling window), then fold
	// through the shared aggregator so the attribution matches the web + TUI math (design D4).
	const scopedSessions = snapshot.sessions.filter((s) => {
		if (from && to && !inWindow(s, from, to)) return false;
		if (providerFilter && !providerFilter.has(s.provider)) return false;
		return true;
	});
	const byProject = aggregateProjects(scopedSessions);

	const totalToks = totals.tokens.input + totals.tokens.output
		+ totals.tokens.cacheCreation + totals.tokens.cacheRead;

	const periodLabel = flags.period
		? `  period: ${flags.period}${from ? ` (${from} → ${to ?? 'today'})` : ''}`
		: '';
	const provLabel = providerFilter
		? `  provider filter: ${flags.providers?.join(', ')}`
		: '';

	// Big-spend flourish: use LIFETIME_FLOURISHES for all-time totals (no period
	// filter), DAILY_FLOURISHES when scoped to a day/week/month period.
	const flourishTiers = flags.period ? DAILY_FLOURISHES : LIFETIME_FLOURISHES;
	const spendFlourish = !isNoArt ? flourishFor(totals.cost, flourishTiers) : null;
	const flourishStr = spendFlourish ? formatFlourish(spendFlourish) : '';

	console.log('');

	if (!isNoArt) {
		const wm = wordmark({ noArt: false });
		if (wm) console.log(`  ${wm}`);
	} else {
		console.log('  chaching — spend summary');
	}

	if (periodLabel) console.log(periodLabel);
	if (provLabel) console.log(provLabel);
	if (snapshot.earliestDay) {
		console.log(`  data since: ${snapshot.earliestDay}`);
	}
	console.log('');
	console.log(`  Total cost:    ${money(totals.cost)}${flourishStr ? `  ${flourishStr}` : ''}`);
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

	if (byProject.length > 0) {
		const shown = byProject.slice(0, TOP_PROJECTS);
		console.log('');
		console.log(`  By project (top ${Math.min(TOP_PROJECTS, byProject.length)}):`);
		for (const p of shown) {
			const toks = p.tokens.input + p.tokens.output + p.tokens.cacheCreation + p.tokens.cacheRead;
			console.log(`    ${p.display.padEnd(20)} ${money(p.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(p.sessionCount).padStart(4)} sess`);
		}
		if (byProject.length > shown.length) {
			console.log(`    …and ${byProject.length - shown.length} more`);
		}
	}

	console.log('');
}
