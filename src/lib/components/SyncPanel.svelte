<script lang="ts">
	import type { SyncAction, SyncStatusView } from '$lib/client/sync';

	interface Props {
		status: SyncStatusView | null;
		onAction: (action: SyncAction) => Promise<void>;
	}

	let { status, onAction }: Props = $props();

	let mode = $state<'create' | 'join'>('create');
	let databaseUrl = $state('');
	let poolName = $state('');
	let poolId = $state('');
	let machineName = $state('');
	let busy = $state(false);
	let error = $state('');
	let confirmingLeave = $state(false);

	// Configured but PostgreSQL unreachable: known joined identity, no live pool payload.
	let offline = $derived(!!status?.enabled && !status?.pool && !!status?.localIdentity);

	let provider = $state('claude');
	let subscriptionName = $state('');
	let account = $state('');
	let tier = $state('custom');
	let monthlyUsd = $state('200');

	const providers = ['claude', 'codex', 'opencode', 'pi', 'cursor'];

	async function run(action: SyncAction): Promise<boolean> {
		error = '';
		busy = true;
		try {
			await onAction(action);
			return true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Sync configuration failed.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function connect(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const url = databaseUrl.trim();
		const machine = machineName.trim();
		if (!url || !machine) {
			error = 'Database URL and machine name are required.';
			return;
		}
		let ok: boolean;
		if (mode === 'create') {
			if (!poolName.trim()) {
				error = 'Pool name is required.';
				return;
			}
			ok = await run({
				action: 'create',
				databaseUrl: url,
				poolName: poolName.trim(),
				machineName: machine
			});
		} else {
			if (!poolId.trim()) {
				error = 'Pool ID is required.';
				return;
			}
			ok = await run({
				action: 'join',
				databaseUrl: url,
				poolId: poolId.trim(),
				machineName: machine
			});
		}
		// Keep the typed URL on failure so a bad connection doesn't force a re-type.
		if (ok) databaseUrl = '';
	}

	async function addSubscription(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const fee = Number(monthlyUsd);
		if (!subscriptionName.trim() || !Number.isFinite(fee) || fee < 0) {
			error = 'Subscription name and a non-negative monthly fee are required.';
			return;
		}
		const ok = await run({
			action: 'add-subscription',
			provider,
			name: subscriptionName.trim(),
			account: account.trim(),
			tier: tier.trim() || 'custom',
			monthlyUsd: fee
		});
		if (ok) {
			subscriptionName = '';
			account = '';
		}
	}

	function mappedSubscription(machineId: string, mappedProvider: string): string {
		return (
			status?.mappings.find(
				(mapping) => mapping.machineId === machineId && mapping.provider === mappedProvider
			)?.subscriptionId ?? ''
		);
	}
</script>

<section class="sync-panel panel" aria-labelledby="sync-heading">
	<div class="sync-head">
		<div>
			<p class="eyebrow">Chaching Sync</p>
			<h2 id="sync-heading">{status?.enabled ? status.pool?.name ?? 'sync pool' : 'pool your machines'}</h2>
		</div>
		<span class:live={status?.enabled && status.pool} class:offline class="state">
			{offline ? 'unreachable' : status?.enabled ? 'connected' : 'local only'}
		</span>
	</div>

	{#if status?.enabled && status.pool && status.machine}
		<p class="summary">
			<strong>{status.machine.name}</strong> is contributing to pool
			<code>{status.pool.id}</code>. PostgreSQL is the active ledger; local SQLite history is paused.
		</p>

		<div class="sync-grid">
			<div>
				<h3>machines</h3>
				<ul class="rows">
					{#each status.machines as machine (machine.id)}
						<li>
							<span>
								<strong>{machine.name}</strong>
								<small>{machine.hostname}{machine.current ? ' · this machine' : ''}</small>
							</span>
							<small>{machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString() : 'not seen yet'}</small>
						</li>
					{/each}
				</ul>
			</div>

			<div>
				<h3>subscriptions</h3>
				{#if status.subscriptions.length > 0}
					<ul class="rows">
						{#each status.subscriptions as subscription (subscription.id)}
							<li>
								<span>
									<strong>{subscription.name}</strong>
									<small>{subscription.provider} · {subscription.account || 'no account label'}</small>
								</span>
								<span class="money">${subscription.monthlyUsd}/mo</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">Add the plans shared by machines in this pool.</p>
				{/if}
			</div>
		</div>

		{#if status.managementAllowed !== false}
			<div class="sync-grid forms">
			<form onsubmit={addSubscription}>
				<h3>add subscription</h3>
				<div class="fields">
					<label>
						provider
						<select bind:value={provider}>
							{#each providers as item}<option value={item}>{item}</option>{/each}
						</select>
					</label>
					<label>
						name
						<input bind:value={subscriptionName} placeholder="Work Claude Max" />
					</label>
					<label>
						account label
						<input bind:value={account} placeholder="name@example.com" />
					</label>
					<label>
						tier
						<input bind:value={tier} placeholder="max-20x" />
					</label>
					<label>
						monthly USD
						<input bind:value={monthlyUsd} type="number" min="0" step="0.01" />
					</label>
				</div>
				<button class="primary" type="submit" disabled={busy}>add subscription</button>
			</form>

			<div>
				<h3>this machine uses</h3>
				<div class="mapping-list">
					{#each providers as mappedProvider}
						<label>
							{mappedProvider}
							<select
								value={mappedSubscription(status.machine.id, mappedProvider)}
								onchange={(event) =>
									run({
										action: 'map',
										machineId: status.machine!.id,
										provider: mappedProvider,
										subscriptionId: (event.currentTarget as HTMLSelectElement).value || null
									})}
								disabled={busy}
							>
								<option value="">unmapped</option>
								{#each status.subscriptions.filter((item) => item.provider === mappedProvider) as subscription (subscription.id)}
									<option value={subscription.id}>{subscription.name}</option>
								{/each}
							</select>
						</label>
					{/each}
				</div>
			</div>
			</div>

			<div class="danger-zone">
				{#if confirmingLeave}
					<p class="leave-warn">
						Leaving forgets the stored database URL. Days recorded while pooled stay in
						PostgreSQL only, so this machine's local view will show a gap for that period
						until you rejoin.
					</p>
					<div class="confirm-row">
						<button
							type="button"
							class="danger"
							disabled={busy}
							onclick={() => {
								confirmingLeave = false;
								run({ action: 'leave' });
							}}
						>
							confirm leave
						</button>
						<button type="button" disabled={busy} onclick={() => (confirmingLeave = false)}>
							cancel
						</button>
					</div>
				{:else}
					<p>Leaving returns this machine to its local SQLite ledger. Pool data stays in PostgreSQL.</p>
					<button type="button" class="danger" disabled={busy} onclick={() => (confirmingLeave = true)}>
						leave pool
					</button>
				{/if}
			</div>
		{:else}
			<p class="warning">
				Pool management is local-only. Run <code>chaching sync</code> on this host or open its
				loopback dashboard.
			</p>
		{/if}
	{:else if offline && status?.localIdentity}
		<p class="summary">
			<strong>{status.localIdentity.machineName}</strong> is joined to pool
			<code>{status.localIdentity.poolId}</code>, but PostgreSQL is currently unreachable. This
			machine keeps its place in the pool; contributions resume automatically once the database is
			back.
		</p>
		<p class="warning">
			Pool roster and management are unavailable while the database is offline — no changes can be
			made from here.
		</p>
	{:else}
		<p class="summary">
			Create one PostgreSQL-backed pool, then join every machine that should contribute. Machines can
			share a subscription or map to different ones.
		</p>

		{#if status?.managementAllowed !== false}
			<div class="mode-switch" role="tablist" aria-label="Sync setup mode">
			<button type="button" role="tab" aria-selected={mode === 'create'} class:active={mode === 'create'} onclick={() => (mode = 'create')}>
				create pool
			</button>
			<button type="button" role="tab" aria-selected={mode === 'join'} class:active={mode === 'join'} onclick={() => (mode = 'join')}>
				join pool
			</button>
			</div>

			<form class="connect-form" onsubmit={connect}>
			<label>
				PostgreSQL URL
				<input
					bind:value={databaseUrl}
					type="password"
					autocomplete="off"
					placeholder="postgresql://chaching:••••@100.x.y.z:5432/chaching"
				/>
			</label>
			{#if mode === 'create'}
				<label>
					pool name
					<input bind:value={poolName} placeholder="Rai's machines" />
				</label>
			{:else}
				<label>
					pool ID
					<input bind:value={poolId} placeholder="paste the pool ID" />
				</label>
			{/if}
			<label>
				this machine
				<input bind:value={machineName} placeholder="kinto" />
			</label>
			<button class="primary" type="submit" disabled={busy}>
				{busy ? 'connecting…' : mode === 'create' ? 'create pool' : 'join pool'}
			</button>
			</form>
			<p class="warning">
				Keep PostgreSQL private: bind it to localhost or your Tailscale address, never the public internet.
			</p>
		{:else}
			<p class="warning">
				Sync setup is local-only. Run <code>chaching sync create</code> or <code>chaching sync join</code>
				on this host.
			</p>
		{/if}
	{/if}

	{#if error || status?.error}
		<p class="error" role="alert">{error || status?.error}</p>
	{/if}
</section>

<style>
	.sync-panel {
		margin-bottom: 1rem;
	}
	.sync-head,
	.rows li,
	.danger-zone {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.eyebrow,
	h3,
	label,
	.state,
	.summary,
	.warning,
	.error,
	.muted,
	.danger-zone {
		font-family: var(--font-mono);
	}
	.eyebrow,
	h3 {
		margin: 0;
		color: var(--text-dim);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
	h2 {
		margin: 0.2rem 0 0;
		font-size: 1rem;
	}
	h3 {
		margin-bottom: 0.65rem;
	}
	.state {
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.2rem 0.6rem;
		color: var(--text-muted);
		font-size: var(--text-2xs);
	}
	.state.live {
		border-color: color-mix(in srgb, var(--good) 50%, var(--border));
		color: var(--good);
	}
	.state.offline {
		border-color: color-mix(in srgb, var(--warn) 50%, var(--border));
		color: var(--warn);
	}
	.summary,
	.warning,
	.error,
	.muted,
	.danger-zone {
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--text-muted);
	}
	code {
		color: var(--accent);
	}
	.sync-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.rows span {
		display: flex;
		flex-direction: column;
	}
	small {
		color: var(--text-dim);
	}
	.money {
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.forms {
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.fields,
	.mapping-list,
	.connect-form {
		display: grid;
		gap: 0.6rem;
	}
	.fields {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--text-dim);
		font-size: var(--text-2xs);
	}
	input,
	select {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text);
		padding: 0.45rem 0.55rem;
		font-family: var(--font-mono);
	}
	button {
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-muted);
		padding: 0.4rem 0.8rem;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		cursor: pointer;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	button.primary,
	.mode-switch button.active {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--text-on-gold);
	}
	.primary {
		margin-top: 0.7rem;
	}
	.mode-switch {
		display: flex;
		gap: 0.4rem;
		margin: 1rem 0 0.7rem;
	}
	.connect-form {
		grid-template-columns: 2fr 1fr 1fr auto;
		align-items: end;
	}
	.connect-form .primary {
		margin: 0;
	}
	.warning {
		margin-bottom: 0;
		color: var(--warn);
	}
	.error {
		color: var(--bad);
	}
	.danger-zone {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.danger-zone {
		flex-wrap: wrap;
	}
	.danger-zone p {
		margin: 0;
	}
	.leave-warn {
		flex: 1 1 100%;
		color: var(--warn);
	}
	.confirm-row {
		display: flex;
		gap: 0.5rem;
	}
	button.danger {
		border-color: color-mix(in srgb, var(--bad) 45%, var(--border));
		color: var(--bad);
		flex: none;
	}
	@media (max-width: 760px) {
		.sync-grid,
		.fields,
		.connect-form {
			grid-template-columns: 1fr;
		}
		.connect-form .primary {
			margin-top: 0.2rem;
		}
	}
</style>
