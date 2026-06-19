// TUI theme: terminal color names (Ink maps these via chalk), NO_COLOR honoring,
// the Unicode-block sparkline renderer, and a banner slot for wave 5.
//
// Ink's <Text color> takes chalk color names or hex. We use named ANSI colors so
// they degrade well across terminals; chalk auto-disables color when NO_COLOR is
// set or stdout is not a TTY, but we ALSO expose noColor() so layout/components
// can drop color props entirely for a clean, single-attribute render.

import type { Period } from '../../lib/types.js';

/** Respect the NO_COLOR convention (https://no-color.org). */
export function noColor(): boolean {
	return process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '';
}

/** A color prop helper: returns undefined when NO_COLOR is set so Text renders plain. */
export function color(name: string): string | undefined {
	return noColor() ? undefined : name;
}

/** Provider → chalk color name (mirrors the web providerColor intent). */
export function providerColorName(provider: string): string {
	switch (provider) {
		case 'claude':
			return 'magenta';
		case 'codex':
			return 'cyan';
		case 'opencode':
			return 'green';
		case 'cursor':
			return 'yellow';
		default:
			return 'gray';
	}
}

/** Model family → chalk color name (mirrors the web modelColor intent). */
export function modelColorName(model: string): string {
	if (/opus/i.test(model)) return 'magenta';
	if (/sonnet/i.test(model)) return 'cyan';
	if (/haiku/i.test(model)) return 'yellow';
	return 'gray';
}

export const ACCENT = 'green';
export const DIM = 'gray';
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
 * Banner slot. WAVE 5 fills this with the ASCII-art mascot + personality copy
 * (see design D6, src/cli/theme/). For now: a minimal one-line wordmark, honoring
 * --no-art / CHACHING_NO_ART so wave 5's quiet-mode contract already holds.
 */
export function bannerLine(noArt: boolean): string | null {
	if (noArt) return null;
	return '◈ chaching';
}

/** --no-art flag or CHACHING_NO_ART env (NO_COLOR-style quietness, design D6). */
export function noArt(argv: string[] = []): boolean {
	if (process.env.CHACHING_NO_ART !== undefined && process.env.CHACHING_NO_ART !== '') return true;
	return argv.includes('--no-art');
}
