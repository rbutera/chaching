import {tokens} from '../brand/tokens.js';
import {toAnsiMap} from '../brand/generate.js';
import {noColor} from './suppress.js';

function ansi(code: string, text: string, env: Record<string,string|undefined> = {}): string {
	if (noColor(env)) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

export function green(t: string, env: Record<string,string|undefined> = {}): string { return ansi('32', t, env); }
export function yellow(t: string, env: Record<string,string|undefined> = {}): string { return ansi('33', t, env); }
export function cyan(t: string, env: Record<string,string|undefined> = {}): string { return ansi('36', t, env); }
export function dim(t: string, env: Record<string,string|undefined> = {}): string { return ansi('2', t, env); }
export function bold(t: string, env: Record<string,string|undefined> = {}): string { return ansi('1', t, env); }

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
	env: Record<string,string|undefined> = {},
	tier: 'truecolor' | 'basic' = 'truecolor'
): string {
	if (noColor(env)) return t;
	if (tier === 'basic') {
		return ansi(BASIC_SGR[ACCENT_ANSI.basic] ?? '33', t, env);
	}
	const [r, g, b] = hexToRgb(ACCENT_ANSI.hex);
	return `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m`;
}


export const WORDMARK = '💰 chaching — AI token spend register';
