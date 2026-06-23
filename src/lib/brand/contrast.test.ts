/**
 * Perceptual checks on the brand tokens, computed with culori (a dev-only dep):
 *
 *  - Dark contrast: every readable foreground token (fg, muted, accent, status,
 *    model families) clears WCAG 3:1 against every dark fill surface. The dim
 *    tier is the faint hint tier (`.label-caps`, secondary captions): it is held
 *    to 3:1 against the body backdrop (`--bg`) only, not against the most
 *    elevated card — by design it is the faintest tier and is never body text.
 *  - Cream contrast: the `.paper` world's readable tokens (ink text, muted,
 *    darkened gold accent, good/bad) clear WCAG 3:1 against every cream fill.
 *  - Separation: the brass accent #eba92c clears the OKLab ΔE floor against the
 *    haiku lemon #f4ce3a (the categorical hue it sits nearest), so the brand
 *    gold never reads as a model color.
 */

import { describe, it, expect } from 'vitest';
import { wcagContrast, differenceEuclidean } from 'culori';

import { tokens } from './tokens.js';

// The fill surfaces are the backdrops text/glyphs actually sit on. The two
// border tokens are 1px hairline dividers, never a fill behind a foreground, so
// they are not part of the text-contrast invariant.
const fillSurfaces = {
	bg: tokens.surfaces.bg.hex,
	surface1: tokens.surfaces.surface1.hex,
	surface2: tokens.surfaces.surface2.hex,
	surface3: tokens.surfaces.surface3.hex
};

// Readable foregrounds: tokens used for text/glyphs at normal size. Excludes the
// faint dim tier (asserted separately against --bg).
const readableForegrounds = [
	tokens.fg.fg.hex,
	tokens.fg.muted.hex,
	tokens.accent.hex,
	...Object.values(tokens.status).map((t) => t.hex),
	...Object.values(tokens.models).map((t) => t.hex)
];

describe('dark world: readable foregrounds ≥ 3:1 vs every fill surface', () => {
	for (const fg of readableForegrounds) {
		for (const [name, surface] of Object.entries(fillSurfaces)) {
			it(`${fg} vs ${name} ${surface} ≥ 3:1`, () => {
				expect(wcagContrast(fg, surface)).toBeGreaterThanOrEqual(3);
			});
		}
	}
});

describe('dark world: dim hint tier clears 3:1 against the body backdrop', () => {
	// The dim tier (--text-dim / --fg-dim, the warm paper-600) is the faintest
	// readable tier — captions, the .label-caps micro-label, secondary hints. It
	// is held to 3:1 against --bg, the canonical body backdrop, not against the
	// most elevated card (where, by design, it is intentionally subtle).
	it(`${tokens.fg.dim.hex} vs bg ${tokens.surfaces.bg.hex} ≥ 3:1`, () => {
		expect(wcagContrast(tokens.fg.dim.hex, tokens.surfaces.bg.hex)).toBeGreaterThanOrEqual(3);
	});
});

describe('dark world: border tokens stay visible against the base surface', () => {
	// Borders need separation from the background they divide, not text-grade
	// contrast. A future edit that makes a border vanish against bg fails here.
	for (const border of [tokens.surfaces.border.hex, tokens.surfaces.borderStrong.hex]) {
		it(`${border} is distinguishable from bg`, () => {
			expect(wcagContrast(border, tokens.surfaces.bg.hex)).toBeGreaterThan(1);
		});
	}
});

// The `.paper` cream world is a CSS cascade scope (overrides of the same var
// names), so its concrete values live in app.css, not the typed token object.
// Mirror them here for the contrast invariant.
const cream = {
	bg: tokens.ramps.cream50.hex, // #f7f2e8 (also --surface-1)
	surface2: tokens.ramps.cream100.hex, // #f0e9da
	surface3: tokens.ramps.cream200.hex // #e4dac6
};
const creamForegrounds = {
	text: tokens.ramps.creamInk.hex, // #1c1913
	muted: '#5a5343',
	accent: tokens.ramps.gold700.hex, // #9e6e14 (darkened gold for cream)
	good: '#18834b', // legible receipt-green (darkened from the ref's #1f9d5b)
	bad: '#cf4a41'
};

describe('cream world (.paper): readable tokens ≥ 3:1 vs every cream fill', () => {
	for (const [fgName, fg] of Object.entries(creamForegrounds)) {
		for (const [sName, surface] of Object.entries(cream)) {
			it(`${fgName} ${fg} vs ${sName} ${surface} ≥ 3:1`, () => {
				expect(wcagContrast(fg, surface)).toBeGreaterThanOrEqual(3);
			});
		}
	}
});

describe('brass-vs-haiku OKLab ΔE separation', () => {
	const deltaE = differenceEuclidean('oklab');
	const haiku = tokens.models.haiku.hex; // #f4ce3a (lemon)
	const brass = tokens.accent.hex; // #eba92c (the committed accent)

	// Floor: the brass accent must stay perceptually distinct from the nearest
	// categorical hue (haiku lemon) so brand gold never reads as a model color.
	// Measured ΔE(brass, lemon) ≈ 0.093; 0.085 sits just below it as the guard.
	const FLOOR = 0.085;

	it('brass accent clears the separation floor against haiku lemon', () => {
		expect(deltaE(brass, haiku)).toBeGreaterThanOrEqual(FLOOR);
	});

	it('the committed accent is the brass value', () => {
		expect(brass).toBe('#eba92c');
		expect(brass).not.toBe('#e0a52f'); // the superseded v1.6.0 accent
	});
});
