import { afterEach, describe, expect, it } from 'vitest';
import { tokens } from '../../lib/brand/tokens.js';
import { spendLadderColor, bannerLine, color, ACCENT, GOOD } from './theme.js';
import { LOGO_FULL, LOGO_COMPACT, LOGO_FULL_MIN_COLS } from './banner.js';

describe('spendLadderColor', () => {
	afterEach(() => {
		delete process.env.NO_COLOR;
	});

	it('maps cost to the calm → warm → hot → alarm token hues (no literal hex)', () => {
		// Tiers mirror the BLOCK_FLOURISHES thresholds and source from the token ladder.
		expect(spendLadderColor(0)).toBe(tokens.spend.calm.hex);
		expect(spendLadderColor(9.99)).toBe(tokens.spend.calm.hex);
		expect(spendLadderColor(10)).toBe(tokens.spend.warm.hex);
		expect(spendLadderColor(74)).toBe(tokens.spend.warm.hex);
		expect(spendLadderColor(75)).toBe(tokens.spend.hot.hex);
		expect(spendLadderColor(199)).toBe(tokens.spend.hot.hex);
		expect(spendLadderColor(200)).toBe(tokens.spend.alarm.hex);
		expect(spendLadderColor(1000)).toBe(tokens.spend.alarm.hex);
	});

	it('strips under NO_COLOR (routed through color())', () => {
		process.env.NO_COLOR = '1';
		expect(spendLadderColor(250)).toBeUndefined();
		expect(spendLadderColor(5)).toBeUndefined();
	});
});

describe('accent / good token sourcing', () => {
	it('ACCENT is the brass-gold token, GOOD is the green token — no literal hex', () => {
		expect(ACCENT).toBe(tokens.accent.hex);
		expect(GOOD).toBe(tokens.status.good.hex);
	});

	it('color() strips under NO_COLOR', () => {
		process.env.NO_COLOR = '1';
		try {
			expect(color(ACCENT)).toBeUndefined();
		} finally {
			delete process.env.NO_COLOR;
		}
	});
});

describe('bannerLine (inlined logo.txt)', () => {
	afterEach(() => {
		delete process.env.NO_COLOR;
	});

	it('returns the full register wordmark at >= the full-banner min width', () => {
		expect(bannerLine(false, LOGO_FULL_MIN_COLS)).toBe(LOGO_FULL);
		expect(bannerLine(false, 120)).toBe(LOGO_FULL);
	});

	it('falls back to the compact wordmark below the min width', () => {
		expect(bannerLine(false, LOGO_FULL_MIN_COLS - 1)).toBe(LOGO_COMPACT);
		expect(bannerLine(false, 40)).toBe(LOGO_COMPACT);
	});

	it('returns null when art is suppressed (--no-art)', () => {
		expect(bannerLine(true, 120)).toBeNull();
		expect(bannerLine(true, 40)).toBeNull();
	});

	it('the inlined LOGO_FULL is the figlet $ wordmark and its widest line is the declared min width', () => {
		expect(LOGO_FULL).toContain('$$$$$$');
		const widest = Math.max(...LOGO_FULL.split('\n').map((l) => l.length));
		expect(widest).toBe(LOGO_FULL_MIN_COLS);
	});
});
