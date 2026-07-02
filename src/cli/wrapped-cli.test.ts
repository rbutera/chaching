// Subprocess smoke tests for `chaching wrapped` — routing, flags, --json shape,
// non-TTY pipe-safety, --no-art, --month validation, unknown-flag, help registration.

import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.setConfig({ testTimeout: 60_000 });

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cliBundle = join(root, 'dist', 'cli', 'index.js');

async function runCli(
	args: string[],
	opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await exec('node', [cliBundle, ...args], {
			timeout: 45_000,
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, ...opts.env }
		});
		return { stdout, stderr, code: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number };
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
	}
}

describe('wrapped — routing + help', () => {
	it('wrapped subcommand runs and exits 0', async () => {
		const { code, stdout } = await runCli(['wrapped', '--no-art']);
		expect(code).toBe(0);
		// either a real recap (THE HEADLINE) or the empty-state message
		expect(stdout).toMatch(/THE HEADLINE|no spend this month/);
	});

	it('wrapped appears in --help with its flags', async () => {
		const { stdout, code } = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdout).toContain('wrapped');
		expect(stdout).toContain('--month');
	});

	it('unknown wrapped flag → nonzero exit + usage hint', async () => {
		const { code, stderr } = await runCli(['wrapped', '--frobnicate']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/unknown flag|--help/i);
	});

	it('rejects a malformed --month and exits non-zero', async () => {
		const { code, stderr } = await runCli(['wrapped', '--month', '2026-13']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/YYYY-MM/);
	});

	it('rejects a non-month --period and exits non-zero', async () => {
		const { code, stderr } = await runCli(['wrapped', '--period', 'week']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/month/);
	});
});

describe('wrapped --json', () => {
	it('emits valid JSON with a wrapped model + _pricing, no art', async () => {
		const { stdout, code } = await runCli(['wrapped', '--json']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toHaveProperty('wrapped');
		expect(parsed).toHaveProperty('_pricing');
		expect(parsed.wrapped).toHaveProperty('headline');
		expect(parsed.wrapped).toHaveProperty('month');
		// art-free machine output: NO ANSI escapes, NO rendered box-rule lines
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
		expect(stdout).not.toContain('────');
		expect(stdout.trim().startsWith('{')).toBe(true);
		expect(stdout.trim().endsWith('}')).toBe(true);
	});

	it('--month scopes the recap to that calendar month', async () => {
		const { stdout, code } = await runCli(['wrapped', '--json', '--month', '2026-01']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.wrapped.month).toBe('2026-01');
		expect(parsed.wrapped.monthToDate).toBe(false);
	});
});

describe('wrapped — TTY discipline', () => {
	it('non-TTY (piped) output has no ANSI colour', async () => {
		const { stdout, code } = await runCli(['wrapped']);
		expect(code).toBe(0);
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
	});

	it('--redact is accepted and exits 0', async () => {
		const { code } = await runCli(['wrapped', '--no-art', '--redact']);
		expect(code).toBe(0);
	});
});
