import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration guard for a real regression: `node bin/chaching.js serve` used to
// (a) die immediately because the launcher force-exited after the CLI promise
// settled, and (b) fall through to the "CLI bundle not found" fallback because
// the fallback was sequential code, not an else-branch. Both shipped green
// because no test booted the actual binary in serve mode.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = join(root, 'bin', 'chaching.js');
const buildEntry = join(root, 'build', 'index.js');

describe('chaching serve (bin integration)', () => {
	it('stays alive on the primary path and never hits the CLI-missing fallback', async () => {
		// pretest builds dist/cli, so the primary path is always taken here.
		const port = 39000 + Math.floor(Math.random() * 2000);
		const child = spawn('node', [bin, 'serve'], {
			env: { ...process.env, PORT: String(port), CHACHING_NO_ART: '1' },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (d) => (output += d.toString()));
		child.stderr.on('data', (d) => (output += d.toString()));

		try {
			await new Promise((r) => setTimeout(r, 2000));
			// The fall-through bug: serve must NOT emit the CLI-missing fallback when
			// dist/cli exists.
			expect(output).not.toContain('CLI bundle not found');

			if (existsSync(buildEntry)) {
				// Full build present: the server must be listening and the process
				// must still be running (the force-exit bug would have killed it).
				expect(child.exitCode).toBeNull();
				expect(output).toContain('Listening');
			}
		} finally {
			child.kill('SIGKILL');
		}
	}, 15000);
});
