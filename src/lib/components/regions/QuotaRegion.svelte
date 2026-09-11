<script lang="ts">
	import NumberFlow from '@number-flow/svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { SyncStatusView } from '$lib/client/sync';
	import { quotaRows } from '$lib/client/quotas';
	import { providerLabel } from '$lib/format';
	let { dash, syncStatus, now, reducedMotion = false }: {
		dash: Dashboard; syncStatus: SyncStatusView | null; now: number; reducedMotion?: boolean;
	} = $props();
	const views = [
		{ id: 'current', label: 'Current' },
		{ id: 'all', label: 'All accounts' },
		{ id: 'provider', label: 'By provider' }
	] satisfies { id: 'current' | 'all' | 'provider'; label: string }[];
	let rows = $derived(quotaRows(syncStatus?.providerQuotas ?? [], dash.providerFilter, dash.machineFilter,
		dash.subscriptionFilter, syncStatus?.subscriptions ?? []));
	let visible = $derived(dash.quotaView === 'current' ? rows.filter(row => row.currentMachines.length) : rows);
	let groups = $derived(dash.quotaView === 'provider'
		? [...new Set(visible.map(row => row.provider))].map(provider => ({ label: providerLabel(provider), rows: visible.filter(row => row.provider === provider) }))
		: [{ label: '', rows: visible }]);
	const machineName = (id: string) => syncStatus?.machines.find(machine => machine.id === id)?.name ?? id;
	const dateLabel = (date: string) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<section class="quotas" aria-label="Account quotas" class:still={reducedMotion}>
	<div class="heading"><h2>Accounts</h2><div class="views" aria-label="Quota view">
		{#each views as view (view.id)}<button aria-pressed={dash.quotaView === view.id} onclick={() => dash.setQuotaView(view.id)}>{view.label}</button>{/each}
	</div></div>
	{#each groups as group (group.label)}
		{#if group.label}<h3>{group.label}</h3>{/if}
		{#each group.rows as row (row.key)}
			<div class="account">
				<div class="identity"><strong>{row.label}</strong><small title={row.observedAt ? 'Observed ' + dateLabel(row.observedAt) : 'No quota observation'}>{(dash.quotaView === 'current' ? row.currentMachines : row.machines).map(machineName).join(', ')}{#if row.observedAt} · {dateLabel(row.observedAt)}{/if}</small>{#if row.hardLimitReached}<small class="limit">Limit reached</small>{/if}</div>
				<div class="windows">
					{#each row.windows as window (window.id)}
						{@const remaining = Math.max(0, 100 - window.usedPercent)}
						<div class="window" class:low={remaining <= 20} class:exhausted={remaining === 0}>
							<div class="window-head"><span>{window.label} left</span><strong aria-label={Math.round(remaining) + '% remaining'}><span aria-hidden="true"><NumberFlow value={remaining} format={{ maximumFractionDigits: 0 }} suffix="%" animated={!reducedMotion}/></span></strong></div>
							<div class="track" role="meter" aria-label={row.label + ', ' + window.label + ' remaining'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={remaining}><span style:width={remaining + '%'}></span></div>
							<small>{window.resetAt ? (Date.parse(window.resetAt) <= now ? 'Reset passed · awaiting update' : 'Resets ' + dateLabel(window.resetAt)) : 'Reset unavailable'}</small>
						</div>
					{:else}<small>Quota unavailable</small>{/each}
				</div>
			</div>
		{/each}
	{/each}
	{#if !visible.length}<p>{dash.quotaView === 'current' && rows.length ? 'Current account unavailable. All accounts shows the reported quotas.' : 'No quota observations in this scope.'}</p>{/if}
</section>

<style>
	.quotas{border-bottom:1px solid var(--border);padding:16px 0;margin-bottom:16px}
	.heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
	h2{font-size:18px;margin:0}
	h3{font-size:14px;margin:18px 0 4px;color:var(--text-muted)}
	.views{display:flex;gap:4px}
	button{font:inherit;font-size:12px;color:var(--text-muted);background:none;border:0;padding:7px 9px;border-radius:var(--radius-sm);cursor:pointer}
	button[aria-pressed=true]{color:var(--text);background:var(--surface-2)}
	button:focus-visible{outline:2px solid var(--accent)}
	.account{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,3fr);gap:24px;padding:14px 0;border-top:1px solid var(--border)}
	.identity{display:flex;flex-direction:column;gap:5px;min-width:0}
	.identity strong{font-size:14px}
	.identity small{overflow-wrap:anywhere}
	small,p{color:var(--text-muted);font-size:11px}
	.windows{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px}
	.window{color:var(--good)}
	.window.low{color:var(--accent)}
	.window.exhausted{color:var(--bad)}
	.limit{color:var(--bad)}
	.window-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:7px}
	.window-head>span{color:var(--text-muted);font-size:12px}
	.window-head strong{font-size:22px;font-variant-numeric:tabular-nums}
	.track{height:5px;background:var(--surface-3);border-radius:3px;margin-bottom:5px;overflow:hidden}
	.track span{display:block;height:100%;background:currentColor;transition:width 400ms ease}
	.still .track span{transition:none}
	@media(prefers-reduced-motion:reduce){.track span{transition:none}}
	@media(max-width:600px){
		.account{grid-template-columns:1fr;gap:8px}
		.identity{flex-direction:row;align-items:baseline;flex-wrap:wrap}
		.identity small{font-size:10px}
		.windows{gap:12px}
		.quotas{padding:12px 0}
		.views button{padding:6px}
	}
	@media(max-height:650px){.quotas{padding:8px 0}.account{padding:8px 0;gap:6px}.window-head{margin-bottom:3px}.window-head strong{font-size:19px}}
</style>
