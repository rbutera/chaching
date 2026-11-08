import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createCliFixture, type Fixture } from './cli-test-harness';

// Integration guard for a real regression: `node bin/chaching.js serve` used to
// (a) die immediately because the launcher force-exited after the CLI promise
// settled, and (b) fall through to the "CLI bundle not found" fallback because
// the fallback was sequential code, not an else-branch. Both shipped green
// because no test booted the actual binary in serve mode.

const root = process.env.CHACHING_PACKAGE_ROOT!;
const bin = join(root, 'bin', 'chaching.js');
const buildEntry = join(root, 'server', 'index.js');

// Hermetic seeded data root: `serve` cold-scans before it listens, and against a
// developer's real ~/.claude that took ~17s — far longer than the fixed 2s sleep
// this test used to wait, so it failed on data volume rather than on any bug.
const fx = createCliFixture();
afterAll(() => fx.cleanup());

/** Poll until `output` matches, instead of sleeping a fixed guess. */
async function waitFor(
	read: () => string,
	pattern: string,
	timeoutMs: number
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (read().includes(pattern)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}

describe('chaching serve (bin integration)', () => {
	it('stays alive on the primary path and never hits the CLI-missing fallback', async () => {
		// pretest builds dist/cli, so the primary path is always taken here.
		const port = 39000 + Math.floor(Math.random() * 2000);
		const child = spawn('node', [bin, 'serve'], {
			env: { ...process.env, ...fx.env, PORT: String(port), CHACHING_NO_ART: '1' },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (d) => (output += d.toString()));
		child.stderr.on('data', (d) => (output += d.toString()));

		try {
			if (existsSync(buildEntry)) {
				// Full build present: the server must come up and stay up (the
				// force-exit bug would have killed it). Poll rather than sleep so a
				// slow-but-correct boot isn't reported as a failure.
				const listening = await waitFor(() => output, 'Listening', 20_000);
				expect(output).not.toContain('CLI bundle not found');
				expect(listening).toBe(true);
				expect(child.exitCode).toBeNull();
			} else {
				// No SvelteKit build: we can still assert the fall-through bug is gone.
				await new Promise((r) => setTimeout(r, 2000));
				expect(output).not.toContain('CLI bundle not found');
			}
		} finally {
			child.kill('SIGKILL');
		}
	}, 30_000);
});

// Lifecycle guards for the always-on server (a systemd unit nobody browses):
// 1. the engine must start at boot, not on the first HTTP request, or a headless
//    machine never freezes history or publishes to its sync pool after a restart;
// 2. SIGTERM must end the process promptly. adapter-node's own handler only closes the
//    HTTP server, so the live engine's watchers, pollers and pool sockets used to keep
//    the process alive until the supervisor's SIGKILL (90 s under systemd).

/** A fixture whose config is rewritten with `patch` applied on top of the hermetic defaults. */
function lifecycleFixture(patch: (config: Record<string, unknown>, fx: Fixture) => void): Fixture {
	const fx = createCliFixture();
	const file = join(fx.env.XDG_CONFIG_HOME!, 'chaching', 'config.json');
	const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	patch(config, fx);
	writeFileSync(file, JSON.stringify(config, null, 2));
	return fx;
}

interface Served {
	child: ChildProcess;
	port: number;
	output: () => string;
	exited: Promise<number>;
}

async function startServe(fx: Fixture): Promise<Served> {
	const port = 41000 + Math.floor(Math.random() * 2000);
	const child = spawn('node', [bin, 'serve', '--no-art'], {
		env: { ...process.env, ...fx.env, PORT: String(port), CHACHING_NO_ART: '1', CHACHING_NO_OPEN: '1' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout!.on('data', (d) => (output += d.toString()));
	child.stderr!.on('data', (d) => (output += d.toString()));
	const exited = new Promise<number>((resolve) => child.once('exit', () => resolve(Date.now())));
	expect(await waitFor(() => output, 'Listening', 20_000)).toBe(true);
	return { child, port, output: () => output, exited };
}

function frozenDays(dbPath: string): number {
	if (!existsSync(dbPath)) return 0;
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const row = db.prepare('SELECT COUNT(DISTINCT day) AS n FROM day_model_agg').get() as { n: number } | undefined;
		return row?.n ?? 0;
	} catch {
		return 0; // schema not created yet
	} finally {
		db.close();
	}
}

describe.runIf(existsSync(buildEntry))('chaching serve lifecycle', () => {
	it('starts the engine at boot: past days freeze with no HTTP request made', async () => {
		const fx = lifecycleFixture((config, f) => {
			config.history = { enabled: true, dbPath: join(f.dir, 'history.db') };
		});
		const dbPath = join(fx.dir, 'history.db');
		const served = await startServe(fx);
		try {
			// The fixture seeds today plus two completed past days; only a cold scan freezes them.
			const deadline = Date.now() + 15_000;
			while (frozenDays(dbPath) < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
			expect(frozenDays(dbPath)).toBe(2);
		} finally {
			served.child.kill('SIGKILL');
			await served.exited;
			fx.cleanup();
		}
	}, 30_000);

	it('exits promptly on SIGTERM with a live engine, an open feed and an unreachable pool', async () => {
		const fx = lifecycleFixture((config) => {
			// Port 1 refuses: the boot connect fails and serve must degrade to local-only.
			config.sync = { enabled: true, databaseUrl: 'postgres://chaching:x@127.0.0.1:1/none', poolId: 'pool', machineId: 'machine' };
		});
		const served = await startServe(fx);
		try {
			// The dashboard still works local-only.
			const snapshot = await new Promise<number>((resolve, reject) => {
				request({ host: '127.0.0.1', port: served.port, path: '/api/snapshot' }, (res) => {
					res.resume();
					res.on('end', () => resolve(res.statusCode ?? 0));
				}).on('error', reject).end();
			});
			expect(snapshot).toBe(200);
			// An open SSE feed is the long-lived response that would hold the HTTP close open.
			let feedBytes = 0;
			const feed = request({ host: '127.0.0.1', port: served.port, path: '/api/feed' }, (res) => {
				res.on('data', (d: Buffer) => (feedBytes += d.length));
				res.on('error', () => {});
			});
			feed.on('error', () => {});
			feed.end();
			const feedDeadline = Date.now() + 10_000;
			while (feedBytes === 0 && Date.now() < feedDeadline) await new Promise((r) => setTimeout(r, 50));
			expect(feedBytes).toBeGreaterThan(0);

			const sent = Date.now();
			served.child.kill('SIGTERM');
			const exitedAt = await Promise.race([served.exited, new Promise<number>((r) => setTimeout(() => r(-1), 15_000))]);
			expect(exitedAt, `still running 15 s after SIGTERM:\n${served.output()}`).not.toBe(-1);
			expect(exitedAt - sent).toBeLessThan(5_000);
			expect(served.child.exitCode).toBe(0);
		} finally {
			served.child.kill('SIGKILL');
			fx.cleanup();
		}
	}, 45_000);
});
