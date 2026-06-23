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
	}
</script>

<script lang="ts">
	// chaching MoneyFigure — a dollar amount set the chaching way: heavy tabular
	// mono, tight tracking. `size` scales inline → giant register total; `tone`
	// colors it; `sign` forces an explicit +/−. Negatives render U+2212.
	let {
		amount = 0,
		size = 'lg',
		tone = 'default',
		sign = false,
		currency = '$',
		decimals
	}: MoneyFigureProps = $props();

	const abs = $derived(Math.abs(amount));
	const dp = $derived(decimals != null ? decimals : abs >= 1000 ? 0 : 2);
	const body = $derived(
		abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
	);
	// U+2212 (minus sign) for negatives, never the hyphen.
	const prefix = $derived(sign ? (amount < 0 ? '−' : '+') : amount < 0 ? '−' : '');
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
