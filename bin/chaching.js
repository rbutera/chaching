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

// ── 1. Prefer the CLI bundle ──────────────────────────────────────────────────
if (existsSync(cliEntry)) {
	await import(cliEntry);
	process.exit(0);
}

// ── 2. Legacy fallback: bare server boot (mirrors original behaviour) ─────────
// Reached only when dist/cli/ is missing (e.g. first `npm run build` without
// `build:cli`). Warn the user so they know to run the full build.
console.error('[chaching] CLI bundle not found at dist/cli/index.js.');
console.error('Run `npm run build:cli` (or `npm run build`) to build it.');
console.error('Falling back to direct server boot for `chaching serve`...\n');

if (!existsSync(buildEntry)) {
	console.error('[chaching] SvelteKit build artifact also missing. Run `npm run build`.');
	process.exit(1);
}

function configPath() {
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
	return join(configHome, 'chaching', 'config.json');
}

async function serverConfig() {
	try {
		const raw = await readFile(configPath(), 'utf8');
		const parsed = JSON.parse(raw);
		return typeof parsed?.server === 'object' && parsed.server !== null ? parsed.server : {};
	} catch {
		return {};
	}
}

const server = await serverConfig();
const configHost = typeof server.host === 'string' && server.host.length > 0 ? server.host : '0.0.0.0';
const configPort = Number.isInteger(server.port) && server.port > 0 ? String(server.port) : '5178';

process.env.HOST ??= configHost;
process.env.PORT ??= configPort;

await import(buildEntry);
