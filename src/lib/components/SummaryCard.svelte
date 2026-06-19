<script lang="ts">
	import Sparkline from './Sparkline.svelte';

	let {
		label,
		value,
		delta = null,
		spark = null,
		sparkColor = 'var(--accent)',
		accent = 'var(--accent)',
		sub = null
	}: {
		label: string;
		value: string;
		delta?: { text: string; dir: 'up' | 'down' | 'flat' } | null;
		spark?: number[] | null;
		sparkColor?: string;
		accent?: string;
		sub?: string | null;
	} = $props();
</script>

<div class="card" style={`--card-accent:${accent}`}>
	<div class="top">
		<span class="label">{label}</span>
		{#if delta}
			<span class="delta {delta.dir}">{delta.text}</span>
		{/if}
	</div>
	<div class="value num">{value}</div>
	<div class="foot">
		{#if sub}<span class="sub">{sub}</span>{/if}
		{#if spark && spark.length > 1}
			<div class="spark"><Sparkline values={spark} color={sparkColor} ariaLabel={`${label} trend`} /></div>
		{/if}
	</div>
</div>

<style>
	.card {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		position: relative;
		overflow: hidden;
		box-shadow: var(--shadow);
	}
	.card::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 2px;
		background: var(--card-accent);
		opacity: 0.7;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-dim);
	}
	.delta {
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
		font-family: var(--font-num);
	}
	.delta.up {
		color: var(--bad);
	}
	.delta.down {
		color: var(--good);
	}
	.delta.flat {
		color: var(--fg-dim);
	}
	.value {
		font-size: 1.5rem;
		font-weight: 650;
		line-height: 1.05;
	}
	.foot {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 18px;
	}
	.sub {
		font-size: 0.74rem;
		color: var(--fg-muted);
	}
	.spark {
		margin-left: auto;
		opacity: 0.9;
	}
</style>
