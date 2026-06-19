#!/usr/bin/env node
// Thin launcher: dispatches to the built CLI (dist/cli/) for all subcommands,
// with a legacy fallback to `serve` so the old behaviour is preserved when the
// CLI bundle hasn't been built yet (e.g. after `npm run build` only builds SK).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(rootDir, 'dist', 'cli', 'index.js');
const buildEntry = join(rootDir, 'build', 'index.js');

// `serve` is the one long-running command whose work outlives the CLI promise:
// the imported adapter-node server starts listening and then the import resolves,
// so the listening socket keeps the process alive on its own. Every other command
// is one-shot, and the bundled graph (Ink/clack touch stdin at import) leaves a
// module-level handle that would otherwise stop the process exiting — so we force
// a clean exit for those, but NOT for `serve` (which must keep running).
const firstArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const isLongRunning = firstArg === 'serve';

// ── 1. Prefer the CLI bundle ──────────────────────────────────────────────────
if (existsSync(cliEntry)) {
	await import(cliEntry);
	// One-shot commands must be force-exited: the bundled graph (Ink/clack touch
	// stdin at import) leaves a module-level handle that blocks a natural exit.
	// `serve` is exempt — its listening socket keeps the process alive on its own.
	if (!isLongRunning) process.exit(0);
} else {
	// ── 2. Legacy fallback: bare server boot ─────────────────────────────────────
	// Reached only when dist/cli/ is missing (e.g. `npm run build:sk` without
	// `build:cli`). Warn the user so they know to run the full build.
	console.error('[chaching] CLI bundle not found at dist/cli/index.js.');
	console.error('Run `npm run build:cli` (or `npm run build`) to build it.');
	console.error('Falling back to direct server boot for `chaching serve`...\n');

	if (!existsSync(buildEntry)) {
		console.error('[chaching] SvelteKit build artifact also missing. Run `npm run build`.');
		process.exit(1);
	}

	const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
	const configFile = join(configHome, 'chaching', 'config.json');
	let server = {};
	try {
		const parsed = JSON.parse(await readFile(configFile, 'utf8'));
		if (typeof parsed?.server === 'object' && parsed.server !== null) server = parsed.server;
	} catch {
		// no config: use defaults
	}
	const configHost = typeof server.host === 'string' && server.host.length > 0 ? server.host : '0.0.0.0';
	const configPort = Number.isInteger(server.port) && server.port > 0 ? String(server.port) : '5178';
	process.env.HOST ??= configHost;
	process.env.PORT ??= configPort;

	await import(buildEntry);
}
