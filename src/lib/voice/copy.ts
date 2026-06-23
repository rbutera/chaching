/**
 * The voiced-copy banks — the actual words. All lowercase per the casing contract
 * (these are personality copy). Framework-free; imported by web, TUI, and receipt.
 */

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
 * Receipt footer flourishes — the wry "thank you for shopping" line at the
 * bottom of a thermal receipt. Same gallows-humor register as the rest.
 */
export const RECEIPT_FOOTERS = [
	'thank you for burning with us 💸',
	'no refunds. the tokens are gone.',
	'keep this receipt for your accountant (lol)',
	"cha-ching! that's the sound of your runway",
	'cached and confused since day one',
	'come back soon — the agents missed you',
	'every cache hit is a tiny act of mercy',
] as const;
