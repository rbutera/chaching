// chaching brand tokens — the single typed source of truth for the app's
// semantic colors. Both surfaces are generated from this module so they cannot
// drift: the web `:root` block (via toCss) and the CLI/TUI color map (via
// toAnsiMap). See openspec/changes/chaching-ds-tokens for the decisions.
//
// "Register & Receipt": a warm-ink dark register surface where brass gold reads
// as money, plus a thermal-paper cream world for receipts/print. Categorical
// model/provider hues stay distinct (data encoding, never recolored to gold).
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
		info: BrandToken;
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
		pi: BrandToken;
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
	/**
	 * Raw scale ramps. Emitted as `:root` vars so the hand-authored `.paper`
	 * scope and ladders can alias them by name. Not semantic on their own.
	 */
	ramps: {
		ink950: BrandToken;
		ink900: BrandToken;
		ink850: BrandToken;
		ink800: BrandToken;
		ink750: BrandToken;
		ink700: BrandToken;
		ink600: BrandToken;
		paper50: BrandToken;
		paper200: BrandToken;
		paper400: BrandToken;
		paper600: BrandToken;
		gold300: BrandToken;
		gold400: BrandToken;
		gold500: BrandToken;
		gold600: BrandToken;
		gold700: BrandToken;
		cream50: BrandToken;
		cream100: BrandToken;
		cream200: BrandToken;
		cream300: BrandToken;
		creamInk: BrandToken;
	};
	/** Raw categorical + status hues the semantics alias. */
	hues: {
		green500: BrandToken;
		orange500: BrandToken;
		red500: BrandToken;
		amber500: BrandToken;
		purple: BrandToken;
		sky: BrandToken;
		lemon: BrandToken;
		mint: BrandToken;
		slate: BrandToken;
	};
}

export const tokens = {
	// surfaces — warm-ink ramp; matches src/app.css + tokens/colors.css ref.
	surfaces: {
		bg: { hex: '#0e0d0b', ansi: 'black' }, // ink-950
		surface1: { hex: '#131210', ansi: 'black' }, // ink-900
		surface2: { hex: '#1a1814', ansi: 'gray' }, // ink-850
		surface3: { hex: '#221f1a', ansi: 'gray' }, // ink-800
		border: { hex: '#36312a', ansi: 'gray' }, // ink-700
		borderStrong: { hex: '#4a443b', ansi: 'gray' } // ink-600
	},
	// foreground ramp — warm paper-white.
	fg: {
		fg: { hex: '#f4efe4', ansi: 'whiteBright' }, // paper-50
		muted: { hex: '#9a9080', ansi: 'white' }, // paper-400
		dim: { hex: '#6f675a', ansi: 'gray' } // paper-600
	},
	// brand accent — brass / register gold #eba92c (gold-500). Supersedes the
	// v1.6.0 #e0a52f. 16-color fallback is yellow (design D10).
	accent: { hex: '#eba92c', ansi: 'yellow' },
	// status.
	status: {
		good: { hex: '#54cc85', ansi: 'green' }, // green-500
		bad: { hex: '#f4736b', ansi: 'red' }, // red-500
		warn: { hex: '#f6be3f', ansi: 'yellow' }, // amber-500
		info: { hex: '#4cb8f0', ansi: 'cyan' } // sky
	},
	// model families — categorical data encoding, kept distinct (NOT recolored
	// to brand gold). opus purple / sonnet sky / haiku lemon / other slate.
	models: {
		opus: { hex: '#b98cfb', ansi: 'magenta' }, // purple
		sonnet: { hex: '#4cb8f0', ansi: 'cyan' }, // sky
		haiku: { hex: '#f4ce3a', ansi: 'yellow' }, // lemon
		other: { hex: '#97a0b0', ansi: 'gray' } // slate
	},
	// providers — anchored to the categorical hues the web app mirrors.
	providers: {
		claude: { hex: '#b98cfb', ansi: 'magenta' }, // purple
		codex: { hex: '#4cb8f0', ansi: 'cyan' }, // sky
		opencode: { hex: '#54cc85', ansi: 'green' }, // mint/green-500
		cursor: { hex: '#f6be3f', ansi: 'yellow' }, // amber-500
		pi: { hex: '#f4787b', ansi: 'red' } // coral/red-400
	},
	// spend escalation ladder for the flourishes.
	spend: {
		calm: { hex: '#54cc85', ansi: 'green' }, // green-500
		warm: { hex: '#eba92c', ansi: 'yellow' }, // gold-500
		hot: { hex: '#f7913c', ansi: 'yellow' }, // orange-500
		alarm: { hex: '#f4736b', ansi: 'red' } // red-500
	},
	// cache-state encoding.
	cache: {
		hit: { hex: '#54cc85', ansi: 'green' }, // green-500
		miss: { hex: '#6f675a', ansi: 'gray' }, // paper-600
		write: { hex: '#4cb8f0', ansi: 'cyan' } // sky
	},
	// keyboard-focus ring; tracks the bright gold (#f7bc42 = gold-400).
	focus: { hex: '#f7bc42', ansi: 'yellow' },
	// raw ramps — emitted as :root vars for the .paper scope + ladders to alias.
	ramps: {
		ink950: { hex: '#0e0d0b', ansi: 'black' },
		ink900: { hex: '#131210', ansi: 'black' },
		ink850: { hex: '#1a1814', ansi: 'gray' },
		ink800: { hex: '#221f1a', ansi: 'gray' },
		ink750: { hex: '#2b2722', ansi: 'gray' },
		ink700: { hex: '#36312a', ansi: 'gray' },
		ink600: { hex: '#4a443b', ansi: 'gray' },
		paper50: { hex: '#f4efe4', ansi: 'whiteBright' },
		paper200: { hex: '#ccc4b4', ansi: 'white' },
		paper400: { hex: '#9a9080', ansi: 'white' },
		paper600: { hex: '#6f675a', ansi: 'gray' },
		gold300: { hex: '#f9c75a', ansi: 'yellow' },
		gold400: { hex: '#f7bc42', ansi: 'yellow' },
		gold500: { hex: '#eba92c', ansi: 'yellow' },
		gold600: { hex: '#cc8f1f', ansi: 'yellow' },
		gold700: { hex: '#9e6e14', ansi: 'yellow' },
		cream50: { hex: '#f7f2e8', ansi: 'whiteBright' },
		cream100: { hex: '#f0e9da', ansi: 'whiteBright' },
		cream200: { hex: '#e4dac6', ansi: 'white' },
		cream300: { hex: '#d3c6ac', ansi: 'white' },
		creamInk: { hex: '#1c1913', ansi: 'black' }
	},
	// raw categorical + status hues.
	hues: {
		green500: { hex: '#54cc85', ansi: 'green' },
		orange500: { hex: '#f7913c', ansi: 'yellow' },
		red500: { hex: '#f4736b', ansi: 'red' },
		amber500: { hex: '#f6be3f', ansi: 'yellow' },
		purple: { hex: '#b98cfb', ansi: 'magenta' },
		sky: { hex: '#4cb8f0', ansi: 'cyan' },
		lemon: { hex: '#f4ce3a', ansi: 'yellow' },
		mint: { hex: '#54cc85', ansi: 'green' },
		slate: { hex: '#97a0b0', ansi: 'gray' }
	}
} satisfies BrandTokens;

export type Tokens = typeof tokens;
