<script lang="ts">
	import { accountFeesByProvider, accountWindowValues } from '$lib/core/accounts';
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { PublicchachingConfig } from '$lib/core/config';
	import type { SyncStatusView } from '$lib/client/sync';
	import CachePanel from '$lib/components/CachePanel.svelte';
	import SubsidisationCard from '$lib/components/SubsidisationCard.svelte';
	import PoolSubsidisationCard from '$lib/components/PoolSubsidisationCard.svelte';
	import { fmtDay } from '$lib/format';

	// `{ feed, dash }` are the core props; `config`, `syncStatus`, and `onTierChange`
	// are page-level concerns (config is page state a tier write mutates) threaded down
	// explicitly — props, not context.
	let {
		feed,
		dash,
		config,
		syncStatus
	}: {
		feed: FeedStore;
		dash: Dashboard;
		config: PublicchachingConfig | null;
		syncStatus: SyncStatusView | null;
	} = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// Window label mirrors the hero: a pinned day, else the rolling-period label.
	let hero = $derived(snap ? dash.heroTotals(snap) : null);
	let heroLabel = $derived(focusedDay ? fmtDay(focusedDay) : (hero?.label ?? '—'));

	// Cache-cost breakdown for the current scope (follows the period selector). Drives
	// the CachePanel.
	let cacheBreakdown = $derived(snap ? dash.cacheBreakdown(snap).combined : null);

	// Subsidisation roll-up — follows the period selector / pinned day; the fee is
	// pro-rated to the window from a monthlyUsd/30 daily rate.
	let subsidyConfig = $derived(config ? accountFeesByProvider(config) : null);
	let subsidy = $derived(snap && subsidyConfig ? dash.subsidisation(snap, subsidyConfig) : null);

	let poolValues = $derived.by(() => {
		if (!snap || !syncStatus || (!syncStatus.enabled && !syncStatus.accounts?.length)) return null;
		const window = dash.periodWindow(snap);
		return accountWindowValues({
			localAccounts: config?.accounts,
			grain: snap.dayModel, accounts: syncStatus.accounts, mappings: syncStatus.mappings,
			from: focusedDay ?? window.from, to: focusedDay ?? window.to,
			providers: dash.providerFilter, machines: dash.machineFilter,
			models: dash.modelFilter
		});
	});

	// Burn-pace projection ("on pace for ~$X this month") — same month-basis, does-NOT-follow-
	// the-period-selector semantics as the subsidy above (design D5). null when the cost-honesty
	// guards trip (coverage gap in the elapsed month, or too few elapsed days).
	let pace = $derived(snap ? dash.burnPace(snap) : null);
</script>

<!-- REGION 5 · VALUE-CARD BAND (cache cost + subscription subsidy, design.md D1a) -->
<section class="value-grid" aria-label="Cache cost and subscription subsidy">
	{#if cacheBreakdown}
		<CachePanel breakdown={cacheBreakdown} />
	{/if}
	{#if syncStatus?.enabled || poolValues}
		{#if poolValues && poolValues.rows.length > 0}
			<PoolSubsidisationCard
				rows={poolValues.rows}
				totalValue={poolValues.valueUsd}
				windowLabel={heroLabel}
				wholePlanFee={dash.machineFilter.size > 0}
			/>
		{:else}
			<p role="status">{syncStatus?.unreachable ? 'Pool unavailable.' : 'No Accounts in this scope.'}</p>
		{/if}
	{:else if subsidy && subsidyConfig}
		<SubsidisationCard rollup={subsidy} windowLabel={heroLabel} burnPace={pace} />
	{/if}
</section>

<style>
	/* REGION 5 · VALUE BAND — base single column, 1fr 1fr at >= 860px. */
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
</style>
