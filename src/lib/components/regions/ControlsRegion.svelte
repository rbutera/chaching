<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { SyncStatusView } from '$lib/client/sync';
	import PeriodSwitcher from '$lib/components/PeriodSwitcher.svelte';
	import DayNavigator from '$lib/components/DayNavigator.svelte';
	import PoolFilters from '$lib/components/PoolFilters.svelte';
	import Badge from '$lib/components/ds/Badge.svelte';
	import { money, providerLabel, fmtDay } from '$lib/format';

	// Regions receive `{ feed, dash }`; `syncStatus` is page-level state (also owned by
	// the page's SyncPanel) threaded down explicitly — a prop, not context.
	let {
		feed,
		dash,
		syncStatus
	}: { feed: FeedStore; dash: Dashboard; syncStatus: SyncStatusView | null } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);
	let providerTotals = $derived(snap ? dash.providers(snap) : []);
</script>

<!-- REGION 3 · STICKY CONTROLS -->
{#if snap}
	<div class="controls">
		<div class="period-wrap" class:overridden={focusedDay != null}>
			<PeriodSwitcher value={dash.period} onChange={(p) => dash.setPeriod(p)} />
			{#if focusedDay != null}<span class="override-note">overridden by focused day</span>{/if}
		</div>
		{#if focusedDay != null}
			<span class="pinned-badge">
				<Badge tone="accent" solid>pinned · {fmtDay(focusedDay)}</Badge>
				<button class="pin-clear" aria-label="Clear pinned day" onclick={() => dash.clearFocusedDay()}>✕</button>
			</span>
		{/if}
		<DayNavigator
			{focusedDay}
			earliest={snap.earliestDay}
			latest={snap.latestDay}
			onStep={(d) => dash.stepFocusedDay(snap, d)}
			onJump={(day) => dash.setFocusedDay(snap, day)}
			onClear={() => dash.clearFocusedDay()}
			onEnter={() => snap.latestDay && dash.setFocusedDay(snap, snap.latestDay)}
		/>
		{#if providerTotals.length > 1}
			<div class="pills" aria-label="Provider filter">
				{#each providerTotals as p (p.provider)}
					<button
						class="provider-pill"
						class:active={dash.providerFilter.has(p.provider)}
						aria-pressed={dash.providerFilter.has(p.provider)}
						style={`--provider:var(--p-${p.provider}, var(--m-other))`}
						onclick={() => dash.toggleProvider(p.provider)}
					>
						<span>{providerLabel(p.provider)}</span>
						<span class="num">{money(p.cost)}</span>
					</button>
				{/each}
			</div>
		{/if}
		{#if dash.providerFilter.size > 0}
			<button class="clear-filter" onclick={() => dash.clearProviderFilter()}>Clear provider filter ✕</button>
		{/if}
		{#if dash.modelFilter.size > 0}
			<button class="clear-filter" onclick={() => dash.clearModelFilter()}>Clear model filter ✕</button>
		{/if}
		{#if syncStatus?.enabled}
			<PoolFilters
				machines={syncStatus.machines}
				subscriptions={syncStatus.subscriptions}
				machineFilter={dash.machineFilter}
				subscriptionFilter={dash.subscriptionFilter}
				onMachineToggle={(id) => dash.toggleMachine(id)}
				onSubscriptionToggle={(id) => dash.toggleSubscription(id)}
				onClear={() => dash.clearPoolFilters()}
			/>
		{/if}
	</div>
{/if}

<style>
	/* REGION 3 · STICKY CONTROLS — sticky under the topbar at top: 58px. */
	.controls {
		position: sticky;
		top: 58px;
		z-index: 8;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0 0.9rem;
		background: linear-gradient(var(--bg) 75%, transparent);
		flex-wrap: wrap;
	}
	.period-wrap {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.period-wrap.overridden {
		opacity: 0.7;
	}
	.override-note {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.pinned-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.pin-clear {
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: 0.8rem;
		line-height: 1;
		min-height: 32px;
		padding: 0 0.3rem;
		cursor: pointer;
	}
	.pin-clear:hover {
		color: var(--text);
	}
	.pills {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.provider-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 34px;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--provider) 45%, var(--border));
		background: color-mix(in srgb, var(--provider) 10%, var(--surface-2));
		color: var(--text-muted);
		padding: 0.35rem 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		transition: background var(--dur-fast) var(--ease-out);
	}
	.provider-pill.active {
		background: color-mix(in srgb, var(--provider) 22%, var(--surface-2));
		color: var(--text);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--provider) 70%, transparent);
	}
	.clear-filter {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-muted);
		min-height: 34px;
		cursor: pointer;
	}
	.clear-filter:hover {
		color: var(--text);
	}
</style>
