<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import { money, compactTokens, int } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);

	// Per-project spend (scoped): which repo/client is eating the money. Follows the same
	// period + filter + focusedDay scoping as the session list (design D4 shared lineage).
	let projectTotals = $derived(snap ? dash.projectTotals(snap) : []);
	const PROJECT_TOP_N = 8;
	let projectTop = $derived(projectTotals.slice(0, PROJECT_TOP_N));
	let projectMore = $derived(Math.max(0, projectTotals.length - PROJECT_TOP_N));
</script>

<!-- REGION 7b · BY PROJECT (which repo/client is eating the money) -->
<section class="by-project-sec" aria-label="Spend by project">
	<div class="panel">
		<h2 class="panel-title"><span>by project</span></h2>
		<!-- Session-derived (design D3 overlap rule): whole sessions that touch the
		     window count in full, so this panel reconciles to the session total, not
		     the day-grain cards above. The caption keeps that honest. -->
		<p class="proj-caption">whole sessions overlapping this window</p>
		{#if projectTotals.length > 0}
			<ul class="project-list">
				{#each projectTop as p (p.isUnknown ? 'unknown' : `project:${p.project}`)}
					<li class:unknown={p.isUnknown} title={p.isUnknown ? 'Sessions with no recorded project' : p.project}>
						<span class="proj-name">{p.display}</span>
						<span class="proj-figs">
							<span class="num">{money(p.cost)}</span>
							<span class="proj-sub">{compactTokens(totalTokens(p.tokens))} tok</span>
							<span class="proj-sub">{int(p.sessionCount)} {p.sessionCount === 1 ? 'session' : 'sessions'}</span>
						</span>
					</li>
				{/each}
			</ul>
			{#if projectMore > 0}
				<p class="proj-more">+{projectMore} more</p>
			{/if}
		{:else}
			<p class="empty">No sessions in this scope.</p>
		{/if}
	</div>
</section>

<style>
	/* REGION 7b · BY PROJECT — receipt-line rows, mono, right-aligned figures. */
	.by-project-sec {
		margin-bottom: 1rem;
	}
	/* Shared panel surface. */
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
	}
	.panel-title {
		margin: 0 0 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
		display: flex;
		justify-content: space-between;
	}
	.empty {
		color: var(--text-dim);
		text-align: center;
		padding: 2rem 1rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.project-list li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}
	.project-list li.unknown .proj-name {
		color: var(--text-dim);
		font-style: italic;
	}
	.proj-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		/* flex children default to min-width:auto, which defeats the ellipsis */
		min-width: 0;
	}
	.proj-caption {
		margin: -0.35rem 0 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
	}
	.proj-figs {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
		flex: none;
	}
	.proj-figs .num {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.proj-sub {
		color: var(--text-dim);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.proj-more {
		margin: 0.7rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-dim);
	}
</style>
