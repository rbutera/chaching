<script lang="ts">
	// CachePanel — makes it unmistakable that cache is BILLED, not free. Shows the
	// billed cache-read + cache-write cost as line items alongside the existing
	// saved-vs-uncached figure, for the CURRENT scope (follows the period selector).
	// Branded with the cache-state tokens (read = hit/green, write = write/cyan) and
	// the brass accent, via CSS custom properties driven from the brand token set.
	import { tokens } from '$lib/brand/tokens';
	import { money, compactTokens } from '$lib/format';
	import type { CacheCostBreakdown } from '$lib/core/pricing/cache-breakdown';

	let { breakdown }: { breakdown: CacheCostBreakdown } = $props();

	const READ = tokens.cache.hit.hex; // billed reads
	const WRITE = tokens.cache.write.hex; // billed writes

	let hasReads = $derived(breakdown.cacheReadTokens > 0);
	let billedTotal = $derived(breakdown.cacheReadCost + breakdown.cacheWriteCost);
</script>

<div class="cache-panel" style={`--read:${READ};--write:${WRITE}`}>
	<div class="head">
		<h2 class="title">Cache — billed, not free</h2>
		<span class="billed-total num" title="Total billed cache cost in this scope">{money(billedTotal)}</span>
	</div>
	<p class="blurb">
		Cache reads are charged at the cache-read rate and writes at the cache-write rate. Cheaper than
		fresh input, never free.
	</p>

	<ul class="rows">
		<li class="row">
			<span class="dot read" aria-hidden="true"></span>
			<span class="label">Cache reads <span class="muted">billed</span></span>
			<span class="tok num">{compactTokens(breakdown.cacheReadTokens)}</span>
			<span class="cost num">{money(breakdown.cacheReadCost)}</span>
		</li>
		<li class="row">
			<span class="dot write" aria-hidden="true"></span>
			<span class="label">Cache writes <span class="muted">billed</span></span>
			<span class="tok num">{compactTokens(breakdown.cacheWriteTokens)}</span>
			<span class="cost num">{money(breakdown.cacheWriteCost)}</span>
		</li>
	</ul>

	<div class="saved">
		{#if hasReads}
			<span class="saved-label">Saved vs uncached</span>
			<span class="saved-val num">{money(breakdown.savedVsUncached)}</span>
		{:else}
			<span class="saved-label muted">No cache reads in this period</span>
			<span class="saved-val num muted">{money(0)}</span>
		{/if}
	</div>
</div>

<style>
	.cache-panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		box-shadow: var(--shadow);
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.title {
		font-size: 0.82rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin: 0;
	}
	.billed-total {
		font-size: 1.25rem;
		font-weight: 650;
		color: var(--fg);
	}
	.blurb {
		font-size: 0.74rem;
		color: var(--fg-muted);
		margin: 0;
		line-height: 1.4;
	}
	.rows {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.85rem;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: 0 0 auto;
	}
	.dot.read {
		background: var(--read);
	}
	.dot.write {
		background: var(--write);
	}
	.label {
		color: var(--fg);
	}
	.muted {
		color: var(--fg-dim);
		font-size: 0.72rem;
	}
	.tok {
		color: var(--fg-muted);
		font-variant-numeric: tabular-nums;
		font-family: var(--font-num);
	}
	.cost {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		font-family: var(--font-num);
		text-align: right;
		min-width: 4.5ch;
	}
	.saved {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		border-top: 1px dashed var(--border);
		padding-top: 0.5rem;
		margin-top: 0.2rem;
	}
	.saved-label {
		font-size: 0.74rem;
		color: var(--good);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.saved-val {
		font-size: 1rem;
		font-weight: 600;
		color: var(--good);
	}
	.saved-val.muted,
	.saved-label.muted {
		color: var(--fg-dim);
	}
</style>
