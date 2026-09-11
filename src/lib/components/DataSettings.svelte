<script lang="ts">
	import type { RollupSnapshot } from '$lib/types';
	import { fmtDay, int } from '$lib/format';
	import { isCalendarDay } from '$lib/core/view-model';
	import Button from './ds/Button.svelte';

	let { snapshot, cutoverTs = null, onSave }: {
		snapshot: RollupSnapshot; cutoverTs: number | null;
		onSave: (value: number | null) => Promise<void>;
	} = $props();
	let date = $state('');
	let saving = $state(false);
	let error = $state('');
	let saved = $state(false);
	$effect(() => { date = cutoverTs === null ? '' : new Date(cutoverTs).toISOString().slice(0, 10); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (date && !isCalendarDay(date)) { error = 'Enter a valid date.'; return; }
		saving = true;
		error = '';
		saved = false;
		try { await onSave(date ? Date.parse(date + 'T00:00:00Z') : null); saved = true; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save the cutover date. Try again.'; }
		finally { saving = false; }
	}
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
	<form onsubmit={save} aria-label="Work/personal cutover">
		<label for="cutover">Work/personal cutover</label>
		<small>Optional. Leave blank to clear.</small>
		<div class="edit"><input id="cutover" type="date" bind:value={date} oninput={() => { saved = false; }} disabled={saving}/><Button type="submit" variant="secondary" disabled={saving}>{saving ? 'Saving…' : 'Save cutover'}</Button></div>
		{#if error}<p role="alert">{error}</p>{/if}
		{#if saved}<p role="status">Saved</p>{/if}
	</form>
</section>

<style>
	section {margin:20px 0;padding:20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-1)}
	h3 {margin:0 0 16px;font-size:16px}
	dl {display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin:0}
	dt,small,p {color:var(--text-muted);font-size:12px}
	dd {margin:5px 0 0;font-variant-numeric:tabular-nums}
	.warning {color:var(--warn);overflow-wrap:anywhere}
	form {margin-top:20px;display:grid;gap:8px}
	.edit {display:flex;gap:8px;flex-wrap:wrap}
	input {min-width:0;max-width:100%;padding:8px;color:var(--text);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;color-scheme:dark}
	input:focus-visible {outline:2px solid var(--accent);outline-offset:2px}
	[role=alert] {color:var(--bad)}
</style>
