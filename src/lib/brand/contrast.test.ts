/**
 * Perceptual checks on the brand tokens, computed with culori (a dev-only dep):
 *
 *  - Contrast: every foreground-ish token (fg ramp, accent, status, model
 *    families) clears WCAG 3:1 against every surface token.
 *  - Separation: the brass accent #e0a52f clears the documented OKLab ΔE floor
 *    against haiku #facc15, AND the un-nudged register-gold #e8b54a would fail
 *    that same floor (proving the nudge in design D4 was necessary).
 */

import { describe, it, expect } from 'vitest';
import { wcagContrast, differenceEuclidean } from 'culori';

import { tokens } from './tokens.js';

// The fill surfaces are the backdrops text/glyphs actually sit on. The two
// border tokens are 1px hairline dividers, never a fill behind a foreground, so
// they are not part of the text-contrast invariant (the dimmest tier, --fg-dim,
// is intentionally faint and would not clear 3:1 against a near-foreground
// border line — nor should it need to).
const fillSurfaces = {
	bg: tokens.surfaces.bg.hex,
	surface1: tokens.surfaces.surface1.hex,
	surface2: tokens.surfaces.surface2.hex,
	surface3: tokens.surfaces.surface3.hex
};
const foregrounds = [
	...Object.values(tokens.fg).map((t) => t.hex),
	tokens.accent.hex,
	...Object.values(tokens.status).map((t) => t.hex),
	...Object.values(tokens.models).map((t) => t.hex)
];

describe('contrast (WCAG ≥ 3:1 vs every fill surface)', () => {
	for (const fg of foregrounds) {
		for (const [name, surface] of Object.entries(fillSurfaces)) {
			it(`${fg} vs ${name} ${surface} ≥ 3:1`, () => {
				expect(wcagContrast(fg, surface)).toBeGreaterThanOrEqual(3);
			});
		}
	}
});

describe('border tokens stay visible against the base surface', () => {
	// Borders need separation from the background they divide, not text-grade
	// contrast. A future edit that makes a border vanish against bg fails here.
	for (const border of [tokens.surfaces.border.hex, tokens.surfaces.borderStrong.hex]) {
		it(`${border} is distinguishable from bg`, () => {
			expect(wcagContrast(border, tokens.surfaces.bg.hex)).toBeGreaterThan(1);
		});
	}
});

describe('gold-vs-haiku OKLab ΔE separation', () => {
	const deltaE = differenceEuclidean('oklab');
	const haiku = tokens.models.haiku.hex; // #facc15
	const brass = tokens.accent.hex; // #e0a52f (the committed accent)
	const unNudgedGold = '#e8b54a'; // the original register-gold, too close to haiku

	// Floor: the brass accent must clear it; the un-nudged gold must not. The
	// design measured brass ≈ 0.111 and gold ≈ 0.075, so 0.09 sits cleanly between.
	const FLOOR = 0.09;

	it('brass accent clears the separation floor against haiku', () => {
		expect(deltaE(brass, haiku)).toBeGreaterThanOrEqual(FLOOR);
	});

	it('un-nudged register-gold would FAIL the floor (the nudge was necessary)', () => {
		expect(deltaE(unNudgedGold, haiku)).toBeLessThan(FLOOR);
	});

	it('the committed accent is the brass value, not the un-nudged gold', () => {
		expect(brass).toBe('#e0a52f');
		expect(brass).not.toBe(unNudgedGold);
	});
});
