<script lang="ts">
	// Horizontal 100% stacked bar of the four token classes. Encodes cache-vs-fresh
	// by opacity within a single accent hue + a hatch pattern on cache-read, which
	// doubles as a non-color a11y channel. Pure CSS/SVG, zero CPU at rest.
	import type { TokenCounts } from '$lib/types';
	import { compactTokens } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';

	let { tokens, color = 'var(--accent)' }: { tokens: TokenCounts; color?: string } = $props();

	let total = $derived(totalTokens(tokens));
	let segs = $derived([
		{ key: 'input', label: 'Input (fresh)', val: tokens.input, opacity: 1, hatch: false },
		{ key: 'output', label: 'Output', val: tokens.output, opacity: 0.78, hatch: false },
		{ key: 'cacheCreation', label: 'Cache write', val: tokens.cacheCreation, opacity: 0.5, hatch: false },
		{ key: 'cacheRead', label: 'Cache read', val: tokens.cacheRead, opacity: 0.32, hatch: true }
	]);
</script>

<div class="split">
	<div class="bar" role="img" aria-label="Token composition by class">
		{#each segs as s (s.key)}
			{#if s.val > 0}
				<span
					class="seg"
					class:hatch={s.hatch}
					style={`flex:${s.val};background:${color};opacity:${s.opacity}`}
					title={`${s.label}: ${compactTokens(s.val)}`}
				></span>
			{/if}
		{/each}
	</div>
	<ul class="key">
		{#each segs as s (s.key)}
			<li>
				<span class="kbox" class:hatch={s.hatch} style={`background:${color};opacity:${s.opacity}`}></span>
				<span class="klabel">{s.label}</span>
				<span class="kval num">{compactTokens(s.val)}</span>
				<span class="kpct num">{total > 0 ? Math.round((s.val / total) * 100) : 0}%</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.split {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.bar {
		display: flex;
		height: 14px;
		border-radius: 7px;
		overflow: hidden;
		background: var(--surface-3);
	}
	.seg {
		display: block;
		min-width: 2px;
	}
	.seg.hatch,
	.kbox.hatch {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(255, 255, 255, 0.25) 0,
			rgba(255, 255, 255, 0.25) 2px,
			transparent 2px,
			transparent 5px
		);
	}
	.key {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem 1rem;
	}
	.key li {
		display: grid;
		grid-template-columns: 12px 1fr auto auto;
		gap: 0.45rem;
		align-items: center;
		font-size: 0.78rem;
	}
	.kbox {
		width: 11px;
		height: 11px;
		border-radius: 3px;
	}
	.klabel {
		color: var(--fg-muted);
	}
	.kval {
		color: var(--fg);
	}
	.kpct {
		color: var(--fg-dim);
		width: 2.6em;
		text-align: right;
	}
</style>
