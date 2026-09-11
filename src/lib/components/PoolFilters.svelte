<script lang="ts">
	import type { SyncMachineView } from '$lib/client/sync';

	interface Props {
		machines: SyncMachineView[];
		machineFilter: Set<string>;
		onMachineToggle: (id: string) => void;
		onClear: () => void;
	}

	let {
		machines,
		machineFilter,
		onMachineToggle,
		onClear
	}: Props = $props();
</script>

{#if machines.length > 1}
	<div class="pool-filters" aria-label="Pool filters">
		{#if machines.length > 1}
			<details name="scope-filters">
				<summary>Machines{machineFilter.size ? ` · ${machineFilter.size}` : ''}</summary>
				<div class="filter-group" aria-label="Machine filter">
				{#each machines as machine (machine.id)}
					<button
						type="button"
						class:active={machineFilter.has(machine.id)}
						aria-pressed={machineFilter.has(machine.id)}
						onclick={() => onMachineToggle(machine.id)}
					>
						{machine.name}
					</button>
				{/each}
				</div>
			</details>
		{/if}

		{#if machineFilter.size > 0}
			<button type="button" class="clear" onclick={onClear}>clear machine filters ✕</button>
		{/if}
	</div>
{/if}

<style>
	.pool-filters {position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex-basis:100%;padding-top:3px}
	summary {cursor:pointer;min-height:32px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-pill);font:var(--type-label);color:var(--text-muted)}
	summary:focus-visible {outline:2px solid var(--accent);outline-offset:2px}
	.filter-group {position:absolute;top:100%;left:0;z-index:20;width:min(100%,380px);max-height:240px;overflow:auto;padding:8px;background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);display:flex;flex-direction:column;gap:4px}
	.filter-group button {text-align:left;flex-shrink:0}
	button {
		min-height: 32px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-muted);
		padding: 0.3rem 0.7rem;
		font-family: var(--font-sans);
		font-size: var(--text-2xs);
		cursor: pointer;
	}
	button.active {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
		color: var(--text);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	button.clear {
		color: var(--accent);
	}
</style>
