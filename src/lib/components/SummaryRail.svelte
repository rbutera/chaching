<script lang="ts">
	// The persistent summary rail: the dashboard's money readout, kept in view on
	// desktop widths while the detail regions scroll past. It reads the SAME scoped
	// totals the hero shows (focused-day total when a day is pinned, else the
	// rolling-period total) plus the all-time figure — all off the one Dashboard
	// instance, no state of its own. On desktop it is a sticky left column; on
	// narrow widths it collapses into a compact strip at the top of the stack.
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import MoneyFigure from '$lib/components/ds/MoneyFigure.svelte';
	import { fmtDay, providerLabel } from '$lib/format';
	import type { Period } from '$lib/types';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	const PERIOD_LABEL: Record<Period, string> = {
		day: 'today',
		week: 'this week',
		month: 'this month',
		quarter: 'this quarter',
		all: 'all time'
	};

	let hero = $derived(snap ? dash.heroTotals(snap) : null);
	let focusedTotals = $derived(snap && focusedDay ? dash.focusedTotals(snap, focusedDay) : null);
	let scopedCost = $derived(focusedTotals ? focusedTotals.cost : (hero?.current.cost ?? 0));
	let scopeLabel = $derived(focusedDay ? fmtDay(focusedDay) : PERIOD_LABEL[dash.period]);
	// All-time banked spend — the whole account, never scoped (matches the page's
	// lifetime ladder source).
	let lifetimeCost = $derived(snap?.totals.cost ?? 0);
</script>

{#if snap}
	<aside class="summary-rail" aria-label="Spend summary">
		<p class="rail-label">spend · {scopeLabel}</p>
		<div class="rail-figure">
			<MoneyFigure amount={scopedCost} size="lg" tone="gold" />
		</div>
		{#if dash.providerFilter.size > 0}
			<p class="rail-scope">{[...dash.providerFilter].map(providerLabel).join(', ')}</p>
		{/if}
		<dl class="rail-meta">
			<div class="rail-meta-row">
				<dt>all time</dt>
				<dd><MoneyFigure amount={lifetimeCost} size="sm" /></dd>
			</div>
		</dl>
	</aside>
{/if}

<style>
	.summary-rail {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.1rem 1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-1);
	}
	.rail-label {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-dim);
	}
	.rail-figure {
		display: flex;
		align-items: baseline;
	}
	.rail-scope {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--accent);
	}
	.rail-meta {
		margin: 0.4rem 0 0;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border-faint);
	}
	.rail-meta-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.rail-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		color: var(--text-dim);
	}
	.rail-meta dd {
		margin: 0;
		color: var(--text-muted);
	}
</style>
