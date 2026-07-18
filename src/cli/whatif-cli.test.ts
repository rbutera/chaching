// Subprocess smoke tests for `chaching whatif` — routing, flags, --json shape +
// cost-honesty invariants, --model targeting, --period validation, unknown-flag,
// NO_COLOR discipline, and help registration. Mirrors wrapped-cli.test.ts.

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

describe('whatif — routing + help', () => {
	it('whatif subcommand runs and exits 0', async () => {
		const { code, stdout } = await runCli(['whatif', '--no-art']);
		expect(code).toBe(0);
		// either a real ledger (the region header) or the friendly empty state
		expect(stdout).toMatch(/counterfactual lab|no data found/);
	});

	it('whatif appears in --help with its flags', async () => {
		const { stdout, code } = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdout).toContain('whatif');
		expect(stdout).toContain('--model');
	});

	it('unknown whatif flag → nonzero exit + usage hint', async () => {
		const { code, stderr } = await runCli(['whatif', '--frobnicate']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/unknown flag|--help/i);
	});

	it('rejects a bad --period and exits non-zero', async () => {
		const { code, stderr } = await runCli(['whatif', '--period', 'fortnight']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/day\|week\|month\|quarter\|all/);
	});

	it('--model with no value exits non-zero', async () => {
		const { code, stderr } = await runCli(['whatif', '--model']);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/--model requires a value/);
	});
});

describe('whatif --json', () => {
	it('emits valid JSON with window + results + the honesty label, no art', async () => {
		const { stdout, code } = await runCli(['whatif', '--json', '--period', 'month']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toHaveProperty('window');
		expect(parsed).toHaveProperty('results');
		expect(parsed).toHaveProperty('actual');
		expect(parsed.window).toHaveProperty('from');
		expect(parsed.window).toHaveProperty('to');
		expect(parsed.label).toContain('Price-only counterfactual');
		// art-free machine output: NO ANSI escapes, pure JSON.
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
		expect(stdout.trim().startsWith('{')).toBe(true);
		expect(stdout.trim().endsWith('}')).toBe(true);
	});

	it('every result carries the price-only label and honest null-or-number totals', async () => {
		const { stdout, code } = await runCli(['whatif', '--json', '--period', 'month']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		for (const r of parsed.results as Array<Record<string, unknown>>) {
			// mandatory honesty label on every scenario
			expect((r.notes as string[]).some((n) => n.includes('Price-only counterfactual'))).toBe(true);
			// cost-honesty: totals are a number or null (never a fabricated 0-as-string, never NaN)
			for (const k of ['totalUsd', 'actualUsd', 'deltaUsd']) {
				const v = r[k];
				expect(v === null || typeof v === 'number').toBe(true);
				if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
			}
			// a null total is a WHOLE-triple null (unavailable), never a half-fabricated delta
			if (r.totalUsd === null) {
				expect(r.actualUsd).toBeNull();
				expect(r.deltaUsd).toBeNull();
			}
		}
	});

	it('--model targets the requested alternate model', async () => {
		const { stdout, code } = await runCli([
			'whatif',
			'--json',
			'--period',
			'month',
			'--model',
			'claude-haiku-4-5'
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.targetModel).toBe('claude-haiku-4-5');
		const alt = (parsed.results as Array<Record<string, unknown>>).find(
			(r) => r.kind === 'alt-model'
		);
		if (alt) expect(alt.id).toBe('alt-model:claude-haiku-4-5');
	});
});

describe('whatif — colour discipline', () => {
	it('NO_COLOR strips ANSI from the human ledger', async () => {
		const { stdout, code } = await runCli(['whatif', '--period', 'month'], {
			env: { NO_COLOR: '1' }
		});
		expect(code).toBe(0);
		// eslint-disable-next-line no-control-regex
		expect(stdout).not.toMatch(/\x1b\[/);
	});
});
