<script lang="ts">
	import type { Period } from '$lib/types';

	let { value, onChange }: { value: Period; onChange: (p: Period) => void } = $props();

	const options: { id: Period; label: string }[] = [
		{ id: 'day', label: 'Day' },
		{ id: 'week', label: 'Week' },
		{ id: 'month', label: 'Month' },
		{ id: 'quarter', label: 'Quarter' },
		{ id: 'all', label: 'All' }
	];

	// Roving-tabindex refs so arrow/Home/End move DOM focus to the newly-selected
	// tab (the WAI-ARIA tablist pattern): selecting a tab also focuses it.
	let tabs = $state<HTMLButtonElement[]>([]);

	function select(idx: number) {
		const opt = options[idx];
		onChange(opt.id);
		tabs[idx]?.focus();
	}

	function onKey(e: KeyboardEvent, idx: number) {
		let next: number | null = null;
		if (e.key === 'ArrowRight') next = (idx + 1) % options.length;
		else if (e.key === 'ArrowLeft') next = (idx - 1 + options.length) % options.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = options.length - 1;
		if (next !== null) {
			e.preventDefault();
			select(next);
		}
	}
</script>

<div class="seg" role="tablist" aria-label="Aggregation period">
	{#each options as opt, i (opt.id)}
		<button
			bind:this={tabs[i]}
			role="tab"
			aria-selected={value === opt.id}
			class:active={value === opt.id}
			onclick={() => onChange(opt.id)}
			onkeydown={(e) => onKey(e, i)}
			tabindex={value === opt.id ? 0 : -1}
		>
			{opt.label}
		</button>
	{/each}
</div>

<style>
	/* Register & Receipt segmented control — mono labels, brass-on-active (the
	   design's `.seg`/`.on`). */
	.seg {
		display: inline-flex;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 3px;
		gap: 2px;
	}
	.seg button {
		border: none;
		background: transparent;
		color: var(--text-muted);
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-weight: 550;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
		min-height: 34px;
	}
	.seg button.active {
		background: var(--accent);
		color: var(--text-on-gold);
		font-weight: 600;
	}
	.seg button:hover:not(.active) {
		color: var(--text);
	}
	@media (prefers-reduced-motion: reduce) {
		.seg button {
			transition: none;
		}
	}
</style>
