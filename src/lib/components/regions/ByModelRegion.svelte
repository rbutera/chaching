<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { SyncStatusView } from '$lib/client/sync';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import SpendMeter from '$lib/components/ds/SpendMeter.svelte';
	import Divider from '$lib/components/ds/Divider.svelte';
	import { money, compactTokens, fmtPeriodKey } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';
	import type { PeriodBucket } from '$lib/core/aggregate';

	let {
		feed,
		dash,
		syncStatus
	}: { feed: FeedStore; dash: Dashboard; syncStatus: SyncStatusView | null } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// UTC today (YYYY-MM-DD): the live tail; passed to the trend chart to mark today's bar.
	let todayUTC = $derived(new Date(snap?.generatedAt ?? Date.now()).toISOString().slice(0, 10));

	// trend buckets (always full rolling window — the navigation surface)
	let trend = $derived<PeriodBucket[]>(snap ? dash.trend(snap) : []);
	// scoped models — pinned-day-scoped when focused, else period-scoped.
	let modelTotals = $derived(
		snap ? (focusedDay ? dash.focusedModels(snap, focusedDay) : dash.models(snap)) : []
	);
	// stacking order = models by cost (scoped)
	let stackModels = $derived(modelTotals.map((m) => m.model));

	let poolFilterActive = $derived(dash.machineFilter.size > 0 || dash.subscriptionFilter.size > 0);
	// Five-hour blocks currently carry no attribution dimension. Suppress this one
	// panel under a pool filter instead of showing a whole-pool number in a scoped view.
	let activeBlock = $derived(poolFilterActive ? null : (snap?.blocks.find((b) => b.isActive) ?? null));

	const isDayBucket = (b: PeriodBucket) => /^\d{4}-\d{2}-\d{2}$/.test(b.key);

	function onTrendPick(b: PeriodBucket) {
		if (!snap) return;
		// A single-DAY bar pins the focused day (the new primary path, single source of truth).
		// A coarse week/month bar (long-span trend) keeps the existing bucket-range drill —
		// focusedDay is single-day only, so a week bar opens the DetailSheet, not a pin.
		if (isDayBucket(b)) {
			dash.setFocusedDay(snap, b.key);
			return;
		}
		const range = dash.bucketDayRange(snap, b);
		dash.openPeriodDrill({ from: range.from, to: range.to, periodKey: b.key, label: fmtPeriodKey(b.key) });
	}
</script>

<!-- REGION 7 · BY-MODEL / 5H WINDOW GRID -->
{#if snap}
	<section class="grid2">
		<div class="panel by-model">
			{#if trend.length > 0}
				<TrendChart buckets={trend} models={stackModels} onPick={onTrendPick} today={todayUTC} />
			{:else}
				<p class="empty">No data in this scope.</p>
			{/if}
			<div class="model-break">
				<h2 class="panel-title"><span>by model</span></h2>
				<Donut models={modelTotals} activeFilter={dash.modelFilter} onToggle={(m) => dash.toggleModel(m)} />
			</div>
		</div>

		<div class="panel cap-panel">
			<h2 class="panel-title"><span>5-hour window · cap proximity</span></h2>
			{#if activeBlock}
				<SpendMeter amount={activeBlock.cost} context="block" label={`closes ${new Date(activeBlock.endTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`} />
				<p class="cap-sub">{compactTokens(totalTokens(activeBlock.tokens))} tokens this window</p>
			{:else if poolFilterActive}
				<p class="empty">5-hour windows are whole-pool only. Clear pool filters to view them.</p>
			{:else}
				<p class="empty">No active window right now.</p>
			{/if}
			{#if syncStatus?.enabled}
				<p class="cap-note">
					Pooled windows fold in peers at hour grain, so a shared block is approximate
					to the hour; this machine's own contribution stays per-request exact.
				</p>
			{/if}
			{#if snap.blocks.length > 0}
				<div class="cap-recent">
					<Divider variant="solid" />
					<ul class="recent-blocks">
						{#each snap.blocks.slice(0, 5) as b (b.startTs)}
							<li>
								<span class="num">{money(b.cost)}</span>
								<span class="blk-sub">{new Date(b.startTs).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	/* REGION 7 · MODEL / 5H GRID — base single column, 2fr 1fr at >= 860px. */
	.grid2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 860px) {
		.grid2 {
			grid-template-columns: 2fr 1fr;
			align-items: start;
		}
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
	.model-break {
		margin-top: 1.1rem;
	}
	.empty {
		color: var(--text-dim);
		text-align: center;
		padding: 2rem 1rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.cap-sub {
		margin: 0.6rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.cap-note {
		margin: 0.6rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--text-dim);
	}
	.cap-recent {
		margin-top: 1rem;
	}
	.recent-blocks {
		list-style: none;
		margin: 0;
		padding: 0.7rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.recent-blocks li {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.blk-sub {
		color: var(--text-dim);
		font-size: 0.72rem;
	}
</style>
