import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliFixture } from './cli-test-harness';

// Integration guard for a real regression: `node bin/chaching.js serve` used to
// (a) die immediately because the launcher force-exited after the CLI promise
// settled, and (b) fall through to the "CLI bundle not found" fallback because
// the fallback was sequential code, not an else-branch. Both shipped green
// because no test booted the actual binary in serve mode.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = join(root, 'bin', 'chaching.js');
const buildEntry = join(root, 'build', 'index.js');

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
