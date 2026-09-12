<script lang="ts">
	import type { FeedStore } from '../../client/feed.svelte';
	import type { Dashboard } from '../../client/dashboard.svelte';
	import TrendChart from '../TrendChart.svelte';
	import type { PeriodBucket } from '@chaching/shared/aggregate';
	import { fmtPeriodKey } from '@chaching/shared/format';
	let { feed, dash, reducedMotion = false }: { feed: FeedStore; dash: Dashboard; reducedMotion?: boolean } = $props();
	let snap = $derived(feed.snapshot);
	let trend = $derived(snap ? dash.trend(snap) : []);
	let models = $derived([...new Set(trend.flatMap(bucket => [...bucket.byModel.keys()]))]);
	function pick(bucket: PeriodBucket) {
		if (!snap) return;
		if (/^\d{4}-\d{2}-\d{2}$/.test(bucket.key)) {
			dash.setFocusedDay(snap, bucket.key);
			return;
		}
		const range = dash.bucketDayRange(snap, bucket);
		dash.openPeriodDrill({ ...range, periodKey: bucket.key, label: fmtPeriodKey(bucket.key) });
	}
</script>

<section aria-label="Spend">
	{#if trend.length}<TrendChart buckets={trend} {models} onPick={pick} today={dash.today} {reducedMotion}/>
	{:else}<p>No data in this scope.</p>{/if}
</section>
<style>section{min-width:0}p{color:var(--text-muted);padding:20px 0}</style>
