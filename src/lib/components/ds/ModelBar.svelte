<script lang="ts" module>
	import MoneyFigure from './MoneyFigure.svelte';

	export interface ModelBarProps {
		/** Model or provider name — auto-colors opus/sonnet/haiku, else "other". */
		label: string;
		amount: number | string;
		/** Fill fraction 0–1. */
		pct?: number;
		/** Override the auto model hue. */
		color?: string;
		/** Format amount as money (default true). */
		money?: boolean;
	}

	// Categorical model hues are data, never gold. Matched case-insensitively.
	const MODEL_HUES = [
		[/opus/i, 'var(--m-opus)'],
		[/sonnet/i, 'var(--m-sonnet)'],
		[/haiku/i, 'var(--m-haiku)']
	] satisfies [RegExp, string][];

	export function hueFor(model = ''): string {
		for (const [re, c] of MODEL_HUES) if (re.test(model)) return c;
		return 'var(--m-other)';
	}
</script>

<script lang="ts">
	// chaching ModelBar — one row of a by-model / by-provider breakdown: a dot in
	// the categorical hue, the label, a proportional track, and the amount.
	// `pct` (clamped 0–1) sizes the fill; `color` overrides the auto hue.
	let { label, amount, pct = 0, color, money = true }: ModelBarProps = $props();

	const c = $derived(color ?? hueFor(label));
	const width = $derived(`${Math.max(0, Math.min(1, pct)) * 100}%`);
</script>

<div class="modelbar" style:--bar-c={c}>
	<span class="lead">
		<span class="dot"></span>
		<span class="label">{label}</span>
	</span>
	<span class="amount">
		{#if money}
			<MoneyFigure amount={Number(amount) || 0} size="sm" />
		{:else}
			<span class="raw">{amount}</span>
		{/if}
	</span>
	<span class="track" aria-hidden="true">
		<span class="fill" style:width></span>
	</span>
</div>

<style>
	.modelbar {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 4px 12px;
		padding: 6px 0;
	}
	.lead {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--bar-c);
		flex: 0 0 auto;
	}
	.label {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.amount {
		justify-self: end;
	}
	.raw {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.track {
		grid-column: 1 / -1;
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--surface-3);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--bar-c);
		border-radius: inherit;
	}
</style>
