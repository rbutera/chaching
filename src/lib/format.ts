// Formatting + model-color helpers shared across the UI.

export function modelFamily(model: string): 'opus' | 'sonnet' | 'haiku' | 'other' {
	if (/opus/i.test(model)) return 'opus';
	if (/sonnet/i.test(model)) return 'sonnet';
	if (/haiku/i.test(model)) return 'haiku';
	return 'other';
}

const FAMILY_COLOR: Record<string, string> = {
	opus: 'var(--m-opus)',
	sonnet: 'var(--m-sonnet)',
	haiku: 'var(--m-haiku)',
	other: 'var(--m-other)'
};

// Resolved hex values (for canvas where CSS vars aren't readable directly).
const FAMILY_HEX: Record<string, string> = {
	opus: '#c084fc',
	sonnet: '#38bdf8',
	haiku: '#facc15',
	other: '#94a3b8'
};

export function modelColor(model: string): string {
	return FAMILY_COLOR[modelFamily(model)];
}

export function modelHex(model: string): string {
	return FAMILY_HEX[modelFamily(model)];
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

/** Signed percentage delta with sign, e.g. "+18%" / "-4%" / "—". */
export function pctDelta(curr: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
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
