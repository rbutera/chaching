<script lang="ts">
	import { money } from '$lib/format';

	export interface PoolSubsidyRow {
		id: string;
		name: string;
		provider: string;
		account: string;
		valueUsd: number;
		feeUsd: number;
	}

	interface Props {
		rows: PoolSubsidyRow[];
		windowLabel: string;
	}

	let { rows, windowLabel }: Props = $props();
	let totalValue = $derived(rows.reduce((sum, row) => sum + row.valueUsd, 0));
	let totalFee = $derived(rows.reduce((sum, row) => sum + row.feeUsd, 0));
	let multiple = $derived(totalFee > 0 ? totalValue / totalFee : null);
</script>

<section class="pool-subsidy" aria-labelledby="pool-subsidy-heading">
	<div class="head">
		<div>
			<p class="eyebrow">pool subscriptions</p>
			<h2 id="pool-subsidy-heading">{windowLabel}</h2>
		</div>
		<strong class="multiple">{multiple == null ? '∞' : `${multiple.toFixed(1)}×`}</strong>
	</div>

	<ul>
		{#each rows as row (row.id)}
			<li>
				<span>
					<strong>{row.name}</strong>
					<small>{row.provider}{row.account ? ` · ${row.account}` : ''}</small>
				</span>
				<span class="figures">
					<strong>{money(row.valueUsd)}</strong>
					<small>for {money(row.feeUsd)} fee</small>
				</span>
			</li>
		{/each}
	</ul>

	<p class="total">
		<span>API-priced value</span>
		<strong>{money(totalValue)}</strong>
		<span>pro-rated fees</span>
		<strong>{money(totalFee)}</strong>
	</p>
</section>

<style>
	.pool-subsidy {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
	}
	.head,
	li,
	.total {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.eyebrow,
	h2,
	li,
	.total {
		font-family: var(--font-mono);
	}
	.eyebrow {
		margin: 0;
		color: var(--text-dim);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
	h2 {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.multiple {
		color: var(--accent);
		font-family: var(--font-num);
		font-size: 1.5rem;
	}
	ul {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
	}
	li {
		padding: 0.55rem 0;
		border-top: 1px solid var(--border);
		font-size: 0.76rem;
	}
	li > span {
		display: flex;
		flex-direction: column;
	}
	small {
		color: var(--text-dim);
	}
	.figures {
		text-align: right;
	}
	.figures strong {
		color: var(--accent);
	}
	.total {
		display: grid;
		grid-template-columns: 1fr auto;
		margin: 0.8rem 0 0;
		padding-top: 0.8rem;
		border-top: 1px solid var(--border-strong);
		color: var(--text-muted);
		font-size: 0.72rem;
	}
	.total strong {
		color: var(--text);
		text-align: right;
	}
</style>
