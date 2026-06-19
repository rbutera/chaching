import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = join(root, 'bin', 'chaching.js');

// Regression: the price-snapshot resolver used hardcoded relative paths that
// assumed cwd was the package root, so a GLOBAL `chaching` run from any other
// directory (the normal case) failed to load the snapshot — Codex/OpenAI spend
// silently went back to $0. The resolver must locate the snapshot from its own
// module location, independent of cwd.
describe('pricing snapshot resolves regardless of cwd', () => {
	it('loads the price snapshot when run from a foreign directory', async () => {
		// pretest builds dist/cli; the bundled CLI is what global installs run.
		const { stdout } = await run('node', [bin, 'stats', '--json'], {
			cwd: tmpdir(),
			env: { ...process.env, CHACHING_NO_ART: '1' },
			maxBuffer: 64 * 1024 * 1024
		});
		const data = JSON.parse(stdout);
		// _pricing proves the snapshot file was actually located + parsed from tmpdir.
		expect(data._pricing).toBeTruthy();
		expect(data._pricing.snapshotDate).toBeTruthy();
		expect(data._pricing.source).toBe('litellm');
	}, 60_000);

	it('ships the snapshot inside the package tree', () => {
		expect(existsSync(join(root, 'static', 'pricing', 'litellm-prices.json'))).toBe(true);
	});
});
