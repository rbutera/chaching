<script lang="ts" module>
	import type { MoneyFigureSize, MoneyFigureTone } from './MoneyFigure.svelte';
	export type { MoneyFigureSize, MoneyFigureTone };
</script>

<script lang="ts">
	// chaching MoneyOdometer — a dollar amount set the chaching way (heavy tabular
	// mono, tight tracking, dimmed currency mark), but with the digit columns
	// rendered by `@number-flow/svelte` so a value CHANGE rolls like a till/odometer
	// instead of tweening a single glyph. Shares MoneyFigure's size/tone vocabulary
	// so the two are visually interchangeable; the odometer is used only for the
	// live headline figures (hero, rail) where the roll is the point.
	//
	// NumberFlow honours `prefers-reduced-motion` natively (respectMotionPreference
	// defaults true → it renders the final value with no roll when motion is
	// reduced) and feature-detects WAAPI, so it degrades to a static value where
	// `Element.animate` is absent (SSR / jsdom). We hand it the value the caller
	// already gates (e.g. the hero's trailing throttle); NumberFlow only animates
	// the transitions it is handed, so the delta cadence is unchanged.
	//
	// A11y + honesty: NumberFlow draws the number as CSS-transformed digit REELS —
	// there is no plain-text value in the DOM (it lives as `--current` offsets). So
	// the visual is marked aria-hidden and the value is mirrored ONCE as a
	// visually-hidden text node, which is what screen readers announce and what
	// keeps the figure legible to the accessibility tree (and assertable in tests)
	// rather than a column of 0–9 reels.
	import NumberFlow from '@number-flow/svelte';

	let {
		amount = 0,
		size = 'lg',
		tone = 'gold',
		currency = '$'
	}: {
		amount?: number;
		size?: MoneyFigureSize;
		tone?: MoneyFigureTone;
		currency?: string;
	} = $props();

	// Match MoneyFigure's decimal rule exactly: 0 dp for abs ≥ 1000, else 2 dp, so
	// the odometer and any static MoneyFigure beside it read identically.
	let dp = $derived(Math.abs(amount) >= 1000 ? 0 : 2);
	let format = $derived<Intl.NumberFormatOptions>({
		minimumFractionDigits: dp,
		maximumFractionDigits: dp
	});
	// The accessible / plain-text mirror (e.g. "$204.00") — the single source the
	// a11y tree and tests read. Kept in lock-step with NumberFlow's own format.
	let accessible = $derived(
		currency +
			Math.abs(amount).toLocaleString('en-US', {
				minimumFractionDigits: dp,
				maximumFractionDigits: dp
			})
	);
</script>

<span class="money {size} {tone}" data-testid="money-odometer">
	<span class="visually-hidden">{accessible}</span>
	<span class="odometer" aria-hidden="true">
		<span class="currency">{currency}</span><NumberFlow value={amount} {format} />
	</span>
</span>

<style>
	/* Mirrors MoneyFigure's typography so the odometer is a drop-in for the static
	   figure. The digit columns are NumberFlow's own spans; they inherit the font
	   size/family/weight from this container. */
	.money {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
		line-height: var(--lh-tight);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		color: var(--text);
	}
	.odometer {
		display: inline-flex;
		align-items: baseline;
	}
	.currency {
		opacity: 0.55;
		font-weight: var(--fw-medium);
	}

	.sm {
		font-size: var(--text-md);
		font-weight: var(--fw-bold);
	}
	.md {
		font-size: var(--text-xl);
		font-weight: var(--fw-bold);
	}
	.lg {
		font-size: var(--text-3xl);
		font-weight: var(--fw-black);
	}
	.hero {
		font-size: var(--text-register);
		font-weight: var(--fw-black);
	}

	.default {
		color: var(--text);
	}
	.gold {
		color: var(--accent);
	}
	.save {
		color: var(--good);
	}
	.burn {
		color: var(--bad);
	}

	/* NumberFlow renders its digits in an inline-block custom element; keep it on the
	   text baseline so the dimmed currency mark and the digits align like MoneyFigure. */
	.odometer :global(number-flow-svelte) {
		vertical-align: baseline;
	}

	/* Screen-reader-only (local copy — component styles are scoped, and the global
	   .visually-hidden util lives in app.css which unit-mounted components don't load). */
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
