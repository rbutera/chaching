<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import MoneyOdometer from '$lib/components/ds/MoneyOdometer.svelte';
	import { pctDelta } from '$lib/format';
	import { coverageWord } from '$lib/core/coverage-marks';
	import { flourishFor, formatFlourishText, DAILY_FLOURISHES, LIFETIME_FLOURISHES, BLOCK_FLOURISHES } from '$lib/voice';
	let { feed, dash, reducedMotion, suppressArt }: { feed: FeedStore; dash: Dashboard; reducedMotion: boolean; suppressArt: boolean } = $props();
	let snap = $derived(feed.snapshot);
	let headlines = $derived(snap ? dash.headlines(snap) : null);
	let activeBlock = $derived((snap?.localBlocks ?? snap?.blocks ?? []).find(block => block.isActive));
	let periods = $derived(headlines ? [
		{ label: 'Today', period: 'day', data: headlines.today, baseline: 'yesterday', flourish: DAILY_FLOURISHES },
		{ label: '7 days', period: 'week', data: headlines.week, baseline: 'previous 7 days', flourish: null },
		{ label: '30 days', period: 'month', data: headlines.month, baseline: 'previous 30 days', flourish: null },
		{ label: 'All time', period: 'all', data: headlines.all, baseline: '', flourish: LIFETIME_FLOURISHES }
	] satisfies Array<{label:string;period:'day'|'week'|'month'|'all';data:typeof headlines.today;baseline:string;flourish:typeof DAILY_FLOURISHES|null}> : []);
</script>

<section class="spend-overview" aria-label="Spend overview">
	<div title="This machine's active five-hour block">
		<span class="label">5h block</span>
		{#if activeBlock}<MoneyOdometer amount={activeBlock.cost} tone="default" size="hero" reducedMotion={reducedMotion || suppressArt}/>{:else}<span class="unavailable">—</span>{/if}
		{#if activeBlock && !suppressArt}<small>{formatFlourishText(flourishFor(activeBlock.cost, BLOCK_FLOURISHES))}</small>{/if}
	</div>
	{#each periods as item (item.period)}
		{@const flourish = item.flourish ? formatFlourishText(flourishFor(item.data.current.cost, item.flourish)) : ''}
		{@const delta = item.period === 'all' ? null : pctDelta(item.data.current.cost, item.data.prior.cost, item.data.priorHasBaseline)}
		<div>
			<button onclick={() => { dash.setWindowEnd(null); dash.setPeriod(item.period); }}>
				<span class="label">{item.label}</span>
				{#if item.period === 'day' && item.data.current.coverage.worst === 'missing'}<span class="unavailable">{coverageWord('missing')}</span>{:else}<MoneyOdometer amount={item.data.current.cost} tone="default" size="hero" reducedMotion={reducedMotion || suppressArt}/>{/if}
			</button>
			{#if delta}<span class="delta {delta.dir}" title={`Compared with ${item.baseline}`} aria-label={`${delta.text} compared with ${item.baseline}`}>{delta.text}</span>{/if}
			{#if flourish && !suppressArt && item.data.current.cost > 0}<small>{flourish}</small>{/if}
		</div>
	{/each}
</section>

<style>
	.spend-overview{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:20px 0;border-bottom:1px solid var(--border);gap:20px}.spend-overview>div+div{border-left:1px solid var(--border);padding-left:20px}button{background:none;border:0;color:inherit;padding:0;cursor:pointer;text-align:left;width:100%;display:block;line-height:1.15}button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.label{display:block;font:var(--type-label);margin-bottom:10px}.spend-overview :global(.money){font-size:clamp(26px,3.5vw,52px)}small{display:block;color:var(--accent);font-size:11px;margin-top:8px;min-height:16px}.delta{display:block;font-size:13px;font-weight:600;margin-top:8px}.up{color:var(--bad)}.down{color:var(--good)}.flat{color:var(--text-muted)}.unavailable{font:var(--type-title);display:block;min-height:40px}@media(max-width:760px){.spend-overview{gap:8px;padding:12px 0}.spend-overview>div+div{padding-left:8px}.spend-overview :global(.money){font-size:clamp(18px,4vw,28px)}small{font-size:9px}.delta{font-size:12px}}@media(max-width:500px){.spend-overview{grid-template-columns:1fr 1fr}.spend-overview>div:nth-child(odd){border:0;padding:0}.spend-overview>div:last-child{grid-column:1/-1}.spend-overview :global(.money){font-size:32px}}
	@media(max-height:650px){.spend-overview{padding:8px 0}.label{margin-bottom:6px}.delta{margin-top:4px}}
</style>
