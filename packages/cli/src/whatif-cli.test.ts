// Subprocess smoke tests for `chaching whatif` — routing, flags, --json shape +
// cost-honesty invariants, --model targeting, --period validation, unknown-flag,
// NO_COLOR discipline, and help registration. Mirrors wrapped-cli.test.ts.

import { describe, it, expect, vi, afterAll } from 'vitest';
import {
	binLauncher,
	createCliFixture,
	runCliWith,
	runNode as runNodeWith
} from './cli-test-harness';

vi.setConfig({ testTimeout: 60_000 });

// Hermetic seeded data root: without it every spawn cold-scanned the developer's
// real ~/.claude (~17s each) and blew the execFile timeout under parallel load.
const fx = createCliFixture();
afterAll(() => fx.cleanup());

function runNode(
	entry: string,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
	return runNodeWith(entry, args, { ...opts, fixture: fx });
}

function runCli(
	args: string[],
	opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
	return runCliWith(fx, args, opts);
}

describe('whatif — routing + help', () => {
	it('whatif subcommand runs and exits 0', async () => {
		const { code, stdout } = await runCli(['whatif', '--no-art']);
		expect(code).toBe(0);
		// The fixture seeds priced spend, so this must be a REAL ledger. (Before the
		// fixture this was `counterfactual lab|no data found` because the outcome
		// depended on the developer's machine — it passed either way.)
		expect(stdout).toContain('counterfactual lab');
		expect(stdout).not.toContain('no data found');
	});

	it('runs through the real bin/chaching.js launcher and force-exits cleanly', async () => {
		// Exercises the launcher (not just dist/cli/index.js): the one-shot force-exit
		// path must let `whatif` finish and exit 0, so a launcher regression is caught.
		const { code, stdout } = await runNode(binLauncher, ['whatif', '--no-art']);
		expect(code).toBe(0);
		expect(stdout).toContain('counterfactual lab');
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
		// Guard the loop below: on an empty result set every assertion inside it is
		// skipped and the test passes without checking anything.
		expect((parsed.results as unknown[]).length).toBeGreaterThan(0);
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
		// With the seeded fixture the alt-model scenario is always produced, so this
		// is asserted outright rather than behind an `if (alt)` that skipped silently.
		const alt = (parsed.results as Array<Record<string, unknown>>).find(
			(r) => r.kind === 'alt-model'
		);
		expect(alt).toBeDefined();
		expect(alt!.id).toBe('alt-model:claude-haiku-4-5');
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
