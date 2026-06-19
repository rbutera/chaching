// Subcommand router — hand-rolled per design decision D3.
// Surface: chaching [stats|serve|init|provider|--version|--help]
// Unknown subcommands → usage + exit(1).

import { runStats, type StatsFlags } from './commands/stats.js';
import { runServe } from './commands/serve.js';
import { runInit } from './commands/init.js';
import { runProvider } from './commands/provider.js';
import { printUsage, printVersion } from './help.js';
import { configFilePath } from '../lib/core/config.js';
import { existsSync } from 'node:fs';

/** Parse raw argv (after slice(2)) and dispatch. */
export async function run(argv: string[]): Promise<void> {
	// Global flags first
	if (argv.includes('--version') || argv.includes('-v')) {
		printVersion();
		return;
	}
	if (argv.includes('--help') || argv.includes('-h')) {
		printUsage();
		return;
	}

	const [subcommand, ...rest] = argv;

	// A leading flag (e.g. `chaching --no-art`) is a bare-dashboard invocation with
	// options, not a subcommand. Route the whole argv into runDefault so the TUI
	// sees its flags. (Global --version/--help are already handled above.)
	if (subcommand !== undefined && subcommand.startsWith('-')) {
		await runDefault(argv);
		return;
	}

	switch (subcommand) {
		case undefined:
		case '':
			// Bare invocation: first-run detection (D5)
			await runDefault(rest);
			return;

		case 'stats':
			await runStats(parseStatsFlags(rest));
			return;

		case 'serve':
			await runServe();
			return;

		case 'init':
			await runInit();
			return;

		case 'provider':
			await runProvider(rest);
			return;

		default:
			console.error(`chaching: unknown subcommand '${subcommand}'\n`);
			printUsage();
			process.exit(1);
	}
}

/** Bare `chaching` — first-run check then the live Ink TUI dashboard (wave 4). */
async function runDefault(rest: string[]): Promise<void> {
	const cfgPath = configFilePath();
	const hasConfig = existsSync(cfgPath);

	if (!hasConfig) {
		// D5: first-run → wizard, then dashboard
		await runInit();
	}

	const { runDashboard } = await import('./tui/index.js');
	await runDashboard({ argv: rest });
}

function parseStatsFlags(argv: string[]): StatsFlags {
	const flags: StatsFlags = {};
	const providers: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '--json') {
			flags.json = true;
		} else if (arg === '--period') {
			const p = argv[i + 1];
			if (!p || p.startsWith('--')) {
				console.error(`chaching stats: --period requires a value (day|week|month)`);
				process.exit(1);
			}
			i++;
			if (p === 'day' || p === 'week' || p === 'month') {
				flags.period = p;
			} else {
				console.error(`chaching stats: unknown period '${p}' (must be day|week|month)`);
				process.exit(1);
			}
		} else if (arg.startsWith('--period=')) {
			const p = arg.slice('--period='.length);
			if (!p) {
				console.error(`chaching stats: --period requires a value (day|week|month)`);
				process.exit(1);
			}
			if (p === 'day' || p === 'week' || p === 'month') {
				flags.period = p;
			} else {
				console.error(`chaching stats: unknown period '${p}' (must be day|week|month)`);
				process.exit(1);
			}
		} else if (arg === '--provider') {
			const raw = argv[i + 1];
			if (!raw || raw.startsWith('--')) {
				console.error(`chaching stats: --provider requires a value`);
				process.exit(1);
			}
			i++;
			// Repeatable; also accept comma-sep
			providers.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
		} else if (arg.startsWith('--provider=')) {
			const raw = arg.slice('--provider='.length);
			if (!raw) {
				console.error(`chaching stats: --provider requires a value`);
				process.exit(1);
			}
			providers.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
		} else if (arg.startsWith('-')) {
			// Unknown flag
			console.error(`chaching stats: unknown flag '${arg}'`);
			console.error(`Run \`chaching --help\` for usage.`);
			process.exit(1);
		}
	}

	if (providers.length > 0) flags.providers = providers;

	return flags;
}
