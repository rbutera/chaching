// chaching brand tokens — the single typed source of truth for the app's
// semantic colors. Both surfaces are generated from this module so they cannot
// drift: the web `:root` block (via toCss) and the CLI/TUI color map (via
// toAnsiMap). See openspec/changes/chaching-brand-tokens for the decisions.
//
// Plain relative-import TS, no SvelteKit runtime, no `$lib` alias — so both the
// Vite (web) build and the tsup (CLI) build consume it cleanly.

/**
 * One of chalk/Ink's 16 basic color names. Each token carries a curated nearest
 * basic-color fallback for terminals without 256/truecolor support. The render
 * path normally passes the token hex straight to chalk/Ink (auto-downsampled);
 * this name is the explicit fallback for the basic tier.
 */
export type ChalkBasicName =
	| 'black'
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan'
	| 'white'
	| 'gray'
	| 'redBright'
	| 'greenBright'
	| 'yellowBright'
	| 'blueBright'
	| 'magentaBright'
	| 'cyanBright'
	| 'whiteBright';

/** One semantic brand color: its hex value plus a curated 16-color fallback. */
export interface BrandToken {
	hex: string;
	ansi: ChalkBasicName;
}

/** The full token set. Every entry is a {@link BrandToken}. */
export interface BrandTokens {
	surfaces: {
		bg: BrandToken;
		surface1: BrandToken;
		surface2: BrandToken;
		surface3: BrandToken;
		border: BrandToken;
		borderStrong: BrandToken;
	};
	fg: {
		fg: BrandToken;
		muted: BrandToken;
		dim: BrandToken;
	};
	accent: BrandToken;
	status: {
		good: BrandToken;
		bad: BrandToken;
		warn: BrandToken;
	};
	models: {
		opus: BrandToken;
		sonnet: BrandToken;
		haiku: BrandToken;
		other: BrandToken;
	};
	providers: {
		claude: BrandToken;
		codex: BrandToken;
		opencode: BrandToken;
		cursor: BrandToken;
	};
	/** The flourish escalation ladder: calm → warm → hot → alarm. */
	spend: {
		calm: BrandToken;
		warm: BrandToken;
		hot: BrandToken;
		alarm: BrandToken;
	};
	/** Cache-state encoding: hit / miss / write. */
	cache: {
		hit: BrandToken;
		miss: BrandToken;
		write: BrandToken;
	};
	focus: BrandToken;
}

export const tokens = {
	// surfaces — near-black base, layered up; matches src/app.css.
	surfaces: {
		bg: { hex: '#0a0b0f', ansi: 'black' },
		surface1: { hex: '#12141b', ansi: 'black' },
		surface2: { hex: '#181b24', ansi: 'gray' },
		surface3: { hex: '#20242f', ansi: 'gray' },
		border: { hex: '#272b37', ansi: 'gray' },
		borderStrong: { hex: '#3a4150', ansi: 'gray' }
	},
	// foreground ramp.
	fg: {
		fg: { hex: '#e7eaf0', ansi: 'whiteBright' },
		muted: { hex: '#9aa3b2', ansi: 'white' },
		dim: { hex: '#6a7280', ansi: 'gray' }
	},
	// brand accent — register-gold "Till Stack" family, nudged to brass #e0a52f
	// for haiku separation (design D4). 16-color fallback is yellow.
	accent: { hex: '#e0a52f', ansi: 'yellow' },
	// status.
	status: {
		good: { hex: '#4ade80', ansi: 'green' },
		bad: { hex: '#f87171', ansi: 'red' },
		warn: { hex: '#fbbf24', ansi: 'yellow' }
	},
	// model families — categorical data encoding, kept distinct (NOT recolored
	// to brand gold). opus purple / sonnet blue / haiku lemon / other slate.
	models: {
		opus: { hex: '#c084fc', ansi: 'magenta' },
		sonnet: { hex: '#38bdf8', ansi: 'cyan' },
		haiku: { hex: '#facc15', ansi: 'yellow' },
		other: { hex: '#94a3b8', ansi: 'gray' }
	},
	// providers — anchored to the model-family hues the web app already mirrors.
	providers: {
		claude: { hex: '#c084fc', ansi: 'magenta' },
		codex: { hex: '#38bdf8', ansi: 'cyan' },
		opencode: { hex: '#4ade80', ansi: 'green' },
		cursor: { hex: '#fbbf24', ansi: 'yellow' }
	},
	// spend escalation ladder for the flourishes.
	spend: {
		calm: { hex: '#4ade80', ansi: 'green' },
		warm: { hex: '#e0a52f', ansi: 'yellow' },
		hot: { hex: '#fb923c', ansi: 'yellowBright' },
		alarm: { hex: '#f87171', ansi: 'red' }
	},
	// cache-state encoding.
	cache: {
		hit: { hex: '#4ade80', ansi: 'green' },
		miss: { hex: '#6a7280', ansi: 'gray' },
		write: { hex: '#38bdf8', ansi: 'cyan' }
	},
	// keyboard-focus ring; tracks the accent.
	focus: { hex: '#e0a52f', ansi: 'yellow' }
} satisfies BrandTokens;

export type Tokens = typeof tokens;
