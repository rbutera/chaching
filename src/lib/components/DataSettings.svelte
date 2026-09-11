<script lang="ts">
	import type { RollupSnapshot } from '$lib/types';
	import { fmtDay, int } from '$lib/format';
	let { snapshot }: { snapshot: RollupSnapshot } = $props();
</script>

<section aria-labelledby="data-heading">
	<h3 id="data-heading">Data</h3>
	<dl>
		<div><dt>Coverage</dt><dd>{snapshot.earliestDay ? fmtDay(snapshot.earliestDay) : '—'} → {snapshot.latestDay ? fmtDay(snapshot.latestDay) : '—'}</dd></div>
		<div><dt>Responses</dt><dd>{int(snapshot.stats.recordsCounted)}</dd></div>
		<div><dt>Files scanned</dt><dd>{int(snapshot.stats.filesScanned)}</dd></div>
		<div><dt>Duplicates removed</dt><dd>{int(snapshot.stats.duplicatesSkipped)}</dd></div>
	</dl>
	<p>Costs are estimated from token counts and model prices. Claude reasoning tokens are included in output.</p>
	{#if snapshot.unknownPriceModels.length}<p class="warning">Unpriced models, excluded from cost: {snapshot.unknownPriceModels.join(', ')}</p>{/if}

</section>

<style>
	section {margin:20px 0;padding:20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-1)}
	h3 {margin:0 0 16px;font-size:16px}
	dl {display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin:0}
	dt,p {color:var(--text-muted);font-size:12px}
	dd {margin:5px 0 0;font-variant-numeric:tabular-nums}
	.warning {color:var(--warn);overflow-wrap:anywhere}
</style>
