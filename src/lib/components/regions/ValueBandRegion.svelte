<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { PublicchachingConfig } from '$lib/core/config';
	import type { SyncStatusView } from '$lib/client/sync';
	import type { SubsidisedProvider } from '$lib/core/subsidisation';
	import CachePanel from '$lib/components/CachePanel.svelte';
	import SubsidisationCard from '$lib/components/SubsidisationCard.svelte';
	import PoolSubsidisationCard from '$lib/components/PoolSubsidisationCard.svelte';
	import type { PoolSubsidyRow } from '$lib/components/PoolSubsidisationCard.svelte';
	import { fmtDay } from '$lib/format';

	// `{ feed, dash }` are the core props; `config`, `syncStatus`, and `onTierChange`
	// are page-level concerns (config is page state a tier write mutates) threaded down
	// explicitly — props, not context.
	let {
		feed,
		dash,
		config,
		syncStatus,
		onTierChange
	}: {
		feed: FeedStore;
		dash: Dashboard;
		config: PublicchachingConfig | null;
		syncStatus: SyncStatusView | null;
		onTierChange: (provider: SubsidisedProvider, tier: string, monthlyUsd: number) => void;
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
	let subsidyConfig = $derived(
		config
			? {
					claude: {
						enabled: config.providers.claude.enabled,
						tier: config.providers.claude.subscription.tier,
						monthlyUsd: config.providers.claude.subscription.monthlyUsd
					},
					codex: {
						enabled: config.providers.codex.enabled,
						tier: config.providers.codex.subscription.tier,
						monthlyUsd: config.providers.codex.subscription.monthlyUsd
					}
				}
			: null
	);
	let subsidy = $derived(snap && subsidyConfig ? dash.subsidisation(snap, subsidyConfig) : null);

	// A pooled ledger can contain several subscriptions for the same provider, shared
	// by any number of machines. Reconcile each subscription exactly once against the
	// API-priced value attributed to its id; never multiply the fee by machine count.
	let poolSubsidyRows = $derived.by((): PoolSubsidyRow[] => {
		if (!snap || !syncStatus?.enabled) return [];
		const window = dash.periodWindow(snap);
		const from = focusedDay ?? window.from;
		const to = focusedDay ?? window.to;
		const days =
			Math.round(
				(new Date(to + 'T00:00:00Z').getTime() -
					new Date(from + 'T00:00:00Z').getTime()) /
					86400000
			) + 1;
		const valueBySubscription = new Map<string, number>();
		for (const row of snap.dayModel) {
			if (row.day < from || row.day > to) continue;
			if (dash.machineFilter.size > 0 && (!row.machineId || !dash.machineFilter.has(row.machineId)))
				continue;
			if (dash.providerFilter.size > 0 && !dash.providerFilter.has(row.provider)) continue;
			if (dash.modelFilter.size > 0 && !dash.modelFilter.has(row.model)) continue;
			const subscriptionId = row.subscriptionId;
			if (!subscriptionId) continue;
			valueBySubscription.set(
				subscriptionId,
				(valueBySubscription.get(subscriptionId) ?? 0) + row.cost
			);
		}
		const selected = dash.subscriptionFilter;
		const machineSubscriptions =
			dash.machineFilter.size === 0
				? null
				: new Set(
						syncStatus.mappings
							.filter((mapping) => dash.machineFilter.has(mapping.machineId))
							.flatMap((mapping) => (mapping.subscriptionId ? [mapping.subscriptionId] : []))
					);
		return syncStatus.subscriptions
			.filter((subscription) => selected.size === 0 || selected.has(subscription.id))
			.filter(
				(subscription) => machineSubscriptions === null || machineSubscriptions.has(subscription.id)
			)
			// A provider filter must drop subscriptions it can't hold value for, otherwise
			// their full fee counts against a ~$0 value (M6a).
			.filter(
				(subscription) =>
					dash.providerFilter.size === 0 || dash.providerFilter.has(subscription.provider)
			)
			.map((subscription) => ({
				id: subscription.id,
				name: subscription.name,
				provider: subscription.provider,
				account: subscription.account,
				valueUsd: valueBySubscription.get(subscription.id) ?? 0,
				feeUsd: subscription.monthlyUsd * (days / 30)
			}));
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
	{#if syncStatus?.enabled && poolSubsidyRows.length > 0}
		<PoolSubsidisationCard
			rows={poolSubsidyRows}
			windowLabel={heroLabel}
			wholePlanFee={dash.machineFilter.size > 0}
		/>
	{:else if subsidy && subsidyConfig}
		<SubsidisationCard rollup={subsidy} windowLabel={heroLabel} config={subsidyConfig} {onTierChange} burnPace={pace} />
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
