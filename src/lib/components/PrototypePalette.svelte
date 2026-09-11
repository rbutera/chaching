<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { dev } from '$app/environment';
	import { palettes, paletteVars, semanticGroups } from '$lib/brand/prototype-palettes';
	const index = $derived(Math.max(0, palettes.findIndex(p => p.id === page.url.searchParams.get('palette'))));
	const palette = $derived(palettes[index]);
	const vars = $derived(paletteVars(palette));
	$effect(() => {
		for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--${name}`, value);
		document.documentElement.style.colorScheme = palette.scheme;
		document.documentElement.dataset.theme = palette.id;
	});
	function select(id: string) {
		const url = new URL(page.url); url.searchParams.set('palette', id);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	function move(direction: number) { select(palettes[(index + direction + palettes.length) % palettes.length].id); }
	function key(event: KeyboardEvent) {
		if (!dev || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
		if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input,textarea,select'))) return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
	}
</script>
<svelte:window onkeydown={key}/>
{#if dev}
	<div class="palette-controls" aria-label="Palette comparison">
		<button aria-label="Previous palette" onclick={() => move(-1)}>←</button>
		<label><span>Palette {index + 1} / {palettes.length}</span><select aria-label="Palette" value={palette.id} onchange={e => select(e.currentTarget.value)}>{#each palettes as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
		<button aria-label="Next palette" onclick={() => move(1)}>→</button>
	</div>
{/if}
<details class="mapping">
	<summary>Palette mapping · {palette.name}</summary>
	<p>{palette.note}</p>
	<div class="surfaces">{#each palette.surfaces as surface, i}<span style:background={surface}>Surface {i}<code>{surface}</code></span>{/each}</div>
	{#each Object.entries(semanticGroups) as [group, names]}
		<h3>{group}</h3><div class="swatches">{#each names as name}<div><span class="swatch" style:background={vars[name]}></span><span>{name}<code>{vars[name]}</code></span></div>{/each}</div>
	{/each}
</details>
<style>
	.palette-controls{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:var(--z-toast);display:flex;gap:8px;align-items:center;max-width:calc(100vw - 24px);padding:8px;background:var(--surface-3);color:var(--text);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow)}
	label{display:grid;gap:2px;min-width:0}label>span{font-size:10px;color:var(--text-muted)}select{background:var(--surface-3);color:var(--text);max-width:100%;min-height:36px;border:0;font:inherit;font-size:13px}button{color:var(--text);cursor:pointer;min-width:44px;min-height:44px}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
	.mapping{max-width:1344px;margin:0 auto 120px;padding:16px 24px;color:var(--text);border-top:1px solid var(--border)}summary{cursor:pointer;min-height:44px;line-height:44px;font-size:13px}p{font-size:13px;color:var(--text-muted);max-width:75ch}.surfaces,.swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}.surfaces>span{padding:20px;border:1px solid var(--border)}code{display:block;font-size:11px;margin-top:4px}h3{font-size:13px;margin:24px 0 12px}.swatches>div{display:flex;align-items:center;gap:10px;font-size:12px}.swatch{display:block;width:16px;height:32px;flex-shrink:0}
	@media(max-width:650px){.palette-controls{width:calc(100vw - 24px);box-sizing:border-box;gap:4px}label{flex:1}select{width:100%;font-size:16px;min-height:44px}}
</style>
