<script lang="ts">
	import type { Dashboard } from '../client/dashboard.svelte';
	import type { RollupSnapshot } from '@chaching/shared/types';
	import { periodSpan } from '@chaching/shared/view-model';
	import { fmtDay } from '@chaching/shared/format';
	let { dash, snapshot }: { dash: Dashboard; snapshot: RollupSnapshot } = $props();
	let range = $derived(dash.periodWindow(snapshot));
	let end = $derived(dash.focusedDay ?? range.to);
	let start = $derived(dash.focusedDay ?? range.from);
	function step(direction: -1 | 1) {
		if (dash.focusedDay) dash.stepFocusedDay(snapshot, direction);
		else dash.stepWindow(snapshot, direction);
	}
	function selectDay(day: string) {
		if (dash.focusedDay) dash.setFocusedDay(snapshot, day);
		else dash.setWindowEnd(day);
	}
</script>

<div class="range-nav" aria-label="Date navigation">
	<button aria-label="Previous window" disabled={(!dash.focusedDay && periodSpan(dash.period) === null) || (!!snapshot.earliestDay && start <= snapshot.earliestDay)} onclick={() => step(-1)}>‹</button>
	<label title="Choose end date"><span>{start === end ? fmtDay(end) : `${fmtDay(start)} – ${fmtDay(end)}`}</span><input type="date" aria-label="Window ending date" min={snapshot.earliestDay ?? undefined} max={dash.today} value={end} onchange={e => selectDay(e.currentTarget.value)}/></label>
	<button aria-label="Next window" disabled={end >= dash.today || (!dash.focusedDay && periodSpan(dash.period) === null)} onclick={() => step(1)}>›</button>
	{#if dash.windowEnd || dash.focusedDay}<button onclick={() => dash.setWindowEnd(null)}>Latest</button>{/if}
</div>

<style>
	.range-nav{display:flex;align-items:center;gap:4px;font:var(--type-label)}button{background:none;border:0;color:var(--text);cursor:pointer;min-width:32px;min-height:32px;font:inherit}button:disabled{opacity:.35;cursor:default}label{position:relative;cursor:pointer;padding:8px 4px}input{position:absolute;inset:0;width:100%;opacity:0;color-scheme:inherit}button:focus-visible,label:focus-within{outline:2px solid var(--accent);outline-offset:2px}
</style>
