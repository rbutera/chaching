<script lang="ts">
	import { SUBSCRIPTION_PRESETS } from '@chaching/shared/subscription-presets';
	import type { Account } from '@chaching/shared/accounts';
	import { money, providerLabel } from '@chaching/shared/format';
	import Button from './ds/Button.svelte';

	let { account, busy, onSave, matches = [], onMatch }: {
		account: Account;
		matches?: Account[];
		onMatch: (id: string, legacyId: string | null) => Promise<void>;
		busy: boolean;
		onSave: (id: string, name: string, tier: string, monthlyUsd: number) => Promise<void>;
	} = $props();
	let name = $state('');
	let tier = $state('');
	let presets = $derived(account.provider === 'claude' || account.provider === 'codex' ? SUBSCRIPTION_PRESETS[account.provider] : []);
	let savedName = $derived(account.name);
	$effect(() => { name = savedName; });
	let fee = $state<number | undefined>();
	let result = $state('');
	let error = $state('');
	let saving = $state(false);
	let savedTier = $derived(account.tier);
	let savedFee = $derived(account.monthlyUsd);
	$effect(() => { tier = savedTier; fee = savedFee ?? undefined; });

	function selectTier() {
		const preset = presets.find(preset => preset.id === tier);
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
			await onSave(account.id, name, tier, fee);
			result = 'Saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save the fee. Try again.';
		} finally {
			saving = false;
		}
	}
	let legacyId = $state('');
	async function match() {
		if (!legacyId || busy || saving) return;
		saving = true;
		error = '';
		try { await onMatch(account.id, legacyId === 'separate' ? null : legacyId.slice(5)); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not match the Account.'; }
		finally { saving = false; }
	}

</script>

<form onsubmit={save} aria-label={`${account.name} plan`}>
	<h4>{providerLabel(account.provider)}</h4>
	{#if matches.length}
		<p class="match-note">Match this login to an existing bill. Its fee is excluded until resolved.</p>
		<label>Existing bill<select bind:value={legacyId} disabled={busy || saving}>
			<option value="">Choose an existing bill</option>
			<option value="separate">Separate Account — keep both fees</option>
			{#each matches as bill (bill.id)}<option value={'bill:' + bill.id}>{bill.name} · {bill.monthlyUsd === null ? 'Unknown fee' : money(bill.monthlyUsd)}</option>{/each}
		</select></label>
		<Button type="button" variant="secondary" disabled={!legacyId || busy || saving} onclick={match}>{legacyId === 'separate' ? 'Keep separate' : 'Match Account'}</Button>
	{/if}
	<label class="account-name">Account name<input required bind:value={name} disabled={busy || saving}/></label>
	<div class="fields">
		<label>Plan<select bind:value={tier} onchange={selectTier} disabled={busy || saving}>
			{#each presets as preset (preset.id)}<option value={preset.id}>{preset.label}{preset.custom ? '' : ` · ${money(preset.monthlyUsd)}`}</option>{/each}
			{#if !presets.some(preset => preset.id === account.tier)}<option value={account.tier}>{account.tier}</option>{/if}
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
	.match-note {color:var(--text-muted);margin:0 0 12px}
	.account-name {margin-bottom:12px}
	.fields {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}
	label {display:grid;gap:6px;font-size:12px;color:var(--text-muted);min-width:0}
	input, select {min-width:0;width:100%;height:40px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text);font:inherit;font-size:14px}
	input:focus-visible, select:focus-visible {outline:2px solid var(--accent);outline-offset:2px}
	p {font-size:12px;margin:12px 0 0;color:var(--good)}
	.error {color:var(--bad)}
	@media(max-width:500px) {.fields {grid-template-columns:1fr}}
</style>
