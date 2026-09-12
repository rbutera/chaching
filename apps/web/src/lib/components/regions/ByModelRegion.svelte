<script lang="ts">
	import type { FeedStore } from '../../client/feed.svelte';
	import type { Dashboard } from '../../client/dashboard.svelte';
	import type { SyncStatusView } from '../../client/sync';
	import SpendChart from './SpendChart.svelte';
	import Donut from '../Donut.svelte';
	import BreakdownTable from '../BreakdownTable.svelte';
	import SpendMeter from '../ds/SpendMeter.svelte';
	import Divider from '../ds/Divider.svelte';
	import { money, compactTokens, modelColor, modelLabel } from '@chaching/shared/format';
	import { totalTokens } from '@chaching/shared/aggregate';

	let {
		feed,
		dash,
		syncStatus,
		reducedMotion = false,
		suppressArt = false
	}: { feed: FeedStore; dash: Dashboard; syncStatus: SyncStatusView | null; reducedMotion?: boolean; suppressArt?: boolean } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// scoped models — pinned-day-scoped when focused, else period-scoped.
	let modelTotals = $derived(
		snap ? (focusedDay ? dash.focusedModels(snap, focusedDay) : dash.models(snap)) : []
	);
	let modelRows = $derived(modelTotals.map(model => ({
		id: model.model, name: modelLabel(model.model), detail: model.model,
		cost: model.cost, tokens: totalTokens(model.tokens), count: model.requests, color: modelColor(model.model), costUnknownRequests: model.costUnknownRequests
	})));
	let poolFilterActive = $derived(dash.machineFilter.size > 0);
	// Five-hour blocks currently carry no attribution dimension. Suppress this one
	// panel under a pool filter instead of showing a whole-pool number in a scoped view.
	let activeBlock = $derived(poolFilterActive ? null : (snap?.blocks.find((b) => b.isActive) ?? null));
</script>

<!-- REGION 7 · BY-MODEL / 5H WINDOW GRID -->
{#if snap}
	<section class="grid2">
		<div class="panel by-model">
			<SpendChart {feed} {dash} {reducedMotion}/>
			<div class="model-break">
				<h2 class="panel-title"><span>Models</span></h2>
				<Donut showLegend={false} models={modelTotals} activeFilter={dash.modelFilter} onToggle={(m) => dash.toggleModel(m)} />
				<BreakdownTable rows={modelRows} label="Models" countLabel="Requests" selected={dash.modelFilter} onToggle={model => dash.toggleModel(model)} {reducedMotion}/>
			</div>
		</div>

		<div class="panel cap-panel">
			<h2 class="panel-title"><span>5h spend</span></h2>
			{#if activeBlock}
				<SpendMeter {suppressArt} {reducedMotion} amount={activeBlock.cost} context="block" label={`closes ${new Date(activeBlock.endTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`} />
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
		font-family: var(--font-sans);
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
		font-family: var(--font-sans);
		font-size: 0.85rem;
	}
	.cap-sub {
		margin: 0.6rem 0 0;
		font-family: var(--font-sans);
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.cap-note {
		margin: 0.6rem 0 0;
		font-family: var(--font-sans);
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
		font-family: var(--font-sans);
		font-size: 0.8rem;
	}
	.blk-sub {
		color: var(--text-dim);
		font-size: 0.72rem;
	}
</style>
