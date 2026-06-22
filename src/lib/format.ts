// Formatting + model-color helpers shared across the UI.

import { tokens } from './brand/tokens.js';

export function modelFamily(model: string): 'opus' | 'sonnet' | 'haiku' | 'other' {
	if (/opus/i.test(model)) return 'opus';
	if (/sonnet/i.test(model)) return 'sonnet';
	if (/haiku/i.test(model)) return 'haiku';
	return 'other';
}

/** HSL hue (degrees, 0–360) of a hex color. Local + dependency-free so the web
 *  bundle stays lean (culori is a dev-only dep). */
export function hueOf(hex: string): number {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) return 0;
	let hue: number;
	if (max === r) hue = ((g - b) / d) % 6;
	else if (max === g) hue = (b - r) / d + 2;
	else hue = (r - g) / d + 4;
	hue = Math.round(hue * 60);
	return (hue + 360) % 360;
}

// Family hue anchors (degrees on the HSL wheel), derived from the model-family
// brand tokens so they cannot drift from the source of truth. A model's color
// is its family hue shifted by a stable per-model offset, so every distinct
// model id gets a distinct-but-related color: opus stays purple-ish, sonnet
// blue-ish, etc.
const FAMILY_HUE: Record<string, number> = {
	opus: hueOf(tokens.models.opus.hex),
	sonnet: hueOf(tokens.models.sonnet.hex),
	haiku: hueOf(tokens.models.haiku.hex),
	other: hueOf(tokens.models.other.hex)
};

/** Deterministic 32-bit-ish hash of a string (FNV-1a), for stable color offsets. */
function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * Stable, visually-distinct color for a model id. Same model id always maps to
 * the same color, consistent across the chart, legend, donut, and detail sheet.
 * The hue is anchored to the model family then nudged per-id so two opus variants
 * read as related-but-distinct rather than identical.
 */
export function modelColor(model: string): string {
	const fam = modelFamily(model);
	const base = FAMILY_HUE[fam];
	const h = hashString(model);
	// spread within ±28° of the family hue; vary saturation/lightness a touch too.
	const hue = (base + ((h % 57) - 28) + 360) % 360;
	const sat = 70 + (h >> 8) % 18; // 70–87%
	const light = 62 + (h >> 16) % 12; // 62–73% (bright on near-black)
	return `hsl(${hue}deg ${sat}% ${light}%)`;
}

/** Same as modelColor but as a concrete value usable anywhere CSS vars aren't. */
export function modelHex(model: string): string {
	return modelColor(model);
}

const PROVIDER_COLOR: Record<string, string> = {
	claude: 'var(--m-opus)',
	codex: 'var(--m-sonnet)',
	opencode: 'var(--good)',
	cursor: 'var(--warn)'
};

export function providerColor(provider: string): string {
	return PROVIDER_COLOR[provider] ?? 'var(--m-other)';
}

export function providerLabel(provider: string): string {
	switch (provider) {
		case 'claude':
			return 'Claude Code';
		case 'codex':
			return 'Codex';
		case 'opencode':
			return 'OpenCode';
		case 'cursor':
			return 'Cursor';
		default:
			return provider;
	}
}

/** Short display label for a model id, e.g. "Opus 4.8". */
export function modelLabel(model: string): string {
	const m = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
	if (m) {
		const name = m[1][0].toUpperCase() + m[1].slice(1);
		return `${name} ${m[2]}.${m[3]}`;
	}
	return model;
}

const usd0 = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 0,
	maximumFractionDigits: 0
});
const usd2 = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});
const usd4 = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 4,
	maximumFractionDigits: 4
});

/** Money: big numbers compact-ish, small numbers with cents. */
export function money(v: number): string {
	if (v >= 1000) return usd0.format(v);
	if (v >= 0.01) return usd2.format(v);
	if (v > 0) return usd4.format(v);
	return '$0.00';
}

export function moneyPrecise(v: number): string {
	if (v >= 100) return usd2.format(v);
	return usd4.format(v);
}

/** Compact token count, e.g. 1.2M, 845K, 1.4B. */
export function compactTokens(v: number): string {
	if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
	if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
	return String(Math.round(v));
}

const intFmt = new Intl.NumberFormat('en-US');
export function int(v: number): string {
	return intFmt.format(Math.round(v));
}

/**
 * Signed percentage delta with sign, e.g. "+18%" / "-4%" / "—".
 *
 * `hasBaseline` distinguishes a real $0 prior period (we have data, it was zero)
 * from no prior data at all (the prior window predates our earliest record). When
 * there is genuinely no baseline, return null so the caller can suppress the
 * delta entirely rather than show a misleading "new" / percentage.
 */
export function pctDelta(
	curr: number,
	prev: number,
	hasBaseline = true
): { text: string; dir: 'up' | 'down' | 'flat' } | null {
	if (!hasBaseline) return null;
	if (prev === 0) {
		if (curr === 0) return { text: '—', dir: 'flat' };
		return { text: 'new', dir: 'up' };
	}
	const p = ((curr - prev) / prev) * 100;
	const dir = p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat';
	const sign = p > 0 ? '+' : '';
	return { text: `${sign}${p.toFixed(0)}%`, dir };
}

export function fmtDay(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
}

export function fmtPeriodKey(key: string): string {
	if (/^\d{4}-W\d{2}$/.test(key)) return key.replace('-W', ' W');
	if (/^\d{4}-\d{2}$/.test(key)) {
		const [y, m] = key.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}
	return fmtDay(key);
}

export function fmtDateTime(ts: number): string {
	return new Date(ts).toLocaleString('en-GB', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function fmtTimeRange(a: number, b: number): string {
	const fa = new Date(a);
	const fb = new Date(b);
	const sameDay = fa.toDateString() === fb.toDateString();
	const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
	if (sameDay) {
		return `${fa.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${fa.toLocaleTimeString('en-GB', opts)}–${fb.toLocaleTimeString('en-GB', opts)}`;
	}
	return `${fmtDateTime(a)} → ${fmtDateTime(b)}`;
}

/** Short project name from a path. */
export function shortProject(p: string): string {
	const parts = p.split('/').filter(Boolean);
	return parts.slice(-1)[0] ?? p;
}
