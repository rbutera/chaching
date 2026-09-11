<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import CalendarHeatmap from '$lib/components/CalendarHeatmap.svelte';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// calendar heatmap series: one cell per banked day (full range), cost-shaded + coverage.
	let dayCells = $derived(snap ? dash.byDay(snap) : []);
	let coverageByDay = $derived(new Map(dayCells.map(cell => [cell.day, cell.coverage])));
	function coverageFor(day: string): import('$lib/types').DayCoverage {
		return coverageByDay.get(day) ?? 'missing';
	}
</script>

<!-- REGION 6 · CALENDAR HEATMAP (primary time-nav surface) -->
{#if snap}
	<section class="heatmap-sec" aria-label="Daily spend calendar">
		<div class="panel">
			<CalendarHeatmap
				cells={dayCells}
				{focusedDay}
				coverage={coverageFor}
				onPick={(day) => dash.setFocusedDay(snap, day)}
			/>
		</div>
	</section>
{/if}

<style>
	/* REGION 6 · HEATMAP */
	.heatmap-sec {
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
</style>
