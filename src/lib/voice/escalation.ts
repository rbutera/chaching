/**
 * The spend-escalation ladders + tier selection + crossing detection.
 *
 * The ladder is a function of the AMOUNT (not the clock) — deterministic by
 * definition. `flourishFor` returns the highest tier the amount meets; `tierIndex`
 * gives its position in the ladder; `crossedUp` is the single definition of "we
 * just crossed an escalation threshold" shared by the visual flourish AND the
 * opt-in joy triggers, so the chime and the visual escalation can never disagree.
 *
 * Thresholds are calibrated for real personal-use numbers:
 *   5h block:  typical mild session ~$5–$15; active $50–$150+
 *   daily:     light day ~$10; heavy ~$100; wild day $200+
 *   lifetime:  first notable milestone ~$100; "send help" level ~$1 000+
 *
 * Each tier gets an escalating reaction: emoji density + copy sharpness go up.
 * Emoji are the severity ENCODING (data, not decoration); lowercase remarks.
 */

export interface SpendFlourish {
	/** The threshold this entry represents (inclusive lower bound). */
	threshold: number;
	/** Emoji prefix (empty string = no emoji at this tier). */
	emoji: string;
	/** Short one-liner. Keep it under 60 chars so it fits inline. lowercase. */
	remark: string;
}

/** Flourishes for the 5h-block spend. */
export const BLOCK_FLOURISHES: SpendFlourish[] = [
	{ threshold: 0,   emoji: '',    remark: '' },
	{ threshold: 10,  emoji: '💸',  remark: 'warming up' },
	{ threshold: 30,  emoji: '💸💸', remark: 'getting spicy' },
	{ threshold: 75,  emoji: '🔥',  remark: 'full send' },
	{ threshold: 120, emoji: '🔥🔥', remark: 'please take a break' },
	{ threshold: 200, emoji: '🚨',  remark: 'the register is on fire' },
];

/** Flourishes for the daily total. */
export const DAILY_FLOURISHES: SpendFlourish[] = [
	{ threshold: 0,   emoji: '',    remark: '' },
	{ threshold: 20,  emoji: '💰',  remark: 'decent day' },
	{ threshold: 50,  emoji: '💸',  remark: 'treating yourself' },
	{ threshold: 100, emoji: '💸💸', remark: 'big day' },
	{ threshold: 200, emoji: '🔥',  remark: 'account on fire' },
	{ threshold: 500, emoji: '🚨🚨', remark: 'send help' },
];

/** Flourishes for the lifetime total. */
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

/** The index of the active tier in its ladder (0 = the no-decoration zero tier). */
export function tierIndex(amount: number, tiers: SpendFlourish[]): number {
	return tiers.indexOf(flourishFor(amount, tiers));
}

/**
 * The single definition of "we just crossed an escalation threshold upward":
 * the new tier index is strictly greater than the previous one. Shared by the
 * visual flourish change AND the opt-in joy (chime/confetti) so they agree.
 * A drop in spend (lower tier) never fires; re-entering the same tier never fires.
 */
export function crossedUp(prevTierIdx: number, nextTierIdx: number): boolean {
	return nextTierIdx > prevTierIdx;
}

/**
 * Format a flourish for inline display, e.g. "💸💸 full send".
 * Returns empty string for the zero tier (no decoration below first threshold).
 * Color is NOT applied here (consumers own color); pure string.
 */
export function formatFlourishText(f: SpendFlourish): string {
	if (!f.emoji && !f.remark) return '';
	return [f.emoji, f.remark].filter(Boolean).join(' ');
}
