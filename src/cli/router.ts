// Subcommand router — hand-rolled per design decision D3.
// Surface: chaching [stats|receipt|serve|init|provider|doctor|--version|--help]
// Unknown subcommands → usage + exit(1).

import { runStats, type StatsFlags } from './commands/stats.js';
import { runReceipt, type ReceiptFlags } from './commands/receipt.js';
import { runWrapped, type WrappedFlags } from './commands/wrapped.js';
import { runServe } from './commands/serve.js';
import { runInit } from './commands/init.js';
import { runProvider } from './commands/provider.js';
import { runDoctor } from './commands/doctor.js';
import { runSync } from './commands/sync.js';
import { printUsage, printVersion } from './help.js';
import { configFilePath } from '../lib/core/config.js';
import { existsSync } from 'node:fs';
import { noArt } from './tui/theme.js';

/** Known global flags that may appear before the subcommand token. */
const GLOBAL_FLAGS = new Set(['--no-art', '--no-color']);

/** Parse raw argv (after slice(2)) and dispatch. */
export async function run(argv: string[]): Promise<void> {
	// Global flags first (checked across all argv positions)
	if (argv.includes('--version') || argv.includes('-v')) {
		printVersion();
		return;
	}
	if (argv.includes('--help') || argv.includes('-h')) {
		printUsage(argv);
		return;
	}

	// Strip recognized global flags so they don't block subcommand detection.
	// e.g. `chaching --no-art stats` → subcommand='stats', rest=['--no-art']
	const stripped = argv.filter((a) => !GLOBAL_FLAGS.has(a));
	const globalArgs = argv.filter((a) => GLOBAL_FLAGS.has(a));

	const [subcommand, ...rest] = stripped;

	// A leading flag that isn't a recognized global is a bare-dashboard invocation
	// with unknown options — route everything to runDefault (legacy behaviour).
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
			// Merge global flags (like --no-art) that appeared before the subcommand
			await runStats(parseStatsFlags([...globalArgs, ...rest]));
			return;

		case 'receipt':
			// Same global-flag merge as stats (--no-art / --no-color before the subcommand).
			await runReceipt(parseReceiptFlags([...globalArgs, ...rest]));
			return;

		case 'wrapped':
			// Same global-flag merge as receipt (--no-art / --no-color before the subcommand).
			await runWrapped(parseWrappedFlags([...globalArgs, ...rest]));
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

		case 'doctor':
			// Merge global flags (like --no-art) that appeared before the subcommand.
			await runDoctor([...globalArgs, ...rest]);
			return;

		case 'sync':
			await runSync(rest);
			return;

		default:
			console.error(`chaching: unknown subcommand '${subcommand}'\n`);
			printUsage(argv);
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

	// Resolve no-art from the full argv + env (consistent with the TUI path).
	flags.noArt = noArt(argv);

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '--json') {
			flags.json = true;
		} else if (arg === '--no-art') {
			// already handled above via noArt(); skip so it doesn't fall through to unknown flag
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

/**
 * Parse `chaching wrapped` flags. Mirrors the receipt parser's discipline (unknown
 * flag → error + nonzero exit) and adds `--month YYYY-MM`. `--period` is accepted
 * for symmetry with the other commands but `month` is the only valid value — the
 * recap is inherently monthly, so any other period is rejected rather than silently
 * ignored.
 */
function parseWrappedFlags(argv: string[]): WrappedFlags {
	const flags: WrappedFlags = {};

	flags.noArt = noArt(argv);

	const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
	const setMonth = (m: string): void => {
		if (!MONTH_RE.test(m)) {
			console.error(`chaching wrapped: --month must be YYYY-MM (e.g. 2026-07), got '${m}'`);
			process.exit(1);
		}
		flags.month = m;
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '--json') {
			flags.json = true;
		} else if (arg === '--redact') {
			flags.redact = true;
		} else if (arg === '--no-art') {
			// already handled via noArt(); skip
		} else if (arg === '--png') {
			flags.png = true;
			const next = argv[i + 1];
			if (next && !next.startsWith('-')) {
				flags.pngPath = next;
				i++;
			}
		} else if (arg.startsWith('--png=')) {
			flags.png = true;
			const p = arg.slice('--png='.length);
			if (p) flags.pngPath = p;
		} else if (arg === '--month') {
			const m = argv[i + 1];
			if (!m || m.startsWith('--')) {
				console.error(`chaching wrapped: --month requires a value (YYYY-MM)`);
				process.exit(1);
			}
			i++;
			setMonth(m);
		} else if (arg.startsWith('--month=')) {
			const m = arg.slice('--month='.length);
			if (!m) {
				console.error(`chaching wrapped: --month requires a value (YYYY-MM)`);
				process.exit(1);
			}
			setMonth(m);
		} else if (arg === '--period') {
			const p = argv[i + 1];
			if (!p || p.startsWith('--')) {
				console.error(`chaching wrapped: --period requires a value (month)`);
				process.exit(1);
			}
			i++;
			if (p !== 'month') {
				console.error(`chaching wrapped: --period must be 'month' (the recap is monthly), got '${p}'`);
				process.exit(1);
			}
		} else if (arg.startsWith('--period=')) {
			const p = arg.slice('--period='.length);
			if (p !== 'month') {
				console.error(`chaching wrapped: --period must be 'month' (the recap is monthly), got '${p}'`);
				process.exit(1);
			}
		} else if (arg.startsWith('-')) {
			console.error(`chaching wrapped: unknown flag '${arg}'`);
			console.error(`Run \`chaching --help\` for usage.`);
			process.exit(1);
		}
	}

	return flags;
}

/**
 * Parse `chaching receipt` flags. Mirrors parseStatsFlags' period/provider
 * handling and adds --png [path], --reveal/--no-redact, --json. Unknown flag →
 * error + nonzero exit (same discipline as stats).
 */
function parseReceiptFlags(argv: string[]): ReceiptFlags {
	const flags: ReceiptFlags = {};
	const providers: string[] = [];

	flags.noArt = noArt(argv);

	const setPeriod = (p: string): void => {
		if (p === 'day' || p === 'week' || p === 'month' || p === 'quarter' || p === 'all') {
			// Store every value verbatim (including 'all'). The receipt command
			// treats an UNSET period as the monthly default; an explicit `--period all`
			// must therefore set 'all' so it can override that default.
			flags.period = p;
		} else {
			console.error(
				`chaching receipt: unknown period '${p}' (must be day|week|month|quarter|all)`
			);
			process.exit(1);
		}
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '--json') {
			flags.json = true;
		} else if (arg === '--redact') {
			// Opt IN to scrubbing username/hostname/paths before sharing.
			flags.redact = true;
		} else if (arg === '--reveal' || arg === '--no-redact') {
			// Deprecated no-ops: showing real details is now the default. Accepted so
			// old muscle-memory / scripts don't hard-error.
		} else if (arg === '--no-art') {
			// already handled via noArt(); skip
		} else if (arg === '--png') {
			flags.png = true;
			// optional value: a following non-flag token is the path
			const next = argv[i + 1];
			if (next && !next.startsWith('-')) {
				flags.pngPath = next;
				i++;
			}
		} else if (arg.startsWith('--png=')) {
			flags.png = true;
			const p = arg.slice('--png='.length);
			if (p) flags.pngPath = p;
		} else if (arg === '--period') {
			const p = argv[i + 1];
			if (!p || p.startsWith('--')) {
				console.error(`chaching receipt: --period requires a value (day|week|month|quarter|all)`);
				process.exit(1);
			}
			i++;
			setPeriod(p);
		} else if (arg.startsWith('--period=')) {
			const p = arg.slice('--period='.length);
			if (!p) {
				console.error(`chaching receipt: --period requires a value (day|week|month|quarter|all)`);
				process.exit(1);
			}
			setPeriod(p);
		} else if (arg === '--provider') {
			const raw = argv[i + 1];
			if (!raw || raw.startsWith('--')) {
				console.error(`chaching receipt: --provider requires a value`);
				process.exit(1);
			}
			i++;
			providers.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
		} else if (arg.startsWith('--provider=')) {
			const raw = arg.slice('--provider='.length);
			if (!raw) {
				console.error(`chaching receipt: --provider requires a value`);
				process.exit(1);
			}
			providers.push(...raw.split(',').map((s) => s.trim()).filter(Boolean));
		} else if (arg.startsWith('-')) {
			console.error(`chaching receipt: unknown flag '${arg}'`);
			console.error(`Run \`chaching --help\` for usage.`);
			process.exit(1);
		}
	}

	if (providers.length > 0) flags.providers = providers;

	return flags;
}
