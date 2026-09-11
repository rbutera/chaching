// Throwaway palette proposals. Fixed-brand receipt consumers still import tokens.ts.
import { tokens } from './tokens';

type Palette = {
	id: string; name: string; scheme: 'light' | 'dark'; note: string;
	surfaces: [string, string, string, string]; border: string;
	text: string; muted: string; dim: string; accent: string;
	purple: string; blue: string; yellow: string; green: string; red: string; orange: string;
};

export const palettes: Palette[] = [
	{ id: 'register-dark', name: 'Register & Receipt Dark', scheme: 'dark', note: 'Original brass and warm ink. Dim text and cache misses raised for readable small labels.', surfaces: [tokens.surfaces.bg.hex, tokens.surfaces.surface1.hex, tokens.surfaces.surface2.hex, tokens.surfaces.surface3.hex], border: '#4a443b', text: '#f4efe4', muted: '#aaa090', dim: '#9a9080', accent: '#eba92c', purple: '#b98cfb', blue: '#4cb8f0', yellow: '#f4ce3a', green: '#54cc85', red: '#f4736b', orange: '#f7913c' },
	{ id: 'register-light', name: 'Register & Receipt Light', scheme: 'light', note: 'Neutral white surfaces and brighter amber marks, with darker accent ink for small text. Claude is orange; Pi is purple.', surfaces: ['#ffffff','#fafafa','#f4f4f4','#ededed'], border: '#c4c4c4', text: '#202020', muted: '#545454', dim: '#626262', accent: '#b77900', purple: '#7142ae', blue: '#12668e', yellow: '#536700', green: '#246b40', red: '#ab3434', orange: '#a64900' },
	{ id: 'one-dark', name: 'One Dark Pro', scheme: 'dark', note: 'Cool editor surfaces and blue action accent. Yellow carries money warmth; muted text is lifted above editor-comment contrast.', surfaces: ['#21252b','#282c34','#2c313a','#303640'], border: '#535965', text: '#abb2bf', muted: '#abb2bf', dim: '#a0a8b6', accent: '#61afef', purple: '#cf8be2', blue: '#61afef', yellow: '#e5c07b', green: '#98c379', red: '#e9a0a7', orange: '#dca77d' },
	{ id: 'github-dark', name: 'GitHub Dark', scheme: 'dark', note: 'GitHub neutral charcoal and blue action accent. Gold becomes ochre in the spend ladder.', surfaces: ['#0d1117','#161b22','#1c2128','#21262d'], border: '#484f58', text: '#e6edf3', muted: '#9da7b3', dim: '#9da7b3', accent: '#58a6ff', purple: '#bc8cff', blue: '#58a6ff', yellow: '#d29922', green: '#3fb950', red: '#ff7b72', orange: '#ffa657' },
	{ id: 'github-light', name: 'GitHub Light', scheme: 'light', note: 'White and cool gray. GitHub blue for actions; darker categorical colours keep small labels readable.', surfaces: ['#ffffff','#f6f8fa','#f0f2f4','#eaeef2'], border: '#afb8c1', text: '#24292f', muted: '#57606a', dim: '#57606a', accent: '#0963ce', purple: '#7947d5', blue: '#0963ce', yellow: '#7d5b00', green: '#187a34', red: '#cf222e', orange: '#953800' },
	{ id: 'mocha', name: 'Catppuccin Mocha', scheme: 'dark', note: 'Mauve action accent; peach carries money and warm spend, yellow is reserved for warning status. Familiar pastel hues on dark violet surfaces.', surfaces: ['#181825','#1e1e2e','#242436','#313244'], border: '#585b70', text: '#cdd6f4', muted: '#bac2de', dim: '#a6adc8', accent: '#cba6f7', purple: '#cba6f7', blue: '#89b4fa', yellow: '#f9e2af', green: '#a6e3a1', red: '#f38ba8', orange: '#fab387' },
	{ id: 'latte', name: 'Catppuccin Latte', scheme: 'light', note: 'Latte neutrals and mauve. Peach and yellow are darkened for readable labels; money uses the peach family.', surfaces: ['#eff1f5','#e6e9ef','#dce0e8','#d5dae3'], border: '#9ca0b0', text: '#4c4f69', muted: '#55586f', dim: '#55586f', accent: '#782bd7', purple: '#782bd7', blue: '#174eaf', yellow: '#795500', green: '#326b18', red: '#b51035', orange: '#93440b' }
];

export function paletteVars(p: Palette) {
	const accentInk = p.id === 'register-light' ? '#855a08' : p.accent;
	return {
		'bg': p.surfaces[0], 'surface-1': p.surfaces[1], 'surface-2': p.surfaces[2], 'surface-3': p.surfaces[3],
		'surface-inset': p.surfaces[3], 'border': p.border, 'border-strong': p.border, 'border-faint': p.border,
		'text': p.text, 'text-muted': p.muted, 'text-dim': p.dim, 'fg': p.text, 'fg-muted': p.muted, 'fg-dim': p.dim,
		'accent': p.accent, 'accent-ink': accentInk, 'accent-bright': p.accent, 'accent-press': p.accent, 'focus-ring': p.accent,
		'accent-soft': p.surfaces[2], 'accent-line': p.accent, 'text-on-gold': p.surfaces[0],
		'good': p.green, 'bad': p.red, 'warn': '#f4ce3a', 'warn-ink': p.scheme === 'light' ? '#665000' : '#f4ce3a', 'info': p.blue,
		'm-claude': p.orange, 'm-codex': p.blue, 'm-opencode': p.muted, 'm-cursor': p.muted, 'm-pi': p.purple, 'm-unknown': p.muted,
		'p-claude': p.orange, 'p-codex': p.blue, 'p-opencode': p.muted, 'p-cursor': p.muted, 'p-pi': p.purple, 'p-unknown': p.muted,
		'spend-calm': p.green, 'spend-warm': p.id.startsWith('register') ? p.accent : p.orange, 'spend-hot': p.orange, 'spend-alarm': p.red,
		'cache-hit': p.green, 'cache-miss': p.dim, 'cache-write': p.blue,
		'chrome-brass': p.accent, 'chrome-ember': p.orange, 'chrome-edge': p.accent,
		'gold-400': accentInk, 'gold-500': p.accent, 'gold-600': p.accent, 'paper-200': p.muted,
		'purple': p.purple, 'sky': p.blue, 'lemon': p.yellow, 'mint': p.green, 'slate': p.muted
	};
}

export const semanticGroups = {
	'Text': ['text','text-muted','text-dim','accent-ink'],
	'Accent': ['accent','focus-ring'],
	'Providers': ['p-claude','p-codex','p-opencode','p-cursor','p-pi','p-unknown'],
	'Models by provider': ['m-claude','m-codex','m-opencode','m-cursor','m-pi','m-unknown'],
	'Status': ['good','bad','warn','warn-ink','info'],
	'Spend': ['spend-calm','spend-warm','spend-hot','spend-alarm'],
	'Cache': ['cache-hit','cache-miss','cache-write'],
	'Chrome': ['chrome-brass','chrome-ember','chrome-edge']
} satisfies Record<string, (keyof ReturnType<typeof paletteVars>)[]>;
