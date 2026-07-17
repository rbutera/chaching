<script lang="ts">
	import type { SyncMachineView, SyncSubscriptionView } from '$lib/client/sync';

	interface Props {
		machines: SyncMachineView[];
		subscriptions: SyncSubscriptionView[];
		machineFilter: Set<string>;
		subscriptionFilter: Set<string>;
		onMachineToggle: (id: string) => void;
		onSubscriptionToggle: (id: string) => void;
		onClear: () => void;
	}

	let {
		machines,
		subscriptions,
		machineFilter,
		subscriptionFilter,
		onMachineToggle,
		onSubscriptionToggle,
		onClear
	}: Props = $props();
</script>

{#if machines.length > 1 || subscriptions.length > 1}
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

		{#if subscriptions.length > 1}
			<div class="filter-group" aria-label="Subscription filter">
				<span class="filter-label">subscriptions</span>
				{#each subscriptions as subscription (subscription.id)}
					<button
						type="button"
						class:active={subscriptionFilter.has(subscription.id)}
						aria-pressed={subscriptionFilter.has(subscription.id)}
						onclick={() => onSubscriptionToggle(subscription.id)}
					>
						{subscription.name}
					</button>
				{/each}
			</div>
		{/if}

		{#if machineFilter.size > 0 || subscriptionFilter.size > 0}
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
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
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
