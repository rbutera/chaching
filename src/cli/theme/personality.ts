/**
 * chaching personality module — the CLI-side voice + ASCII art surface.
 *
 * As of chaching-ds-delight the voiced-copy banks, the deterministic selector,
 * the casing helper, the suppression predicates, and the escalation ladders all
 * live in the framework-agnostic `src/lib/voice/` module so the web app, the Ink
 * TUI, and the receipt renderers speak ONE voice. This file is now the CLI-side
 * wiring layer: it KEEPS the ANSI colorizers (terminal-only), the banner/wordmark
 * art, and `process.env`-defaulted convenience wrappers, and RE-EXPORTS the voice
 * banks + helpers so every existing import site keeps working unchanged.
 *
 * Everything decorative is suppressible via --no-art / CHACHING_NO_ART.
 * --json output NEVER touches this module. NO_COLOR strips ANSI but not content.
 */

import { tokens } from '../../lib/brand/tokens.js';
import { toAnsiMap } from '../../lib/brand/generate.js';
import {
	noArt as voiceNoArt,
	noColor as voiceNoColor,
	pick as voicePick,
	type SpendFlourish,
} from '../../lib/voice/index.js';
import {
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from '../../lib/voice/copy.js';

// ── Re-export the shared voice surface (one source of truth) ───────────────────
// Banks, ladders, selector primitives, and casing — re-exported so existing CLI
// import sites (`from '../theme/personality.js'`) keep resolving exactly as before.
export {
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from '../../lib/voice/copy.js';
export {
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
	flourishFor,
	tierIndex,
	crossedUp,
	formatFlourishText,
	type SpendFlourish,
} from '../../lib/voice/escalation.js';
export { caps } from '../../lib/voice/casing.js';
export { pick, pickForBucket } from '../../lib/voice/select.js';

// ── Suppression helpers (process.env-defaulted CLI convenience) ─────────────────
// The voice predicates are framework-free (explicit env). The CLI keeps the
// historical signatures that default to `process.env`, so existing callers that
// rely on the default keep working.

/** True if art should be omitted entirely. */
export function noArt(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): boolean {
	return voiceNoArt(argv, env as Record<string, string | undefined>);
}

/** True if color output should be stripped (https://no-color.org). */
export function noColor(env: NodeJS.ProcessEnv = process.env): boolean {
	return voiceNoColor(env as Record<string, string | undefined>);
}

// ── ANSI color helpers (no new deps; degrades under NO_COLOR) — TUI-specific ────

function ansi(code: string, text: string, env = process.env): string {
	if (noColor(env)) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

export function green(t: string, env = process.env): string { return ansi('32', t, env); }
export function yellow(t: string, env = process.env): string { return ansi('33', t, env); }
export function cyan(t: string, env = process.env): string { return ansi('36', t, env); }
export function dim(t: string, env = process.env): string { return ansi('2', t, env); }
export function bold(t: string, env = process.env): string { return ansi('1', t, env); }

// Brand accent — register-gold (brass), sourced from the shared brand-token
// ANSI map (same resolution path the TUI uses, so it can't drift from the web
// accent). Emitted as a 24-bit truecolor escape with the curated 16-color
// fallback as the basic-tier SGR; NO_COLOR strips both.
const ACCENT_ANSI = toAnsiMap(tokens).accent;

// chalk/ansi-styles basic-name → 30/90-range foreground SGR code, for the
// 16-color fallback when truecolor is unavailable.
const BASIC_SGR: Record<string, string> = {
	black: '30',
	red: '31',
	green: '32',
	yellow: '33',
	blue: '34',
	magenta: '35',
	cyan: '36',
	white: '37',
	gray: '90',
	redBright: '91',
	greenBright: '92',
	yellowBright: '93',
	blueBright: '94',
	magentaBright: '95',
	cyanBright: '96',
	whiteBright: '97'
};

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16)
	];
}

/**
 * Brand-accent colorizer (register-gold), used for the banner/wordmark.
 *
 * `tier` selects the rendering path: 'truecolor' (default) emits a 24-bit
 * escape; 'basic' falls back to the token's curated 16-color SGR for terminals
 * without truecolor. NO_COLOR strips color entirely in either tier.
 */
export function accent(
	t: string,
	env = process.env,
	tier: 'truecolor' | 'basic' = 'truecolor'
): string {
	if (noColor(env)) return t;
	if (tier === 'basic') {
		return ansi(BASIC_SGR[ACCENT_ANSI.basic] ?? '33', t, env);
	}
	const [r, g, b] = hexToRgb(ACCENT_ANSI.hex);
	return `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m`;
}

// ── ASCII art ─────────────────────────────────────────────────────────────────

/**
 * Full banner (~80 col). The wordmark leans into both puns:
 * - "$" signs and "💰" nod to cha-ching
 * - block-letter style reads as "chaching" (the CLI name / the caching pun)
 *
 * Font: hand-crafted block style. Compact enough not to eat the terminal.
 */
export const BANNER_FULL = `
  ██████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗██╗███╗   ██╗ ██████╗
 ██╔════╝██║  ██║██╔══██╗██╔════╝██║  ██║██║████╗  ██║██╔════╝
 ██║     ███████║███████║██║     ███████║██║██╔██╗ ██║██║  ███╗
 ██║     ██╔══██║██╔══██║██║     ██╔══██║██║██║╚██╗██║██║   ██║
 ╚██████╗██║  ██║██║  ██║╚██████╗██║  ██║██║██║ ╚████║╚██████╔╝
  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝
`.trimStart();

/**
 * Compact banner for narrow terminals (<72 cols).
 * Still has both puns baked in.
 */
export const BANNER_COMPACT = `
 $$  chaching  💰
 ─────────────────
`.trimStart();

/**
 * One-line wordmark for contexts where we need a single line
 * (loading frame, stats header indent, help header).
 * Double pun baked in: cha-ching (💰) + caching (token cache mechanics).
 */
export const WORDMARK = '💰 chaching — AI token spend register';

/**
 * Return the right banner variant given the current terminal width.
 * Returns null if art is suppressed.
 *
 * Suppression is absolute: CHACHING_NO_ART env ALWAYS wins, even if the caller
 * passes noArt: false. Callers that have already resolved the flag can pass true
 * to short-circuit the env check, but false does NOT force art on against the env.
 */
export function banner(opts: {
	noArt?: boolean;
	columns?: number;
	env?: NodeJS.ProcessEnv;
}): string | null {
	const env = opts.env ?? process.env;
	if (opts.noArt || noArt([], env)) return null;
	const cols = opts.columns ?? 80;
	const art = cols >= 72 ? BANNER_FULL : BANNER_COMPACT;
	return noColor(env) ? art : accent(art, env);
}

/**
 * One-line wordmark for inline/single-line slots.
 * Returns null when suppressed.
 *
 * Same suppression rule as banner(): env wins, noArt:false does not override it.
 */
export function wordmark(opts: {
	noArt?: boolean;
	env?: NodeJS.ProcessEnv;
} = {}): string | null {
	const env = opts.env ?? process.env;
	if (opts.noArt || noArt([], env)) return null;
	return noColor(env) ? WORDMARK : accent(WORDMARK, env);
}

// ── Rotating copy (legacy index-based wrappers, kept for CLI call sites) ────────
// The new per-bucket API lives in src/lib/voice/select.ts; these preserve the
// historical positional-index signature the TUI + existing tests use.

/** Current scanning line (rotates per minute by default; pass an index in tests). */
export function scanningLine(index?: number): string {
	return voicePick(SCANNING_LINES, index);
}

/** Current empty-state line (rotates per minute). */
export function emptyLine(index?: number): string {
	return voicePick(EMPTY_LINES, index);
}

/** Current error line (rotates per minute). */
export function errorLine(index?: number): string {
	return voicePick(ERROR_LINES, index);
}

/** Current receipt footer line (rotates per minute). */
export function receiptFooter(index?: number): string {
	return voicePick(RECEIPT_FOOTERS, index);
}

/**
 * Format a flourish for inline display, e.g. "💸💸 full send".
 * Returns empty string for the zero tier (no decoration below first threshold).
 * Applies the dim ANSI wrap unless NO_COLOR (TUI-specific colorization).
 */
export function formatFlourish(f: SpendFlourish, env = process.env): string {
	if (!f.emoji && !f.remark) return '';
	const parts = [f.emoji, f.remark].filter(Boolean).join(' ');
	return noColor(env) ? parts : dim(parts, env);
}
