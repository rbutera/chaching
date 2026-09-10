<script lang="ts">
	import { dev } from '$app/environment';

	let { variant, onchange, state, onstate }: {
		variant: string;
		onchange: (variant: string) => void;
		state: string;
		onstate: (state: string) => void;
	} = $props();

	const variants = [
		{ id: 'A', name: 'Current first' },
		{ id: 'B', name: 'Account ledger' },
		{ id: 'C', name: 'Provider lanes' }
	];
	let index = $derived(Math.max(0, variants.findIndex((item) => item.id === variant)));

	function move(direction: number) {
		onchange(variants[(index + direction + variants.length) % variants.length].id);
	}

	function handleKey(event: KeyboardEvent) {
		if (!dev || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.target instanceof HTMLElement &&
			(event.target.isContentEditable || event.target.closest('input, textarea, select'))) return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			move(event.key === 'ArrowLeft' ? -1 : 1);
		}
	}
</script>

<svelte:window onkeydown={handleKey} />

{#snippet controls()}
		<div class="variant-controls">
			<button type="button" onclick={() => move(-1)} aria-label="Previous layout" title="Previous layout (left arrow)">←</button>
			<div class="variant-label" aria-live="polite">
				<span>LAYOUT {index + 1} / {variants.length}</span>
				<strong>{variants[index].id} · {variants[index].name}</strong>
			</div>
			<button type="button" onclick={() => move(1)} aria-label="Next layout" title="Next layout (right arrow)">→</button>
		</div>
		<label>
			<span class="visually-hidden">Preview state</span>
			<select value={state} onchange={(event) => onstate(event.currentTarget.value)}>
				<option value="overview">Overview</option>
				<option value="detail">Session detail</option>
				<option value="loading">Cold scan</option>
			</select>
		</label>
{/snippet}

{#if dev}
	<nav class="prototype-switcher desktop" aria-label="Prototype controls">
		{@render controls()}
	</nav>
	<details class="prototype-switcher compact">
		<summary>Layouts · {variants[index].id}</summary>
		<nav class="compact-controls" aria-label="Prototype controls">
			{@render controls()}
		</nav>
	</details>
{/if}

<style>
	.prototype-switcher {
		position: fixed;
		z-index: var(--z-toast);
		bottom: max(16px, env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 16px;
		width: max-content;
		max-width: calc(100vw - 24px);
		padding: 8px;
		border: 1px solid var(--cream-300);
		border-radius: var(--radius);
		background: var(--cream-50);
		color: var(--cream-ink);
		box-shadow: var(--shadow-paper);
		color-scheme: light;
	}
	.compact { display: none; }
	summary { min-height: 44px; padding: 12px; cursor: pointer; font: 12px / 20px var(--font-sans); }
	summary:focus-visible { outline: 2px solid var(--cream-ink); outline-offset: 2px; }
	.variant-controls { display: flex; align-items: center; min-width: 0; gap: 8px; }
	.variant-label { min-width: 168px; display: grid; gap: 4px; text-align: center; }
	.variant-label span { font: 10px var(--font-sans); letter-spacing: .08em; }
	.variant-label strong { font-size: 14px; white-space: nowrap; }
	button { min-width: 44px; min-height: 44px; border-radius: var(--radius-xs); font-size: 22px; }
	button:hover { background: var(--cream-200); }
	select { min-height: 44px; max-width: 100%; padding: 0 28px 0 12px; border: 1px solid var(--cream-300); border-radius: var(--radius-xs); background: var(--cream-100); color: var(--cream-ink); font: 12px var(--font-sans); cursor: pointer; }
	button:focus-visible, select:focus-visible { outline: 2px solid var(--cream-ink); outline-offset: 2px; }
	@media (max-width: 650px), (max-height: 650px) {
		.desktop { display: none; }
		.compact { display: block; left: auto; right: 12px; bottom: max(8px, env(safe-area-inset-bottom)); transform: none; padding: 0; }
		.compact[open] { width: 300px; }
		.compact-controls { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px; }
		.variant-controls { width: 100%; justify-content: space-between; }
		.variant-label { min-width: 0; }
		label, select { width: 100%; }
	}
</style>
