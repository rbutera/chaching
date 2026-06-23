// Version + usage text.

import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { noArt, wordmark } from './theme/personality.js';

function packageVersion(): string {
	try {
		// Walk up from dist/cli/ or src/cli/ to package root.
		const here = typeof __dirname !== 'undefined'
			? __dirname
			: dirname(fileURLToPath(import.meta.url));
		// Try up to 4 levels
		for (let depth = 0; depth <= 4; depth++) {
			const candidate = join(here, ...Array(depth).fill('..'), 'package.json');
			try {
				const raw = readFileSync(candidate, 'utf8');
				const parsed = JSON.parse(raw) as { version?: string };
				if (parsed.version) return parsed.version;
			} catch {
				// keep going
			}
		}
	} catch {
		// ignore
	}
	return '0.0.0';
}

export function printVersion(): void {
	console.log(packageVersion());
}

export function printUsage(argv: string[] = process.argv.slice(2)): void {
	const isNoArt = noArt(argv);
	const wm = wordmark({ noArt: isNoArt });

	if (wm) {
		console.log('');
		console.log(`  ${wm}`);
		console.log('');
	}

	console.log(`${isNoArt ? 'chaching' : ''} multi-provider AI token spend dashboard

Usage:
  chaching               Open the TUI dashboard (or run wizard on first launch)
  chaching stats         One-shot summary: totals, per-provider, per-model
  chaching receipt       Print your spend as a branded thermal receipt
  chaching serve         Start the web dashboard server
  chaching init          Run the setup wizard (re-runnable)
  chaching provider      Manage providers (add | enable | disable)

Flags (global):
  --version, -v          Print version and exit
  --help, -h             Print this help and exit
  --no-art               Suppress ASCII art and decorative copy

Flags for stats:
  --period day|week|month  Aggregate by period (default: all time)
  --provider <name>        Filter to provider(s); repeatable or comma-separated
  --json                   Output only the raw JSON snapshot to stdout

Flags for receipt:
  --period day|week|month|quarter|all  Aggregate by period (default: this month)
  --provider <name>        Filter to provider(s); repeatable or comma-separated
  --json                   Machine-readable receipt model to stdout (art-free)
  --png [path]             Write a shareable PNG (default: ./chaching-receipt-<period>.png)
  --redact                 Scrub usernames/hosts/paths before sharing (default: shown)

Examples:
  chaching stats --period week --provider codex
  chaching stats --json | jq .totals.cost
  chaching receipt                 # this month (default)
  chaching receipt --period all
  chaching receipt --png receipt.png
  chaching serve
`);
}
