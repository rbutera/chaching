<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { money } from '@chaching/shared/format';
	import { subsidyMultipleText } from '@chaching/shared/subsidisation';
	import BrandMark from '$lib/components/ds/BrandMark.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let index = $state(0);
	let startX = 0;
	let exportError = $state(false);
	let preview = $state(false);
	const recap = $derived(data.recap);
	const cards = $derived([{ label: 'Your year. Itemised.', value: recap.headline.requests ? money(recap.headline.cost) : 'No usage evidence', detail: 'API-priced usage value' }, ...recap.highlights, { label: 'Keep the receipt.', value: `${recap.year} Wrapped`, detail: 'One image. Your year in AI.' }]);
	const exportUrl = $derived(`${resolve('/api/wrapped.png')}?year=${recap.year}&redact=${data.redact ? '1' : '0'}`);
	function move(direction: number) { index = Math.max(0, Math.min(cards.length - 1, index + direction)); }
	function keydown(event: KeyboardEvent) {
		if (!(event.target instanceof Element) || !event.target.closest('[data-wrapped-story]')) return;
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
		if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
		if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
		if (event.key === 'Home') { event.preventDefault(); index = 0; }
		if (event.key === 'End') { event.preventDefault(); index = cards.length - 1; }
	}
	async function change(year: string, redact: boolean) {
		preview = false; exportError = false;
		await goto(`${resolve('/wrapped')}?year=${year}&redact=${redact ? '1' : '0'}`);
	}
</script>

<svelte:window onkeydown={keydown} />
<svelte:head><title>{recap.year} Wrapped · chaching</title></svelte:head>
<main>
	<header><a href={resolve('/')} aria-label="Back to dashboard"><BrandMark size={28} wordmark /></a><a href={resolve('/')}>Dashboard</a></header>
	<div class="controls">
		<label>Year <select value={recap.year} onchange={event => change(event.currentTarget.value, data.redact)}>{#each Array.from({ length: new Date().getUTCFullYear() - 1999 }, (_, i) => new Date().getUTCFullYear() - i) as year}<option value={year}>{year}</option>{/each}</select></label>
		<label><input type="checkbox" checked={data.redact} onchange={event => change(String(recap.year), event.currentTarget.checked)} /> Hide names for sharing</label>
	</div>
	<p class="scope">{recap.scope} · {recap.from} to {recap.to}{recap.yearToDate ? ' · Year to date' : ''}</p>
	<section data-wrapped-story aria-label="Yearly Wrapped story" aria-roledescription="carousel" ontouchstart={event => { startX = event.changedTouches[0].clientX; }} ontouchend={event => { const distance = event.changedTouches[0].clientX - startX; if (Math.abs(distance) > 60) move(distance < 0 ? 1 : -1); }}>
		<div class="card" aria-live="polite" aria-atomic="true">
			<p class="eyebrow">{recap.year} WRAPPED · {index + 1} / {cards.length}</p>
			<h1>{cards[index].label}</h1><p class="value">{cards[index].value}</p><p>{cards[index].detail}</p>
			{#if index === 0}
				{#if recap.headline.costUnknownRequests}<p>Plus usage without a known price.</p>{/if}
				<div class="comparison"><p>{recap.comparison.windowFeeUsd === null ? 'Fee unavailable' : money(recap.comparison.windowFeeUsd)} in configured, prorated subscription fees</p><p>{money(recap.comparison.sub.apiEquivalentUsd)} {recap.comparisonUnknownRequests ? 'known API value' : 'API value'} from those subscriptions · {recap.comparisonUnknownRequests && recap.comparison.sub.multiple !== null ? 'at least ' : ''}{subsidyMultipleText(recap.comparison.sub)}</p></div>
			{/if}
			{#if index === cards.length - 1}
				<button onclick={() => { preview = !preview; }}>Preview summary image</button>
				{#if preview && !exportError}<img src={exportUrl} alt="Your yearly Wrapped summary" onerror={() => { exportError = true; }} />{/if}
				{#if exportError}<p role="status">Image export is unavailable. Your story is still here.</p>{:else}<a class="download" href={exportUrl} download={`chaching-wrapped-${recap.year}.png`}>Download image</a>{/if}
			{/if}
		</div>
		<nav aria-label="Story controls"><button aria-disabled={index === 0} onclick={() => move(-1)}>Previous</button><span>{index + 1} of {cards.length}</span><button aria-disabled={index === cards.length - 1} onclick={() => move(1)}>Next</button></nav>
	</section>
	{#if recap.partial}<p class="coverage">Partial history. {recap.availableFrom ? `Retained usage spans ${recap.availableFrom} to ${recap.availableTo}.` : 'No retained usage for this year.'}</p>{/if}
</main>

<style>
	main { max-width: 880px; margin: auto; padding: 24px; }
	header, .controls, nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
	header { margin-bottom: 36px; }
	a { color: inherit; } label { display: flex; align-items: center; gap: 8px; }
	button, select, .download { min-height: 44px; padding: 10px 18px; font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 6px; }
	input { width: 22px; height: 22px; } button { cursor: pointer; } button[aria-disabled="true"] { opacity: .35; cursor: default; }
	:focus-visible { outline: 3px solid var(--color-accent, #d5a451); outline-offset: 4px; }
	.scope, .coverage { font-size: 13px; line-height: 1.6; }
	section { border: 1px solid currentColor; border-radius: 16px; overflow: hidden; touch-action: pan-y; }
	.card { min-height: 420px; padding: 42px; display: flex; flex-direction: column; justify-content: center; overflow-wrap: anywhere; }
	.eyebrow { font-size: 12px; letter-spacing: .1em; } h1 { font-size: clamp(24px, 5vw, 42px); margin: 20px 0; }
	.value { font-size: clamp(32px, 7vw, 64px); font-weight: 700; line-height: 1.15; margin: 8px 0; }
	.comparison { margin-top: 24px; border-top: 1px dashed currentColor; font-size: 14px; }
	nav { padding: 20px; border-top: 1px solid currentColor; } img { width: 100%; height: auto; margin-top: 20px; } .download { display: inline-flex; align-items: center; align-self: flex-start; margin-top: 16px; }
	@media (max-width: 560px) { main { padding: 16px; } .card { padding: 24px; min-height: 360px; } }
</style>
