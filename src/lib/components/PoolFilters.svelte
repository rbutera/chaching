<script lang="ts">
	import type { SyncMachineView, SyncAccountView } from '$lib/client/sync';

	interface Props {
		machines: SyncMachineView[];
		accounts: SyncAccountView[];
		machineFilter: Set<string>;
		accountFilter: Set<string>;
		onMachineToggle: (id: string) => void;
		onAccountToggle: (id: string) => void;
		onClear: () => void;
	}

	let {
		machines,
		accounts,
		machineFilter,
		accountFilter,
		onMachineToggle,
		onAccountToggle,
		onClear
	}: Props = $props();
</script>

{#if machines.length > 1 || accounts.length > 1}
	<div class="pool-filters" aria-label="Pool filters">
		{#if machines.length > 1}
			<div class="filter-group" aria-label="Machine filter">
				<span class="filter-label">machines</span>
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
		{/if}

		{#if accounts.length > 1}
			<div class="filter-group" aria-label="Account filter">
				<span class="filter-label">accounts</span>
				{#each accounts as subscription (subscription.id)}
					<button
						type="button"
						class:active={accountFilter.has(subscription.id)}
						aria-pressed={accountFilter.has(subscription.id)}
						onclick={() => onAccountToggle(subscription.id)}
					>
						{subscription.name}
					</button>
				{/each}
			</div>
		{/if}

		{#if machineFilter.size > 0 || accountFilter.size > 0}
			<button type="button" class="clear" onclick={onClear}>clear pool filters ✕</button>
		{/if}
	</div>
{/if}

<style>
	.pool-filters,
	.filter-group {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.pool-filters {
		flex-basis: 100%;
		padding-top: 0.2rem;
	}
	.filter-group {
		padding-right: 0.4rem;
		border-right: 1px solid var(--border);
	}
	.filter-label {
		color: var(--text-dim);
		font-family: var(--font-sans);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
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
