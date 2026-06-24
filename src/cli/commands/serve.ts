// `chaching serve` — boots the built SvelteKit web server.
// Mirrors the original bin/chaching.js behaviour exactly.

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noArt, accent, dim } from '../theme/personality.js';
import { bannerLine } from '../tui/theme.js';
import { normalizeBasePath } from '../../lib/core/base-path.js';

function configPath(): string {
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
	return join(configHome, 'chaching', 'config.json');
}

async function serverConfig(): Promise<{ host?: string; port?: number; origin?: string }> {
	try {
		const raw = await readFile(configPath(), 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === 'object' && parsed !== null && 'server' in parsed
			&& typeof (parsed as Record<string, unknown>).server === 'object'
			&& (parsed as Record<string, unknown>).server !== null
			? (parsed as Record<string, unknown>).server as { host?: string; port?: number; origin?: string }
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

	// Public origin (adapter-node ORIGIN), e.g. behind a reverse proxy. An explicit
	// ORIGIN env wins; otherwise fall back to the config's `server.origin` if set.
	if ((process.env.ORIGIN == null || process.env.ORIGIN === '') && server.origin) {
		process.env.ORIGIN = server.origin;
	}

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

	const host = process.env.HOST;
	const port = process.env.PORT;
	// Base path (subpath) is baked in at build time; reflect it in the printed link so
	// the URL is actually reachable when chaching was built with CHACHING_BASE_PATH.
	const basePath = normalizeBasePath(process.env.CHACHING_BASE_PATH);
	// The URL we print + open. Prefer an explicit public ORIGIN; otherwise build from
	// host:port. A wildcard bind (0.0.0.0/::) has no meaningful "open" target, so we
	// surface localhost for the human-facing link.
	const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
	const origin = process.env.ORIGIN?.replace(/\/+$/, '') || `http://${displayHost}:${port}`;
	const url = `${origin}${basePath}`;

	printBanner(url);

	if (shouldAutoOpen(host)) {
		openInBrowser(url);
	}

	await import(buildEntry);
}

/** Branded startup banner + the "chaching dashboard → URL" line. */
function printBanner(url: string): void {
	const argv = process.argv.slice(2);
	if (!noArt(argv)) {
		const banner = bannerLine(false, process.stdout.columns ?? 80);
		if (banner) console.error(accent(banner));
	}
	console.error(`${dim('chaching dashboard →')} ${accent(url)}`);
}

/**
 * Decide whether to auto-open the dashboard in the default browser. GUARDED:
 *   - opt-out via --no-open / CHACHING_NO_OPEN
 *   - only on an interactive TTY (the always-on kinto serve is non-TTY → never opens)
 *   - only when bound to loopback (a 0.0.0.0 / tailnet / explicit-IP bind is "remote"
 *     and must NOT pop a browser on the host)
 *   - never with no display (CI / headless: no DISPLAY on linux, SSH session)
 */
export function shouldAutoOpen(
	host: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
	argv: string[] = process.argv.slice(2),
	isTTY: boolean = !!process.stdout.isTTY,
	os: NodeJS.Platform = platform()
): boolean {
	if (argv.includes('--no-open')) return false;
	if (env.CHACHING_NO_OPEN != null && env.CHACHING_NO_OPEN !== '') return false;
	if (!isTTY) return false;
	// Only a loopback bind is "local enough" to open a browser on this machine.
	const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
	if (!loopback) return false;
	// Headless guards: linux with no X display, or a non-interactive SSH session.
	if (os === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
	if (env.SSH_CONNECTION || env.SSH_TTY) return false;
	return true;
}

/** Open a URL in the default browser, cross-platform, with a tiny detached exec. */
function openInBrowser(url: string): void {
	const os = platform();
	const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
	const args = os === 'win32' ? ['/c', 'start', '""', url] : [url];
	try {
		const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
		child.on('error', () => {
			/* opening is best-effort — never crash serve over it */
		});
		child.unref();
	} catch {
		/* ignore — auto-open is a convenience, not a requirement */
	}
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
