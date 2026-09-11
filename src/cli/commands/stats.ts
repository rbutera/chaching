// `chaching stats` — one-shot summary via runOnce().

import { runOnce } from '../../lib/core/engine.js';
import { writeSync } from 'node:fs';
import { getReportAccountContext } from '../../lib/core/sync/manager.js';
import { buildWindowSubsidisation } from '../../lib/core/subsidisation.js';
import { rollingPeriodRange } from '../receipt/build.js';
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
import { aggregateProjects, inWindow, allSessions, poolGrain, coverageForState } from '../../lib/core/view-model.js';
import { money, compactTokens, providerLabel, modelLabel, int } from '../../lib/format.js';
import type { Period, RollupSnapshot } from '../../lib/types.js';
import {
	noArt as resolveNoArt,
	wordmark,
	emptyLine,
	flourishFor,
	formatFlourish,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES
} from '../theme/personality.js';

const TOP_MODELS = 8;
const TOP_PROJECTS = 8;

export interface StatsFlags {
	period?: Period;
	providers?: string[];
	models?: string[];
	machines?: string[];
	accountIds?: string[];
	range?: { from: string; to: string };
	json?: boolean;
	/** Suppress ASCII art + decorative copy (--no-art flag or CHACHING_NO_ART env). */
	noArt?: boolean;
}

export async function runStats(flags: StatsFlags): Promise<void> {
	const { config: cfg, fees } = await getReportAccountContext(flags);
	const snapshot = await runOnce(cfg);
	const now = Date.now();
	const range = flags.range ?? rollingPeriodRange(snapshot, flags.period ?? 'all', now);
	const scoped = statsSnapshot(snapshot, { ...flags, range }, now);

	// --json: emit only the raw snapshot. ZERO art/decoration regardless of flags.
	// A script that passes --period week --provider codex --json gets scoped data only.
	if (flags.json) {
		// _pricing exposes which price snapshot resolved (and confirms it loaded at
		// all) — useful for scripts and a guard against the cwd/layout resolution bug.
		const pricing = getPricingMeta();
		const providers = new Set(flags.providers);
		const subsidy = buildWindowSubsidisation(scoped.dayModel, {
			claude: { ...fees.claude, enabled: fees.claude.enabled && (!providers.size || providers.has('claude')) },
			codex: { ...fees.codex, enabled: fees.codex.enabled && (!providers.size || providers.has('codex')) }
		}, range);
		writeStdoutSync(JSON.stringify({ ...scoped, subsidisation: {
			...range, feeUsd: subsidy.combined.windowFeeUsd,
			apiEquivalentUsd: subsidy.combined.sub.apiEquivalentUsd,
			netSubsidyUsd: subsidy.combined.sub.netSubsidyUsd,
			multiple: subsidy.combined.sub.multiple,
			wholeAccountFee: !!flags.machines?.length
		}, _pricing: pricing }) + '\n');
		return;
	}

	printHuman(snapshot, scoped, flags, range);
}

export function statsSnapshot(snapshot: RollupSnapshot, flags: StatsFlags, now: number = Date.now()) {
	if (!flags.period && !flags.range && !flags.providers?.length && !flags.models?.length && !flags.machines?.length && !flags.accountIds?.length) return snapshot;
	const providers = new Set(flags.providers);
	const models = new Set(flags.models);
	const state = { period: flags.period ?? 'all' as const, focusedDay: null,
		providerFilter: providers, modelFilter: models, machineFilter: new Set(flags.machines), accountFilter: new Set(flags.accountIds) };
	const { from, to } = flags.range ?? rollingPeriodRange(snapshot, flags.period ?? 'all', now);
	const grain = filterDays(poolGrain(snapshot.dayModel, state), from, to).filter(row =>
		(!providers.size || providers.has(row.provider)) && (!models.size || models.has(row.model)));
	const sessions = allSessions(snapshot, state).filter(row => inWindow(row, from, to));
	const days = grain.map(row => row.day).sort();
	const { coverage: _coverage, ...totals } = sumGrain(grain);
	return {
		...snapshot,
		dayModel: grain,
		totals,
		sessions,
		models: aggregateByModel(grain).map(row => row.model),
		providers: aggregateByProvider(grain).map(row => row.provider),
		unknownPriceModels: [...new Set(grain.filter(row => row.costUnknownRequests > 0).map(row => row.model))],
		earliestDay: days[0] ?? null,
		latestDay: days.at(-1) ?? null,
		coverage: Object.fromEntries(Object.entries(coverageForState(snapshot, state)).filter(([day]) => (!from || day >= from) && (!to || day <= to))),
		_scope: { from: from ?? null, to: to ?? null, providers: [...providers], models: [...models], machines: flags.machines ?? [], accountIds: flags.accountIds ?? [], sessionTotals: 'whole overlapping sessions', unscoped: ['blocks', 'localBlocks', 'stats'] }
	};
}

function printHuman(snapshot: RollupSnapshot, scoped: RollupSnapshot, flags: StatsFlags, { from, to }: { from: string; to: string }): void {
	const isNoArt = flags.noArt ?? resolveNoArt();
	const providerFilter = flags.providers?.length ? new Set(flags.providers) : null;
	const grain = scoped.dayModel;

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
	const byProject = aggregateProjects(scoped.sessions);

	const totalToks = totals.tokens.input + totals.tokens.output
		+ totals.tokens.cacheCreation + totals.tokens.cacheRead;

	const periodLabel = flags.period || flags.range
		? `  period: ${flags.period ?? 'selected dates'}${from ? ` (${from} → ${to ?? 'today'})` : ''}`
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
		console.log(`  By project (top ${Math.min(TOP_PROJECTS, byProject.length)}, whole sessions in window):`);
		for (const p of shown) {
			const toks = p.tokens.input + p.tokens.output + p.tokens.cacheCreation + p.tokens.cacheRead;
			// truncate BEFORE padEnd so a long path can't break column alignment
			const name = p.display.length > 20 ? p.display.slice(0, 19) + '…' : p.display;
			console.log(`    ${name.padEnd(20)} ${money(p.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(p.sessionCount).padStart(4)} sess`);
		}
		if (byProject.length > shown.length) {
			console.log(`    …and ${byProject.length - shown.length} more`);
		}
	}

	console.log('');
}
