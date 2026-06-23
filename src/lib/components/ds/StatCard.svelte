<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import MoneyFigure, { type MoneyFigureTone } from './MoneyFigure.svelte';

	export interface StatCardProps {
		/** Uppercase-mono caption. */
		label: string;
		/** Main figure (string or number). */
		value: string | number;
		/** Muted sub-line below the value. */
		sub?: Snippet | string;
		/** Bottom accent-bar color — pass a model/provider hue or status token. */
		accent?: string;
		/** Render value as a MoneyFigure. */
		money?: boolean;
		moneyTone?: MoneyFigureTone;
		/** Count the money figure up from 0 on first paint (motion-gated). */
		animate?: boolean;
	}
</script>

<script lang="ts">
	// chaching StatCard — the dashboard summary tile. Uppercase-mono label, a big
	// tabular value (or MoneyFigure when `money`), a muted sub-line, and a thin
	// colored accent bar at the bottom (a model/provider hue or status token).
	let {
		label,
		value,
		sub,
		accent = 'var(--accent)',
		money = false,
		moneyTone = 'default',
		animate = false
	}: StatCardProps = $props();
</script>

<div class="statcard">
	<span class="label">{label}</span>

	{#if money}
		<MoneyFigure amount={Number(value) || 0} size="md" tone={moneyTone} {animate} />
	{:else}
		<span class="value">{value}</span>
	{/if}

	{#if sub}
		<span class="sub">
			{#if typeof sub === 'function'}{@render sub()}{:else}{sub}{/if}
		</span>
	{/if}

	<span class="accent-bar" aria-hidden="true" style:--statcard-accent={accent}></span>
</div>

<style>
	.statcard {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-4);
		padding-bottom: var(--space-5);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.label {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: var(--fw-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-dim);
	}
	.value {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-2xl);
		font-weight: var(--fw-bold);
		letter-spacing: var(--tracking-tight);
		color: var(--text);
		line-height: 1.05;
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.accent-bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		width: 100%;
		background: linear-gradient(
			90deg,
			var(--statcard-accent),
			color-mix(in srgb, var(--statcard-accent) 10%, transparent)
		);
	}
</style>
