<script lang="ts" module>
	export type MoneyFigureSize = 'sm' | 'md' | 'lg' | 'hero';
	export type MoneyFigureTone = 'default' | 'gold' | 'save' | 'burn';

	export interface MoneyFigureProps {
		amount: number;
		/** inline → giant register total. */
		size?: MoneyFigureSize;
		tone?: MoneyFigureTone;
		/** Force an explicit +/− prefix (savings read as negative coupons). */
		sign?: boolean;
		currency?: string;
		/** Override decimal places (default: 0 for abs >= 1000, else 2). */
		decimals?: number;
		/** Count up from 0 → amount on first paint (motion-gated). Off by default. */
		animate?: boolean;
	}
</script>

<script lang="ts">
	// chaching MoneyFigure — a dollar amount set the chaching way: heavy tabular
	// mono, tight tracking. `size` scales inline → giant register total; `tone`
	// colors it; `sign` forces an explicit +/−. Negatives render U+2212.
	import { countUp } from '$lib/client/motion';

	let {
		amount = 0,
		size = 'lg',
		tone = 'default',
		sign = false,
		currency = '$',
		decimals,
		animate = false
	}: MoneyFigureProps = $props();

	// Count-up on first paint when `animate` is set (stat-card figures). The util
	// no-ops to the final value under prefers-reduced-motion (zero intermediate
	// frames). After first paint, `shown` tracks `amount` directly so live updates
	// land in place. `started` is a non-reactive closure flag (no self-invalidation).
	// Initialise to 0 (animated path starts there); the effect sets the non-animated
	// value immediately on first run, so a static figure never shows a stale 0.
	let shown = $state(0);
	let started = false;
	$effect(() => {
		const target = amount;
		if (!animate) {
			shown = target;
			return;
		}
		if (!started) {
			if (target === 0) {
				shown = 0;
				return;
			}
			started = true;
			return countUp(0, target, (v) => (shown = v), { durMs: 600 });
		}
		shown = target;
	});

	const displayed = $derived(animate ? shown : amount);
	const abs = $derived(Math.abs(displayed));
	const dp = $derived(decimals != null ? decimals : abs >= 1000 ? 0 : 2);
	const body = $derived(
		abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
	);
	// U+2212 (minus sign) for negatives, never the hyphen. Tracks the displayed
	// (possibly mid-count-up) value so the sign never flickers against the final.
	const prefix = $derived(sign ? (displayed < 0 ? '−' : '+') : displayed < 0 ? '−' : '');
</script>

<span class="money {size} {tone}" data-testid="money-figure">
	{prefix}<span class="currency">{currency}</span>{body}
</span>

<style>
	.money {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
		line-height: var(--lh-tight);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		color: var(--text);
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
</style>
