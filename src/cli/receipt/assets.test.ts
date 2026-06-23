import { describe, it, expect } from 'vitest';
import { barWidths, GOLD_MARK_SVG, PAPER } from './assets.js';

describe('barWidths (design LCG, ported verbatim)', () => {
	it('reproduces the design bars() integer width sequence exactly', () => {
		// The exact sequence the reference's bars() (seed 99, 44 iterations, plain
		// float `*`, 31-bit mask, width = (seed%3)+1) emits in the browser. This is
		// the float-arithmetic sequence — Math.imul would diverge (see assets.ts).
		const expected = [
			3, 2, 3, 1, 2, 1, 2, 2, 3, 2, 3, 1, 2, 2, 3, 1, 2, 1, 3, 3, 2, 1, 2, 2, 2, 2, 3, 1, 2, 2, 1, 3,
			1, 2, 2, 1, 2, 3, 3, 2, 1, 3, 1, 2
		];
		expect(barWidths()).toEqual(expected);
	});

	it('is deterministic and length 44 with widths in 1..3', () => {
		const a = barWidths();
		const b = barWidths();
		expect(a).toEqual(b);
		expect(a).toHaveLength(44);
		for (const w of a) expect(w).toBeGreaterThanOrEqual(1), expect(w).toBeLessThanOrEqual(3);
	});

	it('is parameterised (seed/n) for non-default callers', () => {
		expect(barWidths(99, 5)).toEqual(barWidths().slice(0, 5));
		expect(barWidths(1, 10)).toHaveLength(10);
	});
});

describe('design assets', () => {
	it('gold mark SVG carries the design fill + viewBox', () => {
		expect(GOLD_MARK_SVG).toContain('viewBox="0 0 24 24"');
		expect(GOLD_MARK_SVG).toContain('#9e6e14');
	});

	it('paper palette pins the design hexes', () => {
		expect(PAPER.cream).toBe('#f7f2e8');
		expect(PAPER.ink).toBe('#1c1913');
		expect(PAPER.green).toBe('#1f9d5b');
		expect(PAPER.gold).toBe('#9e6e14');
	});
});
