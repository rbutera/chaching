// Pure, presentation-agnostic derivation of how to MARK coverage provenance. The Svelte
// components and the CLI both read these so the visual/textual provenance can never drift
// across surfaces, and so the marks are unit-testable in a plain `node` env (no DOM).
//
// Marks are never colour-only (design D6): every state carries a WORD + a structural choice
// (hatched fill / dash slot), so `NO_COLOR` terminals and monochrome rendering stay correct.

import type { DayCoverage } from '../types';
import type { CoverageSummary } from './aggregate';

/** How a bar should be drawn for its (worst) coverage state. */
export type BarFill =
	| 'normal' // authoritative spend bar (frozen)
	| 'hatched' // partial (today / gated past day): striped fill + "so far" copy
	| 'zero' // a frozen genuine $0 day: a real zero-height bar, tooltip says "(no usage)"
	| 'dash'; // missing: a distinct empty/dash slot, NOT a $0 bar

const WORD = {
	frozen: 'final',
	partial: 'partial',
	zero: 'no usage',
	missing: 'no data'
} satisfies Record<DayCoverage, string>;

/** The single human word for a coverage state (used in tooltips + aria + CLI glyph-word). */
export function coverageWord(state: DayCoverage): string {
	return WORD[state];
}

const GLYPH = {
	frozen: '●',
	partial: '◐',
	zero: '○',
	missing: '·'
} satisfies Record<DayCoverage, string>;

/** A compact glyph for the CLI per-day provenance (word is the NO_COLOR-safe fallback). */
export function coverageGlyph(state: DayCoverage): string {
	return GLYPH[state];
}

/** The fill treatment for a bar given its bucket's coverage summary (drives the SVG). */
export function barFill(summary: CoverageSummary): BarFill {
	switch (summary.worst) {
		case 'partial':
			return 'hatched';
		case 'missing':
			return 'dash';
		case 'zero':
			return 'zero';
		case 'frozen':
			return 'normal';
	}
}

/**
 * The tooltip suffix for a bar's coverage. Empty for a plain authoritative frozen day
 * (no noise); a provenance note otherwise (partial today, $0 no-usage, gap).
 */
export function tooltipSuffix(summary: CoverageSummary): string {
	switch (summary.worst) {
		case 'partial':
			return 'so far today';
		case 'missing':
			return 'no data (gap in range)';
		case 'zero':
			return '$0 (no usage)';
		case 'frozen':
			return '';
	}
}

/** The provenance phrase folded into a bar's a11y aria-label. Always non-empty. */
export function ariaProvenance(summary: CoverageSummary): string {
	switch (summary.worst) {
		case 'partial':
			return 'partial, so far today';
		case 'missing':
			return 'no data for this day';
		case 'zero':
			return 'final, no usage';
		case 'frozen':
			return 'final';
	}
}

/**
 * A short, unobtrusive sub-line for a SummaryCard / hero from a window's coverage summary,
 * or null when the window is fully authoritative (no note needed). Partial wins over a gap
 * note (it is the more common, expected case — "today is still counting").
 */
export function coverageSub(summary: CoverageSummary): string | null {
	if ((summary.states.partial ?? 0) > 0) return 'includes today (partial)';
	if ((summary.states.missing ?? 0) > 0) return 'gaps in range';
	return null;
}
