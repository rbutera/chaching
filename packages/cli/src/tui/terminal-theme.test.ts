import { PassThrough, Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import {
	discoverTerminalTheme,
	environmentMode,
	fallbackTheme,
	parseTerminalReplies,
	resolveTerminalTheme,
} from './terminal-theme';

describe('terminal palette', () => {
	it('parses split-compatible OSC replies without consuming keyboard input', () => {
		const reply =
			'q\x1b[?997;2n\x1b]10;rgb:0000/0000/0000\x1b\\\x1b]11;rgb:ffff/ffff/ffff\x07\x1b]4;4;rgb:00/44/aa\x07x';
		const parsed = parseTerminalReplies(reply);
		expect(parsed.mode).toBe('light');
		expect(parsed.colors.foreground).toBe('#000000');
		expect(parsed.colors.background).toBe('#ffffff');
		expect(parsed.colors.palette[4]).toBe('#0044aa');
		expect(parsed.remainder).toBe('qx');
	});
	it('falls back on invalid colours and honours COLORFGBG', () => {
		expect(environmentMode({ COLORFGBG: '15;0' })).toBe('dark');
		expect(environmentMode({ COLORFGBG: '0;15' })).toBe('light');
		expect(environmentMode({ COLORFGBG: 'bad' })).toBe('dark');
		expect(
			resolveTerminalTheme({ foreground: '#aaaaaa', background: '#aaaaaa', palette: [] }, 'light'),
		).toEqual(fallbackTheme('light'));
		expect(parseTerminalReplies('\x1b]11;bogus\x07x').remainder).toBe('x');
	});
	it('adopts real surfaces while rejecting gray bright semantic slots', () => {
		const palette = [
			'#073642',
			'#dc322f',
			'#859900',
			'#b58900',
			'#268bd2',
			'#d33682',
			'#2aa198',
			'#eee8d5',
			'#002b36',
			'#cb4b16',
			'#586e75',
			'#657b83',
			'#839496',
			'#6c71c4',
			'#93a1a1',
			'#fdf6e3',
		];
		const theme = resolveTerminalTheme({ foreground: '#fdf6e3', background: '#002b36', palette }, 'dark');
		expect(theme.bg).toBe('#002b36');
		expect(theme.fg).toBe('#fdf6e3');
		expect(theme.good).not.toBe(palette[10]);
		expect(theme.providers.codex).not.toBe(palette[12]);
		expect(theme.providers.cursor).toBe(theme.dim);
		expect(theme.panel).not.toBe(theme.bg);
	});
});

class Input extends PassThrough {
	isTTY = true;
	isRaw = false;
	setRawMode(value: boolean) {
		this.isRaw = value;
		return this;
	}
}
it('bounds discovery, replays keys and restores raw mode and listeners', async () => {
	const input = new Input();
	const output = Object.assign(
		new Writable({
			write(chunk, _encoding, done) {
				const query = String(chunk);
				if (query.includes('996')) input.write('q\x1b[?997;2n');
				else {
					input.write('\x1b]10;rgb:00/00/00\x07\x1b]11;rgb:ff/ff/ff\x07');
					for (let i = 0; i < 16; i++) input.write(`\x1b]4;${i};rgb:00/44/88\x07`);
				}
				done();
			},
		}),
		{ isTTY: true },
	);
	const theme = await discoverTerminalTheme(input, output, {});
	expect(theme.bg).toBe('#ffffff');
	expect(input.isRaw).toBe(false);
	expect(input.listenerCount('data')).toBe(0);
	expect(input.listenerCount('error')).toBe(0);
	expect(input.read()?.toString()).toBe('q');
	const silent = new Input();
	const sink = Object.assign(new PassThrough(), { isTTY: true });
	const started = Date.now();
	expect(await discoverTerminalTheme(silent, sink, { COLORFGBG: '0;15' })).toEqual(fallbackTheme('light'));
	expect(Date.now() - started).toBeLessThan(1500);
	expect(silent.isRaw).toBe(false);
	expect(silent.listenerCount('data')).toBe(0);
	for (const env of [{ NO_COLOR: '1' }, { CHACHING_THEME: 'light' }]) {
		const target = new Input();
		const out = Object.assign(new PassThrough(), { isTTY: true });
		await discoverTerminalTheme(target, out, env);
		expect(out.read()).toBeNull();
		expect(target.isRaw).toBe(false);
	}
});
