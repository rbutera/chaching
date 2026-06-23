/**
 * Tests for the brand-token generators.
 *
 * Covers:
 *  - toCss output equals the committed app.css :root GENERATED block (drift test)
 *    and declares every expected variable name.
 *  - toAnsiMap resolves each token to the right hex/basic/256 triple; the 256
 *    path goes through ansi-styles (no hand-rolled converter).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import styles from 'ansi-styles';

import { tokens } from './tokens.js';
import { toCss, toAnsiMap, CSS_BEGIN_MARKER, CSS_END_MARKER } from './generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const appCssPath = join(here, '..', '..', 'app.css');

/** Extract the committed generated block from app.css, normalising the leading
 *  indentation on the marker lines (the file tab-indents them inside :root). */
function committedBlock(): string {
	const css = readFileSync(appCssPath, 'utf8');
	const begin = css.indexOf(CSS_BEGIN_MARKER);
	const end = css.indexOf(CSS_END_MARKER);
	expect(begin).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(begin);
	const raw = css.slice(begin, end + CSS_END_MARKER.length);
	// app.css indents the END marker line with a tab; toCss emits it flush. Strip
	// any leading tab that directly precedes the END marker.
	return raw.replace(/\t(\/\* END GENERATED brand tokens \*\/)$/, '$1');
}

describe('toCss', () => {
	it('matches the committed app.css :root generated block (drift guard)', () => {
		expect(committedBlock()).toBe(toCss(tokens));
	});

	it('declares every expected color variable name', () => {
		const css = toCss(tokens);
		for (const name of [
			'--bg',
			'--surface-1',
			'--surface-2',
			'--surface-3',
			'--surface-inset',
			'--border',
			'--border-strong',
			'--border-faint',
			// raw ramps
			'--ink-950',
			'--ink-600',
			'--paper-50',
			'--paper-600',
			'--gold-300',
			'--gold-500',
			'--gold-700',
			'--cream-50',
			'--cream-ink',
			// raw hues
			'--green-500',
			'--orange-500',
			'--red-500',
			'--amber-500',
			'--purple',
			'--sky',
			'--lemon',
			'--mint',
			'--slate',
			// semantic text (legacy + new names)
			'--text',
			'--text-muted',
			'--text-dim',
			'--text-on-gold',
			'--fg',
			'--fg-muted',
			'--fg-dim',
			// accent + aliases
			'--accent',
			'--accent-bright',
			'--accent-press',
			'--accent-soft',
			'--accent-line',
			'--focus-ring',
			// status
			'--good',
			'--bad',
			'--warn',
			'--info',
			// spend ladder
			'--spend-calm',
			'--spend-warm',
			'--spend-hot',
			'--spend-alarm',
			// cache
			'--cache-hit',
			'--cache-miss',
			'--cache-write',
			// model families
			'--m-opus',
			'--m-sonnet',
			'--m-haiku',
			'--m-other',
			// providers
			'--p-claude',
			'--p-codex',
			'--p-opencode',
			'--p-cursor'
		]) {
			expect(css).toContain(`${name}: `);
		}
	});

	it('emits the brass accent and keeps haiku lemon', () => {
		const css = toCss(tokens);
		expect(css).toContain('--accent: #eba92c;');
		expect(css).toContain('--m-haiku: #f4ce3a;');
	});
});

describe('toAnsiMap', () => {
	const map = toAnsiMap(tokens);

	it('resolves accent to the brass gold token', () => {
		expect(map.accent.hex).toBe('#eba92c');
		expect(map.accent.basic).toBe('yellow');
		expect(map.accent.ansi256).toBe(styles.hexToAnsi256('#eba92c'));
	});

	it('resolves model families to their distinct tokens', () => {
		expect(map.models.opus.hex).toBe(tokens.models.opus.hex);
		expect(map.models.opus.basic).toBe('magenta');
		expect(map.models.sonnet.hex).toBe(tokens.models.sonnet.hex);
		expect(map.models.haiku.hex).toBe(tokens.models.haiku.hex);
		expect(map.models.other.hex).toBe(tokens.models.other.hex);
	});

	it('resolves providers to their tokens', () => {
		expect(map.providers.claude.hex).toBe(tokens.providers.claude.hex);
		expect(map.providers.codex.hex).toBe(tokens.providers.codex.hex);
		expect(map.providers.opencode.hex).toBe(tokens.providers.opencode.hex);
		expect(map.providers.cursor.hex).toBe(tokens.providers.cursor.hex);
	});

	it('resolves the spend-escalation ladder (calm → warm → hot → alarm) to its tokens', () => {
		expect(map.spend.calm.hex).toBe(tokens.spend.calm.hex);
		expect(map.spend.warm.hex).toBe(tokens.spend.warm.hex);
		expect(map.spend.hot.hex).toBe(tokens.spend.hot.hex);
		expect(map.spend.alarm.hex).toBe(tokens.spend.alarm.hex);
	});

	it('uses ansi-styles for the 256 fallback path (no hand-rolled converter)', () => {
		// Every resolved 256 index must equal ansi-styles' computation for the hex.
		for (const c of [map.accent, map.good, map.bad, map.warn, map.dim]) {
			expect(c.ansi256).toBe(styles.hexToAnsi256(c.hex));
		}
		for (const c of Object.values(map.models)) {
			expect(c.ansi256).toBe(styles.hexToAnsi256(c.hex));
		}
		for (const c of Object.values(map.spend)) {
			expect(c.ansi256).toBe(styles.hexToAnsi256(c.hex));
		}
	});
});
