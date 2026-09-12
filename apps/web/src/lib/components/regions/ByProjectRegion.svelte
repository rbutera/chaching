<script lang="ts">
	import type { FeedStore } from '../../client/feed.svelte';
	import type { Dashboard } from '../../client/dashboard.svelte';
	import BreakdownTable from '../BreakdownTable.svelte';
	import { totalTokens } from '@chaching/shared/aggregate';
	let { feed, dash, reducedMotion = false }: { feed: FeedStore; dash: Dashboard; reducedMotion?: boolean } = $props();
	let snap = $derived(feed.snapshot);
	let rows = $derived((snap ? dash.projectTotals(snap) : []).map(project => ({
		id: project.project, name: project.display, detail: project.project || 'Sessions with no recorded project',
		cost: project.cost, tokens: totalTokens(project.tokens), count: project.sessionCount, costUnknownRequests: project.costUnknownRequests
	})));
</script>

<section class="by-project-sec" aria-label="Spend by project">
	<h2>Projects</h2>
	<p>Whole sessions overlapping this window.</p>
	<BreakdownTable {rows} label="Projects" countLabel="Sessions" {reducedMotion}/>
</section>

<style>
	.by-project-sec{min-width:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-1)}
	h2{font:var(--type-title);margin:0 0 6px}
	p{font-size:12px;color:var(--text-muted);margin:0 0 12px}
</style>
