/**
 * Tests for the chaching personality module.
 *
 * Covers:
 * - Banner shown by default, suppressed under --no-art and CHACHING_NO_ART
 * - Narrow-terminal compact banner fallback
 * - Scanning / empty / error line rotation
 * - Big-spend flourish thresholds
 * - stats --json emits pure JSON with no art bytes (subprocess)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	noArt,
	noColor,
	accent,
	banner,
	wordmark,
	scanningLine,
	emptyLine,
	errorLine,
	flourishFor,
	formatFlourish,
	pick,
	BANNER_FULL,
	BANNER_COMPACT,
	WORDMARK,
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
} from './personality.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const cliBundle = join(root, 'dist', 'cli', 'index.js');

async function runCli(
	args: string[],
	env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await exec('node', [cliBundle, ...args], {
			timeout: 30_000,
			env: { ...process.env, ...env }
		});
		return { stdout, stderr, code: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number };
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
	}
}

// ── noArt() ───────────────────────────────────────────────────────────────────

describe('noArt()', () => {
	const savedEnv: Record<string, string | undefined> = {};

	afterEach(() => {
		// Restore env
		for (const key of Object.keys(savedEnv)) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
	});

	it('returns false by default', () => {
		savedEnv.CHACHING_NO_ART = process.env.CHACHING_NO_ART;
		delete process.env.CHACHING_NO_ART;
		expect(noArt([], {})).toBe(false);
	});

	it('returns true when --no-art in argv', () => {
		expect(noArt(['--no-art'], {})).toBe(true);
	});

	it('returns true when CHACHING_NO_ART is set', () => {
		expect(noArt([], { CHACHING_NO_ART: '1' })).toBe(true);
	});

	it('returns false when CHACHING_NO_ART is empty string', () => {
		expect(noArt([], { CHACHING_NO_ART: '' })).toBe(false);
	});
});

// ── noColor() ─────────────────────────────────────────────────────────────────

describe('noColor()', () => {
	it('returns true when NO_COLOR is set', () => {
		expect(noColor({ NO_COLOR: '1' })).toBe(true);
	});

	it('returns false when NO_COLOR is absent', () => {
		expect(noColor({})).toBe(false);
	});

	it('returns false when NO_COLOR is empty string', () => {
		expect(noColor({ NO_COLOR: '' })).toBe(false);
	});
});

// ── banner() ──────────────────────────────────────────────────────────────────

describe('banner()', () => {
	it('returns non-null by default (art on)', () => {
		const result = banner({ noArt: false, env: {} });
		expect(result).not.toBeNull();
		expect(result).toBeTruthy();
	});

	it('returns null when noArt=true', () => {
		expect(banner({ noArt: true, env: {} })).toBeNull();
	});

	it('returns null when CHACHING_NO_ART env is set', () => {
		expect(banner({ env: { CHACHING_NO_ART: '1' } })).toBeNull();
	});

	it('env CHACHING_NO_ART wins even when noArt:false is passed explicitly', () => {
		// noArt:false must NOT override the env flag — suppression is absolute
		expect(banner({ noArt: false, env: { CHACHING_NO_ART: '1' } })).toBeNull();
	});

	it('returns BANNER_FULL at ≥72 columns', () => {
		const result = banner({ noArt: false, columns: 80, env: {} });
		// Strip ANSI before checking content
		const plain = result!.replace(/\x1b\[[0-9;]*m/g, '');
		expect(plain.trim()).toBe(BANNER_FULL.trim());
	});

	it('returns BANNER_COMPACT at <72 columns (narrow terminal fallback)', () => {
		const result = banner({ noArt: false, columns: 60, env: {} });
		const plain = result!.replace(/\x1b\[[0-9;]*m/g, '');
		expect(plain.trim()).toBe(BANNER_COMPACT.trim());
	});

	it('returns plain text (no ANSI escapes) when NO_COLOR is set', () => {
		const result = banner({ noArt: false, columns: 80, env: { NO_COLOR: '1' } });
		// Should have no ANSI color codes
		expect(result).not.toMatch(/\x1b\[/);
		expect(result!.trim()).toBe(BANNER_FULL.trim());
	});
});

// ── wordmark() ────────────────────────────────────────────────────────────────

describe('wordmark()', () => {
	it('returns the wordmark string when art is on', () => {
		const result = wordmark({ noArt: false, env: {} });
		expect(result).not.toBeNull();
		const plain = result!.replace(/\x1b\[[0-9;]*m/g, '');
		expect(plain).toBe(WORDMARK);
	});

	it('returns null when art is suppressed', () => {
		expect(wordmark({ noArt: true, env: {} })).toBeNull();
	});

	it('returns plain text when NO_COLOR', () => {
		const result = wordmark({ noArt: false, env: { NO_COLOR: '1' } });
		expect(result).toBe(WORDMARK);
	});
});

// ── accent() (register-gold) ────────────────────────────────────────────────────

describe('accent()', () => {
	it('wraps text in a 24-bit truecolor escape for brass #e0a52f', () => {
		const out = accent('x', {} as NodeJS.ProcessEnv);
		expect(out).toBe('\x1b[38;2;224;165;47mx\x1b[0m');
	});

	it('falls back to the curated 16-color SGR (yellow) on the basic tier', () => {
		const out = accent('x', {} as NodeJS.ProcessEnv, 'basic');
		expect(out).toBe('\x1b[33mx\x1b[0m');
	});

	it('returns plain text under NO_COLOR in either tier (quiet-mode preserved)', () => {
		expect(accent('x', { NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv)).toBe('x');
		expect(accent('x', { NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv, 'basic')).toBe('x');
	});
});

// ── rotating copy ─────────────────────────────────────────────────────────────

describe('rotating copy', () => {
	it('pick() cycles through the array by index', () => {
		const items = ['a', 'b', 'c'] as const;
		expect(pick(items, 0)).toBe('a');
		expect(pick(items, 1)).toBe('b');
		expect(pick(items, 2)).toBe('c');
		expect(pick(items, 3)).toBe('a'); // wraps
	});

	it('scanningLine() returns a string from SCANNING_LINES', () => {
		for (let i = 0; i < SCANNING_LINES.length; i++) {
			expect(SCANNING_LINES).toContain(scanningLine(i));
		}
	});

	it('emptyLine() returns a string from EMPTY_LINES', () => {
		for (let i = 0; i < EMPTY_LINES.length; i++) {
			expect(EMPTY_LINES).toContain(emptyLine(i));
		}
	});

	it('errorLine() returns a string from ERROR_LINES', () => {
		for (let i = 0; i < ERROR_LINES.length; i++) {
			expect(ERROR_LINES).toContain(errorLine(i));
		}
	});
});

// ── big-spend flourishes ──────────────────────────────────────────────────────

describe('flourishFor() — block spend', () => {
	it('returns the zero tier (no decoration) below the first threshold', () => {
		const f = flourishFor(0, BLOCK_FLOURISHES);
		expect(f.emoji).toBe('');
		expect(f.remark).toBe('');
	});

	it('returns the first active tier at $10', () => {
		const f = flourishFor(10, BLOCK_FLOURISHES);
		expect(f.threshold).toBe(10);
		expect(f.emoji).toContain('💸');
	});

	it('escalates at $30', () => {
		const f30 = flourishFor(30, BLOCK_FLOURISHES);
		const f10 = flourishFor(10, BLOCK_FLOURISHES);
		expect(f30.threshold).toBeGreaterThan(f10.threshold);
	});

	it('reaches fire tier at $75', () => {
		const f = flourishFor(75, BLOCK_FLOURISHES);
		expect(f.emoji).toContain('🔥');
	});

	it('returns the highest tier above max threshold', () => {
		const f = flourishFor(999, BLOCK_FLOURISHES);
		const maxTier = BLOCK_FLOURISHES[BLOCK_FLOURISHES.length - 1];
		expect(f).toEqual(maxTier);
	});

	it('does not trigger the first threshold below it', () => {
		const f = flourishFor(9.99, BLOCK_FLOURISHES);
		expect(f.emoji).toBe('');
	});
});

describe('flourishFor() — daily spend', () => {
	it('no decoration below first threshold', () => {
		expect(flourishFor(5, DAILY_FLOURISHES).emoji).toBe('');
	});

	it('first tier at $20', () => {
		expect(flourishFor(20, DAILY_FLOURISHES).threshold).toBe(20);
	});

	it('escalates through tiers', () => {
		const t20 = flourishFor(20, DAILY_FLOURISHES).threshold;
		const t50 = flourishFor(50, DAILY_FLOURISHES).threshold;
		const t100 = flourishFor(100, DAILY_FLOURISHES).threshold;
		expect(t50).toBeGreaterThan(t20);
		expect(t100).toBeGreaterThan(t50);
	});
});

describe('flourishFor() — lifetime spend', () => {
	it('no decoration below $100', () => {
		expect(flourishFor(50, LIFETIME_FLOURISHES).emoji).toBe('');
	});

	it('first tier at $100', () => {
		expect(flourishFor(100, LIFETIME_FLOURISHES).threshold).toBe(100);
	});

	it('send-help tier at $5000', () => {
		const f = flourishFor(5000, LIFETIME_FLOURISHES);
		expect(f.emoji).toContain('🚨');
	});
});

describe('formatFlourish()', () => {
	it('returns empty string for the zero tier', () => {
		const f = flourishFor(0, BLOCK_FLOURISHES);
		expect(formatFlourish(f, {})).toBe('');
	});

	it('formats a non-zero tier as "emoji remark"', () => {
		const f = flourishFor(10, BLOCK_FLOURISHES);
		const result = formatFlourish(f, {});
		// Should contain both emoji and remark
		expect(result).toContain(f.emoji);
		expect(result).toContain(f.remark);
	});

	it('no ANSI escapes when NO_COLOR is set', () => {
		const f = flourishFor(10, BLOCK_FLOURISHES);
		const result = formatFlourish(f, { NO_COLOR: '1' });
		expect(result).not.toMatch(/\x1b\[/);
	});
});

// ── subprocess: stats --json contains ZERO art ─────────────────────────────
// These tests spawn the real CLI binary; give them generous individual timeouts.

describe('stats --json output is pure JSON', () => {
	it('first char is { (no banner/art bytes)', async () => {
		const { stdout, code } = await runCli(['stats', '--json']);
		expect(code).toBe(0);
		const trimmed = stdout.trim();
		expect(trimmed[0]).toBe('{');
		expect(trimmed[trimmed.length - 1]).toBe('}');
	}, 60_000);

	it('--json output is parseable as JSON', async () => {
		const { stdout, code } = await runCli(['stats', '--json']);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe('object');
	}, 60_000);

	it('--json output contains no art even with CHACHING_NO_ART unset', async () => {
		// No-art env is NOT set here; --json must suppress art independently
		const { stdout, code } = await runCli(['stats', '--json'], {
			CHACHING_NO_ART: ''
		});
		expect(code).toBe(0);
		const trimmed = stdout.trim();
		expect(trimmed[0]).toBe('{');
	}, 60_000);
});

// ── subprocess: --no-art suppresses art in stats human output ────────────────

describe('stats --no-art suppression', () => {
	it('stats --no-art exits 0', async () => {
		const { code } = await runCli(['stats', '--no-art']);
		expect(code).toBe(0);
	}, 60_000);

	it('stats output with art contains wordmark (by default)', async () => {
		const { stdout, code } = await runCli(['stats'], {
			NO_COLOR: '1' // strip ANSI so we can grep plain text
		});
		expect(code).toBe(0);
		// Either the wordmark or the no-data path shows
		const hasWm = stdout.includes('chaching');
		expect(hasWm).toBe(true);
	}, 60_000);
});

// ── subprocess: CHACHING_NO_ART env suppression ───────────────────────────────

describe('CHACHING_NO_ART env suppression', () => {
	it('stats output still exits 0 under CHACHING_NO_ART', async () => {
		const { code } = await runCli(['stats'], { CHACHING_NO_ART: '1' });
		expect(code).toBe(0);
	}, 60_000);
});
