import { afterEach, describe, expect, it } from 'vitest';
import { tokens } from '../../lib/brand/tokens.js';
import {
	spendLadderColor,
	ladderColorFor,
	bannerLine,
	color,
	gaugeBar,
	ACCENT,
	GOOD,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES
} from './theme.js';
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

describe('ladderColorFor (generalized over any ladder)', () => {
	afterEach(() => {
		delete process.env.NO_COLOR;
	});

	it('maps the daily ladder: zero tier = calm, top tier = alarm', () => {
		expect(ladderColorFor(0, DAILY_FLOURISHES)).toBe(tokens.spend.calm.hex);
		// top daily tier (send help, >= $500) lands on alarm
		expect(ladderColorFor(500, DAILY_FLOURISHES)).toBe(tokens.spend.alarm.hex);
	});

	it('maps the lifetime ladder: zero tier = calm, top tier = alarm', () => {
		expect(ladderColorFor(0, LIFETIME_FLOURISHES)).toBe(tokens.spend.calm.hex);
		expect(ladderColorFor(5000, LIFETIME_FLOURISHES)).toBe(tokens.spend.alarm.hex);
	});

	it('the hue steps in lockstep with the tier (monotonic non-decreasing)', () => {
		// each higher daily threshold is at least as hot as the one below it
		const amounts = [0, 20, 50, 100, 200, 500];
		const ladder = [
			tokens.spend.calm.hex,
			tokens.spend.warm.hex,
			tokens.spend.hot.hex,
			tokens.spend.alarm.hex
		];
		let prevIdx = -1;
		for (const a of amounts) {
			const idx = ladder.indexOf(ladderColorFor(a, DAILY_FLOURISHES)!);
			expect(idx).toBeGreaterThanOrEqual(prevIdx);
			prevIdx = idx;
		}
	});

	it('strips under NO_COLOR', () => {
		process.env.NO_COLOR = '1';
		expect(ladderColorFor(500, DAILY_FLOURISHES)).toBeUndefined();
	});
});

describe('gaugeBar', () => {
	it('only reads full at f >= 1 (floors incomplete fractions — 0.975 must not fill 20/20)', () => {
		expect(gaugeBar(0.975, 20)).toBe('█'.repeat(19) + '░');
		expect(gaugeBar(1, 20)).toBe('█'.repeat(20));
		expect(gaugeBar(0, 20)).toBe('░'.repeat(20));
		// clamps out-of-range input
		expect(gaugeBar(1.5, 10)).toBe('█'.repeat(10));
		expect(gaugeBar(-0.2, 10)).toBe('░'.repeat(10));
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
