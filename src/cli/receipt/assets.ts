// Shared receipt assets + design constants for the chaching "Till Stack" thermal
// receipt — the cream-paper design ported 1:1 from the DesignSync reference
// (ui_kits/receipt/index.html). Used by render-png.ts (and barWidths by the text
// renderer if it wants the same bars). Pure: no IO, no env.

/**
 * The design's deterministic barcode LCG, ported VERBATIM from the reference's
 * `bars()`:
 *
 *   let seed = 99;
 *   for (i = 0; i < 44; i++) { seed = (seed*1103515245+12345)&0x7fffffff; w = (seed%3)+1 }
 *
 * Returns the exact integer width sequence (1..3 px each) the design draws, so the
 * PNG bars are pixel-identical to the mock and fully deterministic. `seed`/`n` are
 * parameterised for testing but default to the design's values.
 */
export function barWidths(seed = 99, n = 44): number[] {
	const widths: number[] = [];
	let s = seed;
	for (let i = 0; i < n; i++) {
		// VERBATIM from the design's bars(): plain float `*` (NOT Math.imul) then a
		// 31-bit mask. The intermediate `s * 1103515245` exceeds 2^53, so float
		// rounding is PART of the sequence — using Math.imul here would produce a
		// DIFFERENT barcode than the design. We reproduce the design's arithmetic
		// exactly so the PNG bars are pixel-identical to the reference.
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		widths.push((s % 3) + 1);
	}
	return widths;
}

/**
 * The design's gold mark, the exact inline SVG from the reference (`viewBox
 * 0 0 24 24`, `fill #9e6e14`). Rendered to a PNG data-URI before being handed to
 * satori (satori-embedded SVG-in-<image> rasterises BLANK under resvg — see
 * svgToPngDataUri). The 24×24 viewBox is rasterised at 2× the on-paper size.
 */
export const GOLD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9e6e14"><g><path fill-rule="evenodd" d="M12 1.5 22 6.1 12 10.7 2 6.1ZM9.2 5.35h5.6v1.5H9.2Z"/><path d="m2 10.35 10 4.6 10-4.6v3.2l-10 4.6-10-4.6Z"/><path d="m2 16.15 10 4.6 10-4.6v3.2L12 23.95 2 19.35Z"/></g></svg>`;

/**
 * A small "→" arrow in the muted sub colour, for the header date range. The
 * Unicode arrow (U+2192) is tofu in the vendored latin mono subset, so the range
 * separator is drawn as this inline SVG and rasterised to a PNG (R-row discipline).
 */
export const RANGE_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" fill="none" stroke="#8a8273" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h9.2M7.2 1 10.5 4 7.2 7"/></svg>`;

/**
 * The design's paper-surface palette — the exact `.paper`-scope token values from
 * chaching-ds-tokens' colors.css, pinned here as literals because satori needs
 * concrete colours and does not run the `.paper` CSS scope. A token change is a
 * one-line update; each constant is tied by comment to its token name.
 */
export const PAPER = {
	/** --cream-50 — the thermal tape surface */
	cream: '#f7f2e8',
	/** --cream-ink — the printed ink */
	ink: '#1c1913',
	/** coupon / "you saved" green (.li.coupon, .li.saved) */
	green: '#1f9d5b',
	/** the gold mark fill (--brass on paper) */
	gold: '#9e6e14',
	/** dashed/dotted rule (.rule, .rule.dot) */
	rule: '#b9a986',
	/** dotted leader (.li .lead border-bottom) */
	leader: '#c3b696',
	/** sub / ref / sec-label muted (.r-sub, .ref, .sec-label) */
	muted: '#8a8273',
	/** footer copy (.foot) */
	footer: '#6b6454',
	/** sub-small dim (.nm small) */
	subSmall: '#a89e88',
	/** redaction block (.redacted) */
	redaction: '#c9bda3'
} as const;
