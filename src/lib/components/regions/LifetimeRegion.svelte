<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import StatCard from '$lib/components/ds/StatCard.svelte';
	import Sparkline from '$lib/components/ds/Sparkline.svelte';
	import { money } from '$lib/format';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);

	// All-time cumulative spend + projected 12-month burn. Whole-account, ALWAYS: same
	// does-NOT-follow-the-period-selector posture as `pace` (design D5).
	let lifetime = $derived(snap ? dash.lifetimeSpend(snap) : null);
	let lifetimeSpark = $derived(lifetime ? lifetime.dailySeries.map((d) => d.cost) : []);
</script>

<!-- REGION 5b · LIFETIME SPEND (all-time cumulative + projected yearly burn) -->
{#if lifetime}
	<section class="value-grid" aria-label="Lifetime spend">
		<StatCard
			label="all-time spend"
			value={lifetime.totalCost}
			money
			moneyTone="gold"
			accent="var(--accent)"
			sub={lifetime.projectedYearlyCost != null
				? `on pace for ${money(lifetime.projectedYearlyCost)}/yr · ${lifetime.runRateSampleDays}d sample`
				: 'not enough history yet to project a year'}
		/>
		{#if lifetimeSpark.length > 1}
			<div class="panel lifetime-spark-panel">
				<span class="lifetime-spark-label">last 90 days</span>
				<Sparkline values={lifetimeSpark} width={320} height={72} color="var(--accent)" area dot ariaLabel="Daily spend over the last 90 days" />
			</div>
		{/if}
	</section>
{/if}

<style>
	/* REGION 5b shares the REGION 5 value-grid layout. */
	.value-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 860px) {
		.value-grid {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
	}
	.lifetime-spark-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		justify-content: center;
	}
	.lifetime-spark-label {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: var(--fw-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-dim);
	}
</style>
