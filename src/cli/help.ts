// Version + usage text.

import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { noArt, wordmark } from './theme/personality.js';

export function packageVersion(): string {
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
  chaching wrapped       Your month in tokens: a Spotify-Wrapped-style recap
  chaching whatif        Counterfactual lab: reprice your usage under a different basis
  chaching serve         Start the web dashboard server
  chaching mcp           Start the read-only MCP server over stdio (for AI agent clients)
  chaching init          Run the setup wizard (re-runnable)
  chaching provider      Manage providers (add | enable | disable)
  chaching doctor        Diagnose why a provider isn't counting (health, staleness, pricing)
  chaching sync          Create/join a pooled PostgreSQL ledger, map accounts

Flags (global):
  --version, -v          Print version and exit
  --help, -h             Print this help and exit
  --no-art               Suppress ASCII art and decorative copy

Flags for stats:
  --period day|week|month|quarter|all  Rolling window (default: all time)
  --from YYYY-MM-DD --to YYYY-MM-DD  Inclusive date range
  --model <name> --machine <id> --account <id>  Repeatable scope filters
  --provider <name>        Filter to provider(s); repeatable or comma-separated
  --json                   Output only the raw JSON snapshot to stdout

Flags for receipt:
  --machine <id>          Filter usage by machine; retain shared Account fees
  --account <id>          Filter by Account; repeatable or comma-separated
  --from YYYY-MM-DD --to YYYY-MM-DD  Export an inclusive date range
  --model <name>           Filter usage by model; repeatable or comma-separated
  --period day|week|month|quarter|all  Aggregate by period (default: last 30 days)
  --provider <name>        Filter to provider(s); repeatable or comma-separated
  --json                   Machine-readable receipt model to stdout (art-free)
  --png [path]             Write a shareable PNG (default: ./chaching-receipt-<period>.png)
  --redact                 Scrub usernames/hosts/paths before sharing (default: shown)

Flags for wrapped:
  --month YYYY-MM          Recap that calendar month (default: current month-to-date)
  --json                   Machine-readable recap model to stdout (art-free)
  --png [path]             Write a shareable PNG (default: ./chaching-wrapped-<month>.png)
  --redact                 Scrub usernames/hosts/paths before sharing (default: shown)

Flags for whatif:
  --period day|week|month|quarter|all  Window to reprice (default: month)
  --model <id>             Alternate-model reprice target (default: derived from the window)
  --json                   Machine-readable scenario ledger to stdout (art-free)

Flags for doctor:
  --json                   Machine-readable report model to stdout (art-free)

Chaching Sync:
  CHACHING_DATABASE_URL=<url> chaching sync create --name <pool> [--machine <name>]
  CHACHING_DATABASE_URL=<url> chaching sync join --pool <id> [--machine <name>]
  chaching sync status [--json]
  chaching sync interval <minutes>   # publish cadence (>=1, default 15; higher = cheaper serverless)
  chaching sync account add --provider <name> --name <label>
      [--account <label>] [--tier <tier>] --monthly-usd <amount>
  chaching sync map --provider <name> --account <id|none> [--machine <id>]
  chaching sync leave

Examples:
  chaching stats --period week --provider codex
  chaching doctor                  # per-provider health + staleness + pricing
  chaching stats --json | jq .totals.cost
  chaching receipt                 # last 30 days (default)
  chaching receipt --period all
  chaching receipt --png receipt.png
  chaching wrapped                 # your month in tokens (month-to-date)
  chaching wrapped --month 2026-06 --png
  chaching serve
`);
}
