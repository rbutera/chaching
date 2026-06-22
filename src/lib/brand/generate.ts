// Generators: turn the typed brand tokens into the two consumer artifacts.
//
//  - toCss(tokens)    → the web `:root` custom-property block (committed into
//                       src/app.css between BEGIN/END GENERATED markers; a unit
//                       test asserts the committed block equals this output).
//  - toAnsiMap(tokens) → the structured map the CLI/TUI consumes at runtime.
//
// The render path passes token hex to chalk/Ink (which auto-downsamples
// Truecolor → 256 → 16). The curated `ansi` name is the explicit basic-tier
// fallback. The 256 path goes through ansi-styles' hexToAnsi256 — never a
// hand-rolled converter (design D7).

import styles from 'ansi-styles';

import type { BrandToken, ChalkBasicName, Tokens } from './tokens.js';

/** Markers that bracket the generated block inside src/app.css. */
export const CSS_BEGIN_MARKER = '/* BEGIN GENERATED brand tokens — do not hand-edit (src/lib/brand) */';
export const CSS_END_MARKER = '/* END GENERATED brand tokens */';

/**
 * Emit the `:root` color custom-property block, using the names the web app and
 * src/lib/format.ts already reference. Only color vars are generated here; the
 * non-color vars (radius, shadow, fonts, maxw, color-scheme) stay hand-authored
 * outside the markers.
 */
export function toCss(t: Tokens): string {
	const lines = [
		CSS_BEGIN_MARKER,
		'\t/* surfaces (near-black, not pure #000) */',
		`\t--bg: ${t.surfaces.bg.hex};`,
		`\t--surface-1: ${t.surfaces.surface1.hex};`,
		`\t--surface-2: ${t.surfaces.surface2.hex};`,
		`\t--surface-3: ${t.surfaces.surface3.hex};`,
		`\t--border: ${t.surfaces.border.hex};`,
		`\t--border-strong: ${t.surfaces.borderStrong.hex};`,
		'',
		'\t/* text */',
		`\t--fg: ${t.fg.fg.hex};`,
		`\t--fg-muted: ${t.fg.muted.hex};`,
		`\t--fg-dim: ${t.fg.dim.hex};`,
		'',
		'\t/* accents */',
		`\t--accent: ${t.accent.hex};`,
		`\t--good: ${t.status.good.hex};`,
		`\t--bad: ${t.status.bad.hex};`,
		`\t--warn: ${t.status.warn.hex};`,
		'',
		'\t/* model family palette — categorical, brightened for dark bg, 3:1+ vs surfaces */',
		`\t--m-opus: ${t.models.opus.hex};`,
		`\t--m-sonnet: ${t.models.sonnet.hex};`,
		`\t--m-haiku: ${t.models.haiku.hex};`,
		`\t--m-other: ${t.models.other.hex};`,
		CSS_END_MARKER
	];
	return lines.join('\n');
}

/** A token resolved for terminal rendering. */
export interface AnsiColor {
	/** Truecolor source — pass to chalk/Ink, which auto-downsamples. */
	hex: string;
	/** Curated 16-color basic-tier fallback name. */
	basic: ChalkBasicName;
	/** 256-color index, via ansi-styles (no hand-rolled converter). */
	ansi256: number;
}

export interface AnsiMap {
	accent: AnsiColor;
	good: AnsiColor;
	bad: AnsiColor;
	warn: AnsiColor;
	dim: AnsiColor;
	models: {
		opus: AnsiColor;
		sonnet: AnsiColor;
		haiku: AnsiColor;
		other: AnsiColor;
	};
	providers: {
		claude: AnsiColor;
		codex: AnsiColor;
		opencode: AnsiColor;
		cursor: AnsiColor;
	};
}

function resolve(token: BrandToken): AnsiColor {
	return {
		hex: token.hex,
		basic: token.ansi,
		ansi256: styles.hexToAnsi256(token.hex)
	};
}

/**
 * The structured ANSI map the CLI consumes. Each token resolves to a renderable
 * color: hex (truecolor source for chalk/Ink), the curated basic name, and the
 * ansi-styles-computed 256 index.
 */
export function toAnsiMap(t: Tokens): AnsiMap {
	return {
		accent: resolve(t.accent),
		good: resolve(t.status.good),
		bad: resolve(t.status.bad),
		warn: resolve(t.status.warn),
		dim: resolve(t.fg.dim),
		models: {
			opus: resolve(t.models.opus),
			sonnet: resolve(t.models.sonnet),
			haiku: resolve(t.models.haiku),
			other: resolve(t.models.other)
		},
		providers: {
			claude: resolve(t.providers.claude),
			codex: resolve(t.providers.codex),
			opencode: resolve(t.providers.opencode),
			cursor: resolve(t.providers.cursor)
		}
	};
}
