// TUI theme: terminal color names (Ink maps these via chalk), NO_COLOR honoring,
// the Unicode-block sparkline renderer, and the banner/personality wiring for wave 5.
//
// Ink's <Text color> takes chalk color names or hex. We use named ANSI colors so
// they degrade well across terminals; chalk auto-disables color when NO_COLOR is
// set or stdout is not a TTY, but we ALSO expose noColor() so layout/components
// can drop color props entirely for a clean, single-attribute render.
//
// All decorative copy (art, scanning lines, empty state, flourishes) lives in
// src/cli/theme/personality.ts — this file is the Ink-specific wiring layer.

import type { Period } from '../../lib/types.js';
import { tokens } from '../../lib/brand/tokens.js';
import { toAnsiMap } from '../../lib/brand/generate.js';
import {
	noColor as _noColor,
	noArt as _noArt,
	BANNER_FULL,
	BANNER_COMPACT,
} from '../theme/personality.js';

// Shared brand → terminal color map. The CLI passes token hex to Ink/chalk,
// which auto-downsamples Truecolor → 256 → 16; the curated basic name is the
// explicit fallback for reduced-capability terminals.
const ANSI = toAnsiMap(tokens);

// Re-export personality helpers (excluding noColor/noArt which are re-wrapped
// below with the same signature for backward compat with existing callers).
export {
	scanningLine,
	emptyLine,
	errorLine,
	wordmark,
	flourishFor,
	formatFlourish,
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
	pick,
} from '../theme/personality.js';

/** Respect the NO_COLOR convention (https://no-color.org). */
export function noColor(): boolean {
	return _noColor();
}

/** --no-art flag or CHACHING_NO_ART env (NO_COLOR-style quietness, design D6). */
export function noArt(argv: string[] = []): boolean {
	return _noArt(argv);
}

/** A color prop helper: returns undefined when NO_COLOR is set so Text renders plain. */
export function color(name: string): string | undefined {
	return noColor() ? undefined : name;
}

/**
 * Provider → renderable color, sourced from the shared brand tokens. Returns the
 * token hex (Ink/chalk auto-downsample); mirrors the web providerColor intent.
 */
export function providerColorName(provider: string): string {
	switch (provider) {
		case 'claude':
			return ANSI.providers.claude.hex;
		case 'codex':
			return ANSI.providers.codex.hex;
		case 'opencode':
			return ANSI.providers.opencode.hex;
		case 'cursor':
			return ANSI.providers.cursor.hex;
		default:
			return ANSI.dim.hex;
	}
}

/**
 * Model family → renderable color, sourced from the shared brand tokens. Returns
 * the token hex (Ink/chalk auto-downsample); mirrors the web modelColor intent.
 */
export function modelColorName(model: string): string {
	if (/opus/i.test(model)) return ANSI.models.opus.hex;
	if (/sonnet/i.test(model)) return ANSI.models.sonnet.hex;
	if (/haiku/i.test(model)) return ANSI.models.haiku.hex;
	return ANSI.models.other.hex;
}

/** Brand accent — register-gold (brass), shared across web + CLI. */
export const ACCENT = ANSI.accent.hex;
export const DIM = ANSI.dim.hex;
export const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Render a series of numbers as a Unicode-block sparkline. Empty/short series
 * degrade gracefully. Scales to the min..max of the window so flat series read
 * as a baseline row rather than noise.
 */
export function sparkline(values: number[]): string {
	if (values.length === 0) return '';
	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = max - min;
	return values
		.map((v) => {
			if (range === 0) return max > 0 ? SPARK_CHARS[4] : SPARK_CHARS[0];
			const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
			return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
		})
		.join('');
}

/** A simple horizontal proportion bar, e.g. for the 5h-window elapsed gauge. */
export function gaugeBar(fraction: number, width: number): string {
	const f = Math.max(0, Math.min(1, fraction));
	const filled = Math.round(f * width);
	return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export const PERIOD_LABEL: Record<Period, string> = {
	day: 'Day',
	week: 'Week',
	month: 'Month'
};

/**
 * Banner for the TUI (Ink). Returns plain multi-line text; Ink renders it via
 * <Text color> on the caller side. Wide banner at ≥72 cols, compact fallback below.
 * Returns null when noArt is true.
 */
export function bannerLine(isNoArt: boolean, columns = 80): string | null {
	if (isNoArt) return null;
	return columns >= 72 ? BANNER_FULL : BANNER_COMPACT;
}
