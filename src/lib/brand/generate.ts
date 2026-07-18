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

import type { BrandToken, ChalkBasicName, Texture, Tokens } from './tokens.js';
import { texture } from './tokens.js';

/** Markers that bracket the generated block inside src/app.css. */
export const CSS_BEGIN_MARKER = '/* BEGIN GENERATED brand tokens — do not hand-edit (src/lib/brand) */';
export const CSS_END_MARKER = '/* END GENERATED brand tokens */';

/**
 * Emit the `:root` custom-property block: the semantic + raw colors, plus the
 * non-color register geometry (rail sizing, paper grain, torn-edge mask) so
 * those single-source through the same block. The remaining non-color vars
 * (radius, shadow, fonts, maxw, color-scheme) stay hand-authored outside the
 * markers.
 */
export function toCss(t: Tokens, tex: Texture = texture): string {
	const r = t.ramps;
	const h = t.hues;
	const lines = [
		CSS_BEGIN_MARKER,
		'\t/* ── Raw ramps (warm ink / paper-white / brass gold / cream) ─── */',
		`\t--ink-950: ${r.ink950.hex};`,
		`\t--ink-900: ${r.ink900.hex};`,
		`\t--ink-850: ${r.ink850.hex};`,
		`\t--ink-800: ${r.ink800.hex};`,
		`\t--ink-750: ${r.ink750.hex};`,
		`\t--ink-700: ${r.ink700.hex};`,
		`\t--ink-600: ${r.ink600.hex};`,
		`\t--paper-50: ${r.paper50.hex};`,
		`\t--paper-200: ${r.paper200.hex};`,
		`\t--paper-400: ${r.paper400.hex};`,
		`\t--paper-600: ${r.paper600.hex};`,
		`\t--gold-300: ${r.gold300.hex};`,
		`\t--gold-400: ${r.gold400.hex};`,
		`\t--gold-500: ${r.gold500.hex};`,
		`\t--gold-600: ${r.gold600.hex};`,
		`\t--gold-700: ${r.gold700.hex};`,
		`\t--cream-50: ${r.cream50.hex};`,
		`\t--cream-100: ${r.cream100.hex};`,
		`\t--cream-200: ${r.cream200.hex};`,
		`\t--cream-300: ${r.cream300.hex};`,
		`\t--cream-ink: ${r.creamInk.hex};`,
		'',
		'\t/* ── Raw categorical + status hues (data encoding, never gold) ── */',
		`\t--green-500: ${h.green500.hex};`,
		`\t--orange-500: ${h.orange500.hex};`,
		`\t--red-500: ${h.red500.hex};`,
		`\t--amber-500: ${h.amber500.hex};`,
		`\t--purple: ${h.purple.hex};`,
		`\t--sky: ${h.sky.hex};`,
		`\t--lemon: ${h.lemon.hex};`,
		`\t--mint: ${h.mint.hex};`,
		`\t--slate: ${h.slate.hex};`,
		'',
		'\t/* ── Semantic surfaces (dark register, default) ─────────────── */',
		`\t--bg: ${t.surfaces.bg.hex};`,
		`\t--surface-1: ${t.surfaces.surface1.hex};`,
		`\t--surface-2: ${t.surfaces.surface2.hex};`,
		`\t--surface-3: ${t.surfaces.surface3.hex};`,
		`\t--surface-inset: ${r.ink800.hex};`,
		`\t--border: ${t.surfaces.border.hex};`,
		`\t--border-strong: ${t.surfaces.borderStrong.hex};`,
		`\t--border-faint: ${r.ink750.hex};`,
		'',
		'\t/* ── Semantic text (legacy --fg* aliases preserved) ─────────── */',
		`\t--text: ${t.fg.fg.hex};`,
		`\t--text-muted: ${t.fg.muted.hex};`,
		`\t--text-dim: ${t.fg.dim.hex};`,
		`\t--text-on-gold: #20170a;`,
		`\t--fg: ${t.fg.fg.hex};`,
		`\t--fg-muted: ${t.fg.muted.hex};`,
		`\t--fg-dim: ${t.fg.dim.hex};`,
		'',
		'\t/* ── Brand accent (brass gold) + aliases ─────────────────────── */',
		`\t--accent: ${t.accent.hex};`,
		`\t--accent-bright: ${r.gold400.hex};`,
		`\t--accent-press: ${r.gold600.hex};`,
		`\t--accent-soft: color-mix(in srgb, var(--gold-500) 14%, var(--surface-2));`,
		`\t--accent-line: color-mix(in srgb, var(--gold-500) 40%, var(--border));`,
		`\t--focus-ring: ${t.focus.hex};`,
		'',
		'\t/* ── Status semantics ────────────────────────────────────────── */',
		`\t--good: ${t.status.good.hex};`,
		`\t--bad: ${t.status.bad.hex};`,
		`\t--warn: ${t.status.warn.hex};`,
		`\t--info: ${t.status.info.hex};`,
		'',
		'\t/* ── Spend escalation ladder (calm → warm → hot → alarm) ─────── */',
		`\t--spend-calm: ${t.spend.calm.hex};`,
		`\t--spend-warm: ${t.spend.warm.hex};`,
		`\t--spend-hot: ${t.spend.hot.hex};`,
		`\t--spend-alarm: ${t.spend.alarm.hex};`,
		'',
		'\t/* ── Cache-state encoding ────────────────────────────────────── */',
		`\t--cache-hit: ${t.cache.hit.hex};`,
		`\t--cache-miss: ${t.cache.miss.hex};`,
		`\t--cache-write: ${t.cache.write.hex};`,
		'',
		'\t/* ── Model family palette — categorical, 3:1+ vs surfaces ─────── */',
		`\t--m-opus: ${t.models.opus.hex};`,
		`\t--m-sonnet: ${t.models.sonnet.hex};`,
		`\t--m-haiku: ${t.models.haiku.hex};`,
		`\t--m-other: ${t.models.other.hex};`,
		'',
		'\t/* ── Provider palette ────────────────────────────────────────── */',
		`\t--p-claude: ${t.providers.claude.hex};`,
		`\t--p-codex: ${t.providers.codex.hex};`,
		`\t--p-opencode: ${t.providers.opencode.hex};`,
		`\t--p-cursor: ${t.providers.cursor.hex};`,
		`\t--p-pi: ${t.providers.pi.hex};`,
		'',
		'\t/* ── Register chrome — structural warmth only (never a data mark) ── */',
		`\t--chrome-brass: ${t.chrome.brass.hex};`,
		`\t--chrome-ember: ${t.chrome.ember.hex};`,
		`\t--chrome-edge: ${t.chrome.edge.hex};`,
		'',
		'\t/* ── Register texture + rail geometry (non-color, single source) ── */',
		`\t--rail-w: ${tex.rail.w};`,
		`\t--rail-w-min: ${tex.rail.wMin};`,
		`\t--grain-opacity: ${tex.grain.opacity};`,
		`\t--grain-image: ${tex.grain.image};`,
		`\t--tear-tooth: ${tex.tear.tooth};`,
		`\t--tear-mask: ${tex.tear.mask};`,
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
	/** Spend-escalation ladder (calm → warm → hot → alarm), for the 5h-block flourish. */
	spend: {
		calm: AnsiColor;
		warm: AnsiColor;
		hot: AnsiColor;
		alarm: AnsiColor;
	};
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
		pi: AnsiColor;
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
		spend: {
			calm: resolve(t.spend.calm),
			warm: resolve(t.spend.warm),
			hot: resolve(t.spend.hot),
			alarm: resolve(t.spend.alarm)
		},
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
			cursor: resolve(t.providers.cursor),
			pi: resolve(t.providers.pi)
		}
	};
}
