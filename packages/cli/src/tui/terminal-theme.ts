import type { Readable } from 'node:stream';
import { palettes, paletteVars } from '@chaching/shared/brand/palettes';

export interface TerminalTheme {
	bg: string;
	fg: string;
	dim: string;
	border: string;
	panel: string;
	selected: string;
	accent: string;
	good: string;
	bad: string;
	warn: string;
	providers: Record<string, string>;
	spend: string[];
}
export interface TerminalColors {
	foreground?: string;
	background?: string;
	palette: (string | undefined)[];
}
type Rgb = [number, number, number];
function rgb(hex: string): Rgb {
	const n = Number.parseInt(hex.slice(1), 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}
function hex(c: Rgb): string {
	return '#' + c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}
function blend(a: Rgb, b: Rgb, w: number): Rgb {
	return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}
function luminance(c: Rgb): number {
	const v = c.map((n) => (n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4));
	return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
}
function contrast(a: Rgb, b: Rgb): number {
	const x = luminance(a),
		y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function hue(c: Rgb): number {
	const [r, g, b] = c,
		span = Math.max(...c) - Math.min(...c);
	if (!span) return 0;
	return (
		((Math.max(...c) === r
			? (g - b) / span
			: Math.max(...c) === g
				? (b - r) / span + 2
				: (r - g) / span + 4) *
			60 +
			360) %
		360
	);
}
function chroma(c: Rgb): number {
	return (Math.max(...c) - Math.min(...c)) / 255;
}
function readable(c: Rgb, bg: Rgb, fg: Rgb): string {
	for (let step = 0; step <= 20; step++) {
		const candidate = blend(c, fg, step / 20);
		if (contrast(candidate, bg) >= 4.5) return hex(candidate);
	}
	return hex(fg);
}
export function fallbackTheme(mode: 'light' | 'dark'): TerminalTheme {
	const p = palettes.find((p) => p.id === `register-${mode}`)!;
	const v = paletteVars(p);
	return {
		bg: p.surfaces[0],
		fg: p.text,
		dim: p.dim,
		border: p.border,
		panel: p.surfaces[1],
		selected: p.surfaces[3],
		accent: v['accent-ink'],
		good: p.green,
		bad: p.red,
		warn: v['warn-ink'],
		providers: {
			claude: p.orange,
			codex: p.blue,
			pi: p.purple,
			cursor: p.muted,
			opencode: p.muted,
			unknown: p.muted,
		},
		spend: [p.green, v['accent-ink'], p.orange, p.red],
	};
}
export function resolveTerminalTheme(colors: TerminalColors, mode: 'light' | 'dark'): TerminalTheme {
	const base = fallbackTheme(mode);
	if (
		!colors.foreground ||
		!colors.background ||
		!/^#[\da-f]{6}$/i.test(colors.foreground) ||
		!/^#[\da-f]{6}$/i.test(colors.background)
	)
		return base;
	const fg = rgb(colors.foreground),
		bg = rgb(colors.background);
	if (contrast(fg, bg) < 4.5) return base;
	const semantic = (slot: number, fallback: string) => {
		const normal = colors.palette[slot],
			bright = colors.palette[slot + 8];
		const choices = [normal, bright]
			.filter((v): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v))
			.map(rgb);
		const target = rgb(normal && /^#[\da-f]{6}$/i.test(normal) ? normal : fallback);
		const meaningful = choices.filter(
			(c) =>
				chroma(c) >= 0.1 &&
				Math.min(Math.abs(hue(c) - hue(target)), 360 - Math.abs(hue(c) - hue(target))) <= 45,
		);
		meaningful.sort((a, b) => contrast(b, bg) - contrast(a, bg));
		return readable(meaningful[0] ?? rgb(fallback), bg, fg);
	};
	const targetOrange = rgb(base.providers.claude);
	const oranges = colors.palette
		.filter((value): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value))
		.map(rgb)
		.filter((c) => chroma(c) >= 0.1 && Math.abs(hue(c) - hue(targetOrange)) <= 30);
	oranges.sort((a, b) => Math.abs(hue(a) - hue(targetOrange)) - Math.abs(hue(b) - hue(targetOrange)));
	const orange = readable(oranges[0] ?? targetOrange, bg, fg);
	const blue = semantic(4, base.providers.codex),
		purple = semantic(5, base.providers.pi);
	const good = semantic(2, base.good),
		bad = semantic(1, base.bad),
		warn = semantic(3, base.warn);
	const dim = readable(blend(bg, fg, 0.65), bg, fg),
		accent = semantic(3, base.accent);
	return {
		bg: hex(bg),
		fg: hex(fg),
		dim,
		border: hex(blend(bg, fg, 0.3)),
		panel: hex(blend(bg, fg, 0.05)),
		selected: hex(blend(bg, fg, 0.12)),
		accent,
		good,
		bad,
		warn,
		providers: { claude: orange, codex: blue, pi: purple, cursor: dim, opencode: dim, unknown: dim },
		spend: [good, accent, orange, bad],
	};
}
export function environmentMode(env: NodeJS.ProcessEnv): 'light' | 'dark' {
	const value = env.COLORFGBG?.split(';').pop();
	return value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 7 ? 'light' : 'dark';
}
export function parseTerminalReplies(text: string): {
	colors: TerminalColors;
	mode?: 'light' | 'dark';
	remainder: string;
} {
	const colors: TerminalColors = { palette: [] };
	let mode: 'light' | 'dark' | undefined;
	let remainder = text.replace(/\x1b\[\?997;([12])n/g, (_, v) => {
		mode = v === '1' ? 'dark' : 'light';
		return '';
	});
	remainder = remainder.replace(
		/\x1b\](10|11|4;\d{1,2});([^\x07\x1b]*)(?:\x07|\x1b\\)/g,
		(_, slot: string, value: string) => {
			const m = /^rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})$/i.exec(value);
			if (m) {
				const color =
					'#' +
					m
						.slice(1)
						.map((c) =>
							Math.round((Number.parseInt(c, 16) / (16 ** c.length - 1)) * 255)
								.toString(16)
								.padStart(2, '0'),
						)
						.join('');
				if (slot === '10') colors.foreground = color;
				else if (slot === '11') colors.background = color;
				else {
					const index = Number(slot.slice(2));
					if (index < 16) colors.palette[index] = color;
				}
			}
			return '';
		},
	);
	return { colors, mode, remainder };
}

/** Query before Ink owns stdin; replay non-response bytes once Ink attaches. */
type TerminalInput = Readable & {
	isTTY: boolean;
	isRaw: boolean;
	setRawMode(value: boolean): unknown;
};
export async function discoverTerminalTheme(
	input: TerminalInput = process.stdin,
	output: Pick<NodeJS.WriteStream, 'write' | 'isTTY'> = process.stdout,
	env = process.env,
): Promise<TerminalTheme> {
	const override = env.CHACHING_THEME?.trim().toLowerCase();
	const fallback = environmentMode(env);
	if (override === 'light' || override === 'dark') return fallbackTheme(override);
	if (env.NO_COLOR !== undefined || !input.isTTY || !output.isTTY || input.listenerCount('data'))
		return fallbackTheme(fallback);
	return new Promise((resolve) => {
		let buffer = '',
			phase = 0,
			timer: ReturnType<typeof setTimeout>;
		const raw = input.isRaw,
			flowing = input.readableFlowing;
		const finish = () => {
			clearTimeout(timer);
			input.pause();
			input.off('data', receive);
			input.off('error', finish);
			input.setRawMode(raw);
			const parsed = parseTerminalReplies(buffer);
			if (parsed.remainder) input.unshift(Buffer.from(parsed.remainder, 'latin1'));
			if (flowing) setImmediate(() => input.resume());
			resolve(resolveTerminalTheme(parsed.colors, parsed.mode ?? fallback));
		};
		const palette = () => {
			clearTimeout(timer);
			phase = 1;
			timer = setTimeout(finish, 400);
			output.write(
				'\x1b]10;?\x07\x1b]11;?\x07' + Array.from({ length: 16 }, (_, i) => `\x1b]4;${i};?\x07`).join(''),
			);
		};
		const receive = (data: Buffer | string) => {
			buffer += Buffer.isBuffer(data) ? data.toString('latin1') : data;
			const parsed = parseTerminalReplies(buffer);
			if (!phase && parsed.mode) palette();
			else if (
				phase &&
				parsed.colors.foreground &&
				parsed.colors.background &&
				parsed.colors.palette.filter(Boolean).length === 16
			)
				finish();
		};
		input.setRawMode(true);
		input.on('data', receive);
		input.once('error', finish);
		input.resume();
		timer = setTimeout(palette, 400);
		output.write('\x1b[?996n');
	});
}
