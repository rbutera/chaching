<script lang="ts">
	import { SUBSCRIPTION_PRESETS, type SubscriptionConfig } from '$lib/core/subscription-presets';
	import type { SubsidisedProvider } from '$lib/core/subsidisation';
	import { money, providerLabel } from '$lib/format';
	import Button from './ds/Button.svelte';

	let { provider, subscription, busy, onSave }: {
		provider: SubsidisedProvider;
		subscription: SubscriptionConfig;
		busy: boolean;
		onSave: (provider: SubsidisedProvider, tier: string, monthlyUsd: number) => Promise<void>;
	} = $props();
	let tier = $state('');
	let fee = $state<number | undefined>();
	let result = $state('');
	let error = $state('');
	let saving = $state(false);
	let savedTier = $derived(subscription.tier);
	let savedFee = $derived(subscription.monthlyUsd);
	$effect(() => { tier = savedTier; fee = savedFee; });

	function selectTier() {
		const preset = SUBSCRIPTION_PRESETS[provider].find(preset => preset.id === tier);
		if (preset && !preset.custom) fee = preset.monthlyUsd;
		result = '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy || saving) return;
		if (fee === undefined || !Number.isFinite(fee) || fee < 0) {
			error = 'Enter a monthly fee of zero or more.';
			return;
		}
		error = '';
		result = '';
		saving = true;
		try {
			await onSave(provider, tier, fee);
			result = 'Saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save the fee. Try again.';
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={save} aria-label={`${providerLabel(provider)} plan`}>
	<h4>{providerLabel(provider)}</h4>
	<div class="fields">
		<label>Plan<select bind:value={tier} onchange={selectTier} disabled={busy || saving}>
			{#each SUBSCRIPTION_PRESETS[provider] as preset (preset.id)}<option value={preset.id}>{preset.label}{preset.custom ? '' : ` · ${money(preset.monthlyUsd)}`}</option>{/each}
			{#if !SUBSCRIPTION_PRESETS[provider].some(preset => preset.id === subscription.tier)}<option value={subscription.tier}>{subscription.tier}</option>{/if}
		</select></label>
		<label>Monthly fee (USD)<input type="number" min="0" step="0.01" required bind:value={fee} oninput={() => { tier = 'custom'; result = ''; }} disabled={busy || saving}/></label>
		<Button type="submit" variant="secondary" disabled={busy || saving}>{saving ? 'Saving…' : 'Save'}</Button>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if result}<p role="status">{result}</p>{/if}
</form>

<style>
	form {border:1px solid var(--border);border-radius:var(--radius);padding:20px}
	h4 {margin:0 0 16px;font-size:16px}
	.fields {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}
	label {display:grid;gap:6px;font-size:12px;color:var(--text-muted);min-width:0}
	input, select {min-width:0;width:100%;height:40px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text);font:inherit;font-size:14px}
	input:focus-visible, select:focus-visible {outline:2px solid var(--accent);outline-offset:2px}
	p {font-size:12px;margin:12px 0 0;color:var(--good)}
	.error {color:var(--bad)}
	@media(max-width:500px) {.fields {grid-template-columns:1fr}}
</style>
