<script lang="ts">
	import { accounts } from './prototype-data';
	let names = $state(accounts.map(a => a.name));
	let fees = $state(accounts.map(a => a.monthlyUsd));
	let editing = $state<string | null>(null);
	let { personality = $bindable(true), motion = $bindable(true) } = $props<{ personality?: boolean; motion?: boolean }>();
	let status = $state('');
</script>

<div class="settings">
	<section aria-labelledby="account-settings">
		<h2 id="account-settings">Accounts</h2>
		{#each accounts as account, i}
			<div class="account">
				<div class="identity"><span class="provider">{account.provider.slice(0,1)}</span><div><strong>{names[i]}</strong><small>{account.provider} · {account.plan}</small></div></div>
				<span class="fee">${fees[i]}<small>/ month</small></span>
				<button aria-expanded={editing === account.id} onclick={() => editing = editing === account.id ? null : account.id}>{editing === account.id ? 'Done' : 'Edit'}</button>
			</div>
			{#if editing === account.id}
				<div class="editor"><label>Name<input bind:value={names[i]} /></label><label>Monthly fee ($)<input type="number" min="0" step="1" bind:value={fees[i]} /></label><p>{account.machines.join(' · ')}</p></div>
			{/if}
		{/each}
	</section>
	<section aria-labelledby="sync-settings">
		<div class="heading"><h2 id="sync-settings">Sync</h2><span class="connected">Connected</span></div>
		<div class="row"><div><strong>Rai’s machines</strong><small>2 machines · Last synced just now</small></div><button onclick={() => status = 'Preview refreshed. No live sync request was sent.'}>Sync now</button></div>
		<div class="machine"><strong>MacBook</strong><small>This machine</small></div><div class="machine"><strong>Mac mini</strong><small>Seen 2 minutes ago</small></div>
	</section>
	<section aria-labelledby="display-settings">
		<h2 id="display-settings">Display</h2>
		<label class="row"><span><strong>Personality</strong><small>The flourishes, the little celebrations.</small></span><input type="checkbox" bind:checked={personality}/></label>
		<label class="row"><span><strong>Animations</strong><small>Rolling numbers and moving charts.</small></span><input type="checkbox" bind:checked={motion}/></label>
	</section>
	<p class="note">Preview settings only. Your real accounts and preferences are unchanged.</p>
	<p role="status">{status}</p>
</div>

<style>
	.settings{max-width:840px}section{margin-bottom:32px}h2{font:var(--type-title);margin:0 0 12px}.heading{display:flex;justify-content:space-between;align-items:baseline}.connected{color:var(--good);font:var(--type-label)}.account,.row{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)}.identity{display:flex;align-items:center;gap:12px;flex:1;min-width:0}strong{font-size:14px;font-weight:500}small{display:block;font:11px/1.6 var(--font-sans);color:var(--text-muted)}.provider{display:grid;place-items:center;width:32px;height:32px;background:var(--accent-soft);color:var(--accent);font:var(--type-title)}.fee{font:var(--type-num);text-align:right}.fee small{display:inline;margin-left:5px}.row>div,.row>span{flex:1}button{border:1px solid var(--border);background:var(--surface-2);padding:7px 12px;color:var(--text);font:12px var(--font-sans);cursor:pointer;min-height:34px}button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.editor{display:grid;grid-template-columns:1fr 150px;gap:16px;padding:16px;background:var(--surface-2)}.editor label{display:grid;gap:8px;font:var(--type-label)}.editor input{min-width:0;width:100%;box-sizing:border-box;background:var(--surface-1);border:1px solid var(--border);color:var(--text);padding:9px;font:var(--type-body)}.editor p{grid-column:1/-1;margin:0;font:var(--type-label);color:var(--text-muted)}.machine{display:flex;justify-content:space-between;padding:12px 0 12px 16px;border-bottom:1px solid var(--border-faint)}input[type=checkbox]{accent-color:var(--accent);width:18px;height:18px;cursor:pointer}.note,[role=status]{font:11px/1.6 var(--font-sans);color:var(--text-muted)}@media(max-width:500px){.fee small{display:block}.editor{grid-template-columns:1fr}.account{gap:10px}.row small{max-width:230px}}
</style>
