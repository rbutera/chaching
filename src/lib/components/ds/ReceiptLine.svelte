<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface ReceiptLineProps {
		/** Left-hand item label. */
		label: Snippet | string;
		/** Right-hand figure (number formats as money; string passes through). */
		amount: number | string;
		/** Dim trailing detail after the label (e.g. token count). */
		sub?: Snippet | string;
		/** Cache discount styling — green, negative (a coupon). */
		coupon?: boolean;
		/** The bold uppercase TOTAL BURN line. */
		emphasis?: boolean;
		/** Dotted leader between label and amount (default true). */
		leader?: boolean;
		currency?: string;
	}
</script>

<script lang="ts">
	// chaching ReceiptLine — one printed line item on the thermal receipt: label
	// on the left, amount on the right, dotted leader between. `coupon` styles it
	// as a cache discount (green, negative U+2212). `emphasis` is the bold
	// uppercase TOTAL line. Built for the `.paper` surface (cream + mono).
	let {
		label,
		amount,
		sub,
		coupon = false,
		emphasis = false,
		leader = true,
		currency = '$'
	}: ReceiptLineProps = $props();

	const isNeg = $derived(coupon || (typeof amount === 'number' && amount < 0));
	const amountStr = $derived.by(() => {
		if (typeof amount !== 'number') return amount;
		const abs = Math.abs(amount);
		const dp = abs >= 1000 ? 0 : 2;
		const body = abs.toLocaleString('en-US', {
			minimumFractionDigits: dp,
			maximumFractionDigits: dp
		});
		// U+2212 minus for negatives / coupons.
		return `${isNeg ? '−' : ''}${currency}${body}`;
	});
</script>

<div class="line" class:coupon class:emphasis>
	<span class="label">
		{#if typeof label === 'function'}{@render label()}{:else}{label}{/if}
		{#if sub}<span class="sub">
				{#if typeof sub === 'function'}{@render sub()}{:else}{sub}{/if}
			</span>{/if}
	</span>
	{#if leader}
		<span class="leader" aria-hidden="true"></span>
	{:else}
		<span class="spacer"></span>
	{/if}
	<span class="amount">{amountStr}</span>
</div>

<style>
	.line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: var(--fw-regular);
		color: var(--text);
		padding: 2px 0;
		letter-spacing: var(--tracking-snug);
	}
	.line.coupon {
		color: var(--cache-hit);
	}
	.line.emphasis {
		font-size: var(--text-md);
		font-weight: var(--fw-bold);
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
	}

	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		color: var(--text-dim);
		margin-left: 8px;
		font-size: var(--text-xs);
	}

	.leader {
		flex: 1;
		align-self: center;
		border-bottom: 1.5px dotted color-mix(in srgb, var(--text-dim) 60%, transparent);
		min-width: 12px;
	}
	.spacer {
		flex: 1;
	}

	.amount {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		font-weight: var(--fw-medium);
	}
	.line.emphasis .amount {
		font-weight: var(--fw-black);
	}
</style>
