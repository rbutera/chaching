#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildEntry = join(rootDir, 'build', 'index.js');

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

if (!existsSync(buildEntry)) {
	console.error('chaching build artifact is missing. Run `npm run build` before `chaching`.');
	process.exit(1);
}

const server = await serverConfig();
const configHost = typeof server.host === 'string' && server.host.length > 0 ? server.host : '0.0.0.0';
const configPort = Number.isInteger(server.port) && server.port > 0 ? String(server.port) : '5178';

process.env.HOST ??= configHost;
process.env.PORT ??= configPort;

await import(buildEntry);
