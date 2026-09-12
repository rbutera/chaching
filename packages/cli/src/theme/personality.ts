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

import {
	noArt as voiceNoArt,
	noColor as voiceNoColor,
	pick as voicePick,
	type SpendFlourish,
} from '@chaching/shared/voice/index';
import {
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from '@chaching/shared/voice/copy';

// ── Re-export the shared voice surface (one source of truth) ───────────────────
// Banks, ladders, selector primitives, and casing — re-exported so existing CLI
// import sites (`from './personality'`) keep resolving exactly as before.
export {
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from '@chaching/shared/voice/copy';
export {
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
	flourishFor,
	tierIndex,
	crossedUp,
	formatFlourishText,
	type SpendFlourish,
} from '@chaching/shared/voice/escalation';
export { caps } from '@chaching/shared/voice/casing';
export { pick, pickForBucket } from '@chaching/shared/voice/select';

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

import * as textStyle from '@chaching/shared/voice/personality';
import {WORDMARK} from '@chaching/shared/voice/personality';
export {WORDMARK} from '@chaching/shared/voice/personality';
export function green(text: string, env = process.env): string { return textStyle.green(text, env); }
export function yellow(text: string, env = process.env): string { return textStyle.yellow(text, env); }
export function cyan(text: string, env = process.env): string { return textStyle.cyan(text, env); }
export function dim(text: string, env = process.env): string { return textStyle.dim(text, env); }
export function bold(text: string, env = process.env): string { return textStyle.bold(text, env); }
export function accent(text: string, env = process.env, tier: 'truecolor'|'basic' = 'truecolor'): string { return textStyle.accent(text, env, tier); }

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
