/**
 * chaching personality module — ASCII art, copy, flourishes.
 *
 * ONE source of truth for all decorative content.
 * Everything here is suppressible via --no-art / CHACHING_NO_ART.
 * --json output NEVER touches this module.
 * NO_COLOR strips ANSI but does not affect content.
 *
 * Design intent: gallows humor about burning AI money, dev-savvy, affectionate.
 * The name is a double pun: cha-ching 💰 (cash-register sound) + caching
 * (cache reads/writes are a core token-cost concept). Both vibes welcome.
 */

// ── Suppression helpers ────────────────────────────────────────────────────────

/** True if art should be omitted entirely. */
export function noArt(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.CHACHING_NO_ART !== undefined && env.CHACHING_NO_ART !== '') return true;
	return argv.includes('--no-art');
}

/** True if color output should be stripped (https://no-color.org). */
export function noColor(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NO_COLOR !== undefined && env.NO_COLOR !== '';
}

// ── ANSI color helpers (no new deps; degrades under NO_COLOR) ─────────────────

function ansi(code: string, text: string, env = process.env): string {
	if (noColor(env)) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

export function green(t: string, env = process.env): string { return ansi('32', t, env); }
export function yellow(t: string, env = process.env): string { return ansi('33', t, env); }
export function cyan(t: string, env = process.env): string { return ansi('36', t, env); }
export function dim(t: string, env = process.env): string { return ansi('2', t, env); }
export function bold(t: string, env = process.env): string { return ansi('1', t, env); }

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
	return noColor(env) ? art : green(art, env);
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
	return noColor(env) ? WORDMARK : green(WORDMARK, env);
}

// ── Rotating copy ──────────────────────────────────────────────────────────────

/**
 * Lines shown while the cold scan runs.
 * Tone: gallows humor, slightly resigned, genuinely funny to a dev who knows.
 */
export const SCANNING_LINES = [
	'counting your sins…',
	'tallying the damage…',
	'auditing the carnage…',
	'summing the burn rate…',
	'itemising the splurge…',
	'calculating your runway…',
	'adding up the cache misses…',
	'reconciling your token ledger…',
] as const;

/**
 * Empty-state copy. Friendly, nudges toward `chaching init`, not alarming.
 */
export const EMPTY_LINES = [
	'no receipts yet. agents are free until they aren\'t.',
	'nothing to report — either you\'re efficient or you haven\'t started.',
	'the register is silent. run `chaching init` to start listening.',
	'clean slate. won\'t last.',
	'no spend data found. try `chaching init` to connect your providers.',
] as const;

/**
 * Error copy — short, pragmatic, slightly wry.
 */
export const ERROR_LINES = [
	'something went wrong (not a billing error, for once).',
	'failed to load spend data. check your config with `chaching init`.',
	'the register jammed. see above for details.',
	'couldn\'t load data — probably config, probably fixable.',
] as const;

/**
 * Return a deterministic item from an array (by index mod length).
 * Index defaults to the current minute so it "rotates" without being random.
 */
export function pick<T>(items: readonly T[], index?: number): T {
	const i = index ?? Math.floor(Date.now() / 60_000);
	return items[i % items.length];
}

/** Current scanning line (rotates per minute). */
export function scanningLine(index?: number): string {
	return pick(SCANNING_LINES, index);
}

/** Current empty-state line (rotates per minute). */
export function emptyLine(index?: number): string {
	return pick(EMPTY_LINES, index);
}

/** Current error line (rotates per minute). */
export function errorLine(index?: number): string {
	return pick(ERROR_LINES, index);
}

// ── Big-spend flourishes ───────────────────────────────────────────────────────

/**
 * Spend flourishes for the 5h-block and daily total.
 *
 * Thresholds are calibrated for real personal-use numbers:
 *   5h block:  typical mild session ~$5–$15; active $50–$150+
 *   daily:     light day ~$10; heavy ~$100; wild day $200+
 *   lifetime:  first notable milestone ~$100; "send help" level ~$1 000+
 *
 * Each tier gets an escalating reaction: emoji density + copy sharpness go up.
 */

export interface SpendFlourish {
	/** The threshold this entry represents (inclusive lower bound). */
	threshold: number;
	/** Emoji prefix (empty string = no emoji at this tier). */
	emoji: string;
	/** Short one-liner. Keep it under 60 chars so it fits inline. */
	remark: string;
}

/** Flourishes keyed by context. */
export const BLOCK_FLOURISHES: SpendFlourish[] = [
	{ threshold: 0,   emoji: '',    remark: '' },
	{ threshold: 10,  emoji: '💸',  remark: 'warming up' },
	{ threshold: 30,  emoji: '💸💸', remark: 'getting spicy' },
	{ threshold: 75,  emoji: '🔥',  remark: 'full send' },
	{ threshold: 120, emoji: '🔥🔥', remark: 'please take a break' },
	{ threshold: 200, emoji: '🚨',  remark: 'the register is on fire' },
];

export const DAILY_FLOURISHES: SpendFlourish[] = [
	{ threshold: 0,   emoji: '',    remark: '' },
	{ threshold: 20,  emoji: '💰',  remark: 'decent day' },
	{ threshold: 50,  emoji: '💸',  remark: 'treating yourself' },
	{ threshold: 100, emoji: '💸💸', remark: 'big day' },
	{ threshold: 200, emoji: '🔥',  remark: 'account on fire' },
	{ threshold: 500, emoji: '🚨🚨', remark: 'send help' },
];

export const LIFETIME_FLOURISHES: SpendFlourish[] = [
	{ threshold: 0,    emoji: '',    remark: '' },
	{ threshold: 100,  emoji: '💰',  remark: 'you\'ve committed' },
	{ threshold: 500,  emoji: '💸',  remark: 'well into it now' },
	{ threshold: 1000, emoji: '🔥',  remark: 'you live here now' },
	{ threshold: 5000, emoji: '🚨',  remark: 'write a blog post' },
];

/**
 * Pick the appropriate flourish for a spend amount against a tier list.
 * Returns the highest threshold tier that the amount meets or exceeds.
 */
export function flourishFor(amount: number, tiers: SpendFlourish[]): SpendFlourish {
	let result = tiers[0];
	for (const tier of tiers) {
		if (amount >= tier.threshold) result = tier;
	}
	return result;
}

/**
 * Format a flourish for inline display, e.g. "💸💸 full send".
 * Returns empty string for the zero tier (no decoration below first threshold).
 */
export function formatFlourish(f: SpendFlourish, env = process.env): string {
	if (!f.emoji && !f.remark) return '';
	const parts = [f.emoji, f.remark].filter(Boolean).join(' ');
	return noColor(env) ? parts : dim(parts, env);
}
