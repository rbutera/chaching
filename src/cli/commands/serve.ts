// `chaching serve` — boots the built SvelteKit web server.
// Mirrors the original bin/chaching.js behaviour exactly.

import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function configPath(): string {
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
	return join(configHome, 'chaching', 'config.json');
}

async function serverConfig(): Promise<{ host?: string; port?: number }> {
	try {
		const raw = await readFile(configPath(), 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === 'object' && parsed !== null && 'server' in parsed
			&& typeof (parsed as Record<string, unknown>).server === 'object'
			&& (parsed as Record<string, unknown>).server !== null
			? (parsed as Record<string, unknown>).server as { host?: string; port?: number }
			: {};
	} catch {
		return {};
	}
}

/** Resolve the package root from within dist/cli/ or src/cli/.
 *  dist/cli/index.js → dist/cli/ → dist/ → <root>  (2 levels)
 *  src/cli/serve.ts  → src/cli/  → src/  → <root>  (2 levels)
 */
function packageRoot(): string {
	const here = typeof __dirname !== 'undefined'
		? __dirname
		: dirname(fileURLToPath(import.meta.url));
	return join(here, '..', '..');
}

export async function runServe(): Promise<void> {
	const rootDir = packageRoot();
	const buildEntry = join(rootDir, 'build', 'index.js');

	if (!existsSync(buildEntry)) {
		console.error('chaching: build artifact missing. Run `npm run build` before `chaching serve`.');
		process.exit(1);
	}

	const server = await serverConfig();
	const configHost = typeof server.host === 'string' && server.host.length > 0
		? server.host
		: '0.0.0.0';
	const configPort = typeof server.port === 'number' && server.port > 0
		? String(server.port)
		: '5178';

	process.env.HOST ??= configHost;

	// Honour an explicit PORT, otherwise start at the configured port and walk up
	// to the first free one so `serve` never dies on "address in use".
	if (process.env.PORT == null) {
		const desired = Number(configPort);
		const port = await firstFreePort(desired, process.env.HOST);
		if (port !== desired) {
			console.error(`chaching: port ${desired} is in use, using ${port} instead.`);
		}
		process.env.PORT = String(port);
	}

	await import(buildEntry);
}

/** First free TCP port at or above `start` (bounded), probing on `host`. */
export async function firstFreePort(start: number, host = '0.0.0.0', attempts = 100): Promise<number> {
	for (let port = start; port < start + attempts; port++) {
		if (await isPortFree(port, host)) return port;
	}
	// give up gracefully: let the OS assign an ephemeral port
	return 0;
}

function isPortFree(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once('error', () => resolve(false));
		probe.listen(port, host, () => probe.close(() => resolve(true)));
	});
}
