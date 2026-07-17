<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import StatCard from '$lib/components/ds/StatCard.svelte';
	import { money, compactTokens, modelLabel, modelColor, int } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';
	import { coverageSub } from '$lib/core/coverage-marks';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// UTC today (YYYY-MM-DD): the live tail. Matches the engine's isoDayUTC(now()); used to
	// tell a "so far today" partial bar from a PAST day a gated scan left partial.
	let todayUTC = $derived(new Date(snap?.generatedAt ?? Date.now()).toISOString().slice(0, 10));

	// scoped models / totals — pinned-day-scoped when focused, else period-scoped.
	let modelTotals = $derived(
		snap ? (focusedDay ? dash.focusedModels(snap, focusedDay) : dash.models(snap)) : []
	);
	let scopedTotals = $derived(
		snap
			? focusedDay
				? dash.focusedTotals(snap, focusedDay)
				: dash.scopedTotals(snap)
			: { tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, cost: 0, requests: 0, costUnknownRequests: 0, coverage: { states: {}, worst: 'frozen' as const } }
	);

	// whether the scoped window's partial day is TODAY (live tail) vs a past gated-partial day.
	// In focused mode this is "is the pinned day today".
	let windowIncludesToday = $derived(
		!!snap && (focusedDay ? focusedDay === todayUTC : snap.coverage[todayUTC] === 'partial')
	);

	// Cache-cost breakdown for the current scope (follows the period selector). Every
	// rate comes from resolvePrice via cacheCostBreakdown — no hardcoded per-family
	// literals (the old inline-rate drift is gone). Drives the "Cache savings" StatCard.
	let cacheBreakdown = $derived(snap ? dash.cacheBreakdown(snap).combined : null);
	let cacheSavings = $derived.by(() => {
		const b = cacheBreakdown;
		if (!b) return { saved: 0, hitRate: 0 };
		const cacheRead = b.cacheReadTokens;
		const totalInputish = scopedTotals.tokens.input + scopedTotals.tokens.cacheCreation + cacheRead;
		return { saved: b.savedVsUncached, hitRate: totalInputish > 0 ? cacheRead / totalInputish : 0 };
	});

	let topModel = $derived(modelTotals[0] ?? null);
	let totalTok = $derived(totalTokens(scopedTotals.tokens));
</script>

<!-- REGION 4 · STAT ROW -->
<section class="stat-grid" aria-label="Summary">
	<StatCard
		label="total spend"
		value={scopedTotals.cost}
		money
		animate
		moneyTone="gold"
		accent="var(--accent)"
		sub={coverageSub(scopedTotals.coverage, windowIncludesToday) ?? `${int(scopedTotals.requests)} requests`}
	/>
	<StatCard
		label="total tokens"
		value={compactTokens(totalTok)}
		accent="var(--m-sonnet)"
		sub={`${compactTokens(scopedTotals.tokens.output)} output`}
	/>
	<StatCard
		label="cache savings"
		value={cacheSavings.saved}
		money
		animate
		moneyTone="save"
		accent="var(--good)"
		sub={`${Math.round(cacheSavings.hitRate * 100)}% cache-read share`}
	/>
	<StatCard
		label="top model"
		value={topModel ? modelLabel(topModel.model) : '—'}
		accent={topModel ? modelColor(topModel.model) : 'var(--m-other)'}
		sub={topModel ? `${money(topModel.cost)} · ${compactTokens(totalTokens(topModel.tokens))}` : ''}
	/>
</section>

<style>
	/* REGION 4 · STAT ROW — base 2-up, 4-up at >= 720px. */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 720px) {
		.stat-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
