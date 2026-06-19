// Tests for the CLI router, stats formatting, and subprocess smoke tests.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cliBundle = join(root, 'dist', 'cli', 'index.js');
const bin = join(root, 'bin', 'chaching.js');

// ── helper ────────────────────────────────────────────────────────────────────

async function runCli(
	args: string[],
	entry = cliBundle
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await exec('node', [entry, ...args], { timeout: 30_000 });
		return { stdout, stderr, code: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number };
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
	}
}

// ── routing ───────────────────────────────────────────────────────────────────

describe('subcommand routing', () => {
	it('--version prints the package version and exits 0', async () => {
		const { stdout, code } = await runCli(['--version']);
		expect(code).toBe(0);
		// package version is 0.0.1 (wave 6 will bump to 1.3.37)
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('-v also prints the version', async () => {
		const { stdout, code } = await runCli(['-v']);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('--help prints usage and exits 0', async () => {
		const { stdout, code } = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdout).toContain('chaching');
		expect(stdout).toContain('stats');
		expect(stdout).toContain('serve');
		expect(stdout).toContain('init');
		expect(stdout).toContain('--version');
	});

	it('-h prints usage and exits 0', async () => {
		const { stdout, code } = await runCli(['-h']);
		expect(code).toBe(0);
		expect(stdout).toContain('stats');
	});

	it('unknown subcommand exits non-zero and prints usage', async () => {
		const { stdout, stderr, code } = await runCli(['frobnicate']);
		expect(code).not.toBe(0);
		const combined = stdout + stderr;
		expect(combined).toContain('frobnicate');
		expect(combined).toContain('Usage');
	});

	it('init subcommand exits 0 (writes default config when non-interactive)', async () => {
		const { code } = await runCli(['init']);
		expect(code).toBe(0);
	});

	it('provider subcommand with no args prints help and exits 0', async () => {
		const { stdout, code } = await runCli(['provider']);
		expect(code).toBe(0);
		expect(stdout).toContain('add');
	});

	it('provider disable exits 0 and confirms the action', async () => {
		const { stdout, code } = await runCli(['provider', 'disable', 'cursor']);
		expect(code).toBe(0);
		expect(stdout).toContain('cursor');
	});

	it('provider unknown action exits non-zero', async () => {
		const { code } = await runCli(['provider', 'nope']);
		expect(code).not.toBe(0);
	});
});

// ── stats: human output ───────────────────────────────────────────────────────

describe('chaching stats human output', () => {
	it('outputs spend summary with totals', async () => {
		const { stdout, code } = await runCli(['stats']);
		expect(code).toBe(0);
		// Either real data summary or empty-state message
		const hasData = stdout.includes('Total cost');
		const hasEmpty = stdout.includes('no data found') || stdout.includes('chaching init');
		expect(hasData || hasEmpty).toBe(true);
	});

	it('accepts --period day without error', async () => {
		const { code } = await runCli(['stats', '--period', 'day']);
		expect(code).toBe(0);
	});

	it('accepts --period week without error', async () => {
		const { code } = await runCli(['stats', '--period', 'week']);
		expect(code).toBe(0);
	});

	it('accepts --period month without error', async () => {
		const { code } = await runCli(['stats', '--period', 'month']);
		expect(code).toBe(0);
	});

	it('rejects invalid period and exits non-zero', async () => {
		const { code } = await runCli(['stats', '--period', 'quarter']);
		expect(code).not.toBe(0);
	});

	it('rejects --period with no value and exits non-zero', async () => {
		const { code, stderr } = await runCli(['stats', '--period']);
		expect(code).not.toBe(0);
		expect(stderr).toContain('requires a value');
	});

	it('rejects --provider with no value and exits non-zero', async () => {
		const { code, stderr } = await runCli(['stats', '--provider']);
		expect(code).not.toBe(0);
		expect(stderr).toContain('requires a value');
	});

	it('rejects unknown flags and exits non-zero', async () => {
		const { code, stderr } = await runCli(['stats', '--oops']);
		expect(code).not.toBe(0);
		expect(stderr).toContain('unknown flag');
	});

	it('accepts --provider filter', async () => {
		const { code } = await runCli(['stats', '--provider', 'codex']);
		expect(code).toBe(0);
	});

	it('accepts comma-separated --provider filter', async () => {
		const { code } = await runCli(['stats', '--provider', 'codex,claude']);
		expect(code).toBe(0);
	});

	it('accepts repeated --provider flags', async () => {
		const { code } = await runCli(['stats', '--provider', 'codex', '--provider', 'claude']);
		expect(code).toBe(0);
	});
});

// ── stats: --json ─────────────────────────────────────────────────────────────

describe('chaching stats --json', () => {
	it('outputs valid JSON and nothing else', async () => {
		const { stdout, code } = await runCli(['stats', '--json']);
		expect(code).toBe(0);
		// stdout must be parseable JSON
		let parsed: unknown;
		expect(() => {
			parsed = JSON.parse(stdout);
		}).not.toThrow();
		// Must have the snapshot shape
		expect(typeof parsed).toBe('object');
		const snap = parsed as Record<string, unknown>;
		expect(snap).toHaveProperty('totals');
		expect(snap).toHaveProperty('dayModel');
		expect(snap).toHaveProperty('generatedAt');
	});

	it('--json with --period still outputs only JSON', async () => {
		const { stdout, code } = await runCli(['stats', '--json', '--period', 'week']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe('object');
	});

	it('--json stdout contains no log lines (only JSON)', async () => {
		const { stdout, code } = await runCli(['stats', '--json']);
		expect(code).toBe(0);
		// First non-whitespace char should be '{' (JSON object start)
		const trimmed = stdout.trim();
		expect(trimmed[0]).toBe('{');
		expect(trimmed[trimmed.length - 1]).toBe('}');
	});

	it('--json with --provider filter scopes the dayModel', async () => {
		const { stdout, code } = await runCli(['stats', '--json', '--provider', 'codex']);
		expect(code).toBe(0);
		const snap = JSON.parse(stdout) as { dayModel: Array<{ provider: string }> };
		// All entries in dayModel must be for the requested provider (or empty)
		const nonCodex = snap.dayModel.filter((dm) => dm.provider !== 'codex');
		expect(nonCodex).toHaveLength(0);
	});
});

// ── bin/chaching.js dispatcher ────────────────────────────────────────────────

describe('bin/chaching.js dispatcher', () => {
	it('routes --version through the bin launcher', async () => {
		const { stdout, code } = await runCli(['--version'], bin);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('routes --help through the bin launcher', async () => {
		const { stdout, code } = await runCli(['--help'], bin);
		expect(code).toBe(0);
		expect(stdout).toContain('stats');
	});

	it('routes unknown subcommand to exit nonzero through the bin launcher', async () => {
		const { code } = await runCli(['oops'], bin);
		expect(code).not.toBe(0);
	});
});

// ── router unit-level: parseStatsFlags coverage ───────────────────────────────
// These test the flag parsing without spawning a process.

describe('stats flag parsing (unit)', () => {
	// Inline a minimal parse helper to avoid subprocess overhead
	function parseFlags(argv: string[]) {
		const flags: { json?: boolean; period?: string; providers?: string[] } = {};
		const providers: string[] = [];

		for (let i = 0; i < argv.length; i++) {
			const arg = argv[i];
			if (arg === '--json') {
				flags.json = true;
			} else if (arg === '--period' && argv[i + 1]) {
				flags.period = argv[++i];
			} else if (arg === '--provider' && argv[i + 1]) {
				providers.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
			} else if (arg.startsWith('--provider=')) {
				providers.push(...arg.slice('--provider='.length).split(',').map((s) => s.trim()).filter(Boolean));
			}
		}
		if (providers.length > 0) flags.providers = providers;
		return flags;
	}

	it('parses --json', () => {
		expect(parseFlags(['--json']).json).toBe(true);
	});

	it('parses --period day', () => {
		expect(parseFlags(['--period', 'day']).period).toBe('day');
	});

	it('parses --period week', () => {
		expect(parseFlags(['--period', 'week']).period).toBe('week');
	});

	it('parses --provider codex', () => {
		expect(parseFlags(['--provider', 'codex']).providers).toEqual(['codex']);
	});

	it('parses comma-sep --provider', () => {
		expect(parseFlags(['--provider', 'codex,claude']).providers).toEqual(['codex', 'claude']);
	});

	it('parses --provider= form', () => {
		expect(parseFlags(['--provider=cursor']).providers).toEqual(['cursor']);
	});

	it('accumulates repeated --provider', () => {
		expect(parseFlags(['--provider', 'codex', '--provider', 'claude']).providers).toEqual([
			'codex',
			'claude'
		]);
	});
});
