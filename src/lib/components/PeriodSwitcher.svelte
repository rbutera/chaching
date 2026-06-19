<script lang="ts">
	import type { Period } from '$lib/types';

	let { value, onChange }: { value: Period; onChange: (p: Period) => void } = $props();

	const options: { id: Period; label: string }[] = [
		{ id: 'day', label: 'Day' },
		{ id: 'week', label: 'Week' },
		{ id: 'month', label: 'Month' }
	];

	function onKey(e: KeyboardEvent, idx: number) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const dir = e.key === 'ArrowRight' ? 1 : -1;
			const next = (idx + dir + options.length) % options.length;
			onChange(options[next].id);
		}
	}
</script>

<div class="seg" role="tablist" aria-label="Aggregation period">
	{#each options as opt, i (opt.id)}
		<button
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
	.seg {
		display: inline-flex;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 3px;
		gap: 2px;
	}
	.seg button {
		border: none;
		background: transparent;
		color: var(--fg-muted);
		padding: 0.4rem 1.1rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 550;
		transition:
			background 0.18s,
			color 0.18s;
		min-height: 36px;
	}
	.seg button.active {
		background: var(--surface-3);
		color: var(--fg);
	}
	.seg button:hover:not(.active) {
		color: var(--fg);
	}
</style>
