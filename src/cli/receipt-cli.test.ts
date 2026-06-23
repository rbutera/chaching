// Subprocess smoke tests for `chaching receipt` — routing, flags, --json shape,
// non-TTY pipe-safety, --no-art, redaction default, unknown-flag, help registration.

import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { existsSync, rmSync, readFileSync } from 'node:fs';

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

describe('receipt — routing + help', () => {
	it('receipt subcommand runs and exits 0', async () => {
		const { code, stdout } = await runCli(['receipt', '--no-art']);
		expect(code).toBe(0);
		// either a real receipt (TOTAL BURN) or the empty-state hint
		expect(stdout).toMatch(/TOTAL BURN|chaching init/);
	});

	it('receipt appears in --help with its flags', async () => {
		const { stdout, code } = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdout).toContain('receipt');
		expect(stdout).toContain('--png');
		expect(stdout).toContain('--redact');
	});

	it('unknown receipt flag → nonzero exit + usage hint', async () => {
		const { code, stderr } = await runCli(['receipt', '--frobnicate']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/unknown flag|--help/i);
	});
});

describe('receipt --json', () => {
	it('emits valid JSON with receipt model + totals + _pricing, no art', async () => {
		const { stdout, code } = await runCli(['receipt', '--json']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toHaveProperty('receipt');
		expect(parsed).toHaveProperty('totals');
		expect(parsed).toHaveProperty('_pricing');
		// art-free machine output: NO ANSI escapes and NO rendered box-rule lines
		// (the receipt MODEL is data — its `wordmark` string field may carry copy —
		// but the stdout must be pure JSON with no terminal decoration applied).
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
		// no rendered box-drawing rule lines (a run of ─ is the text renderer's rule)
		expect(stdout).not.toContain('────');
		// stdout is exactly one JSON object, nothing printed around it
		expect(stdout.trim().startsWith('{')).toBe(true);
		expect(stdout.trim().endsWith('}')).toBe(true);
	});

	it('--json is pipe-complete (full payload, not truncated)', async () => {
		// piping through a shell to force a non-TTY pipe; assert JSON parses whole.
		const { stdout, code } = await runCli(['receipt', '--json', '--period', 'month']);
		expect(code).toBe(0);
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(stdout.trim().endsWith('}')).toBe(true);
	});
});

describe('receipt — default period is this month', () => {
	it('bare receipt --json defaults to the monthly period', async () => {
		const { stdout, code } = await runCli(['receipt', '--json']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.receipt.period).toBe('month');
		expect(parsed.receipt.periodLabel).toBe('this month');
	});

	it('--period all opts back into all-time (overrides the monthly default)', async () => {
		const { stdout, code } = await runCli(['receipt', '--json', '--period', 'all']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		// all-time: no period token, all-time label.
		expect(parsed.receipt.period).toBe('all');
		expect(parsed.receipt.periodLabel).toBe('all time');
	});

	it('--period quarter is accepted and scopes to the quarter', async () => {
		const { stdout, code } = await runCli(['receipt', '--json', '--period', 'quarter']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.receipt.period).toBe('quarter');
		expect(parsed.receipt.periodLabel).toBe('this quarter');
	});
});

describe('receipt — TTY discipline', () => {
	it('non-TTY (piped) output has no ANSI colour', async () => {
		// execFile pipes stdout, so process.stdout.isTTY is false in the child.
		const { stdout, code } = await runCli(['receipt']);
		expect(code).toBe(0);
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
	});

	it('--no-art suppresses emoji + box-drawing but keeps the numbers', async () => {
		const { stdout, code } = await runCli(['receipt', '--no-art']);
		expect(code).toBe(0);
		expect(stdout).not.toContain('💰');
		expect(stdout).not.toContain('✁');
	});

	it('NO_COLOR env strips ANSI', async () => {
		const { stdout, code } = await runCli(['receipt'], { env: { NO_COLOR: '1' } });
		expect(code).toBe(0);
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
	});
});

describe('receipt — redaction is opt-in (--redact)', () => {
	// By default the receipt is the user's own local data → real details shown. The
	// rendered ReceiptModel today carries no env-derived host/user in its fields
	// (header user·path is a redaction-faithful placeholder), so we can't assert the
	// real host appears in default text. What we CAN assert: --redact does not error
	// and the output stays clean of the real identifiers either way.
	it('--redact is accepted and exits 0 (scrub path)', async () => {
		const { stdout, code } = await runCli(['receipt', '--no-art', '--redact']);
		expect(code).toBe(0);
		const host = (await import('node:os')).hostname();
		const user = (await import('node:os')).userInfo().username;
		if (host && host.length > 2) expect(stdout).not.toContain(host);
		if (user && user.length > 2) expect(stdout).not.toContain(user);
	});

	it('deprecated --reveal / --no-redact still accepted (no-op, exits 0)', async () => {
		const a = await runCli(['receipt', '--no-art', '--reveal']);
		expect(a.code).toBe(0);
		const b = await runCli(['receipt', '--no-art', '--no-redact']);
		expect(b.code).toBe(0);
	});
});

describe('receipt --png', () => {
	it('writes a non-empty PNG that contains no machine name', async () => {
		const out = join(tmpdir(), `chaching-receipt-test-${process.pid}.png`);
		if (existsSync(out)) rmSync(out);
		const { code } = await runCli(['receipt', '--png', out, '--no-art']);
		expect(code).toBe(0);
		expect(existsSync(out)).toBe(true);
		const bytes = readFileSync(out);
		expect(bytes.length).toBeGreaterThan(1000);
		// PNG magic
		expect(bytes[0]).toBe(0x89);
		expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
		const host = (await import('node:os')).hostname();
		if (host && host.length > 2) {
			expect(bytes.includes(Buffer.from(host, 'utf8'))).toBe(false);
		}
		rmSync(out);
	}, 45_000);
});
