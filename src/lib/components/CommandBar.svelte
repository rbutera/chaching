<script lang="ts">
	// The single sticky scope surface. It absorbs every dashboard scope control
	// that used to live scattered in the controls region — the period switcher,
	// the day navigator, the provider filter pills, and the pool filters — and
	// adds an active-scope chip strip that summarises the current scope, each chip
	// dismissible through the SAME Dashboard method the underlying control uses.
	//
	// It owns NO state of its own: every read and mutation flows through the one
	// Dashboard instance (design decision 6 — no parallel scope store).
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { SyncStatusView } from '$lib/client/sync';
	import type { Period } from '$lib/types';
	import PeriodSwitcher from '$lib/components/PeriodSwitcher.svelte';
	import DayNavigator from '$lib/components/DayNavigator.svelte';
	import PoolFilters from '$lib/components/PoolFilters.svelte';
	import { money, providerLabel, modelLabel, fmtDay } from '$lib/format';

	let {
		feed,
		dash,
		syncStatus
	}: { feed: FeedStore; dash: Dashboard; syncStatus: SyncStatusView | null } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);
	let providerTotals = $derived(snap ? dash.providers(snap) : []);

	const PERIOD_LABEL: Record<Period, string> = {
		day: 'day',
		week: 'week',
		month: 'month',
		quarter: 'quarter',
		all: 'all time'
	};

	// Look up a pool machine / subscription display name for its chip.
	let machineName = $derived((id: string) => syncStatus?.machines.find((m) => m.id === id)?.name ?? id);
	let subscriptionName = $derived(
		(id: string) => syncStatus?.subscriptions.find((s) => s.id === id)?.name ?? id
	);

	// One-action bulk clear (restores the old ControlsRegion "clear filter" buttons).
	// Shown whenever ANY provider/model/pool filter is active; it does NOT touch the
	// pinned day (that keeps its own chip ✕) or the period (not a filter). Delegates to
	// the SAME Dashboard clear methods the scattered controls used — single-owned state.
	let anyFilterActive = $derived(
		dash.providerFilter.size +
			dash.modelFilter.size +
			dash.machineFilter.size +
			dash.subscriptionFilter.size >
			0
	);
	function clearAllFilters(): void {
		dash.clearProviderFilter();
		dash.clearModelFilter();
		dash.clearPoolFilters();
	}
</script>

<!-- REGION 3 → the sticky command bar (dissolved the old controls region). -->
{#if snap}
	<div class="command-bar">
		<div class="controls-row">
			<div class="period-wrap" class:overridden={focusedDay != null}>
				<PeriodSwitcher value={dash.period} onChange={(p) => dash.setPeriod(p)} />
				{#if focusedDay != null}<span class="override-note">overridden by focused day</span>{/if}
			</div>

			<DayNavigator
				{focusedDay}
				earliest={snap.earliestDay}
				latest={snap.latestDay}
				onStep={(d) => dash.stepFocusedDay(snap, d)}
				onJump={(day) => dash.setFocusedDay(snap, day)}
				onClear={() => dash.clearFocusedDay()}
				onEnter={() => snap.latestDay && dash.setFocusedDay(snap, snap.latestDay)}
			/>

			{#if providerTotals.length > 1}
				<div class="pills" aria-label="Provider filter">
					{#each providerTotals as p (p.provider)}
						<button
							class="provider-pill"
							class:active={dash.providerFilter.has(p.provider)}
							aria-pressed={dash.providerFilter.has(p.provider)}
							style={`--provider:var(--p-${p.provider}, var(--m-other))`}
							onclick={() => dash.toggleProvider(p.provider)}
						>
							<span>{providerLabel(p.provider)}</span>
							<span class="num">{money(p.cost)}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if syncStatus?.enabled}
				<PoolFilters
					machines={syncStatus.machines}
					subscriptions={syncStatus.subscriptions}
					machineFilter={dash.machineFilter}
					subscriptionFilter={dash.subscriptionFilter}
					onMachineToggle={(id) => dash.toggleMachine(id)}
					onSubscriptionToggle={(id) => dash.toggleSubscription(id)}
					onClear={() => dash.clearPoolFilters()}
				/>
			{/if}
		</div>

		<!-- Active-scope chips: a single legible summary of what the dashboard is
		     scoped to right now. Each ✕ calls the same Dashboard clear/toggle the
		     scattered controls called, so state stays single-owned. -->
		<div class="scope-chips" aria-label="Active scope">
			<span class="chip chip-period">{PERIOD_LABEL[dash.period]}</span>

			{#if focusedDay != null}
				<span class="chip chip-pin">
					pinned · {fmtDay(focusedDay)}
					<button class="chip-x" aria-label="Clear pinned day" onclick={() => dash.clearFocusedDay()}>✕</button>
				</span>
			{/if}

			{#each [...dash.providerFilter] as provider (provider)}
				<span class="chip chip-provider" style={`--provider:var(--p-${provider}, var(--m-other))`}>
					{providerLabel(provider)}
					<button class="chip-x" aria-label={`Remove ${providerLabel(provider)} provider filter`} onclick={() => dash.toggleProvider(provider)}>✕</button>
				</span>
			{/each}

			{#each [...dash.modelFilter] as model (model)}
				<span class="chip chip-model">
					{modelLabel(model)}
					<button class="chip-x" aria-label={`Remove ${modelLabel(model)} model filter`} onclick={() => dash.toggleModel(model)}>✕</button>
				</span>
			{/each}

			{#each [...dash.machineFilter] as id (id)}
				<span class="chip chip-pool">
					{machineName(id)}
					<button class="chip-x" aria-label={`Remove ${machineName(id)} machine filter`} onclick={() => dash.toggleMachine(id)}>✕</button>
				</span>
			{/each}

			{#each [...dash.subscriptionFilter] as id (id)}
				<span class="chip chip-pool">
					{subscriptionName(id)}
					<button class="chip-x" aria-label={`Remove ${subscriptionName(id)} subscription filter`} onclick={() => dash.toggleSubscription(id)}>✕</button>
				</span>
			{/each}

			{#if anyFilterActive}
				<button
					type="button"
					class="chip chip-clear"
					onclick={clearAllFilters}
					aria-label="Clear all provider, model, and pool filters"
				>
					clear filters <span class="chip-clear-x" aria-hidden="true">✕</span>
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* The bar carries a --bg fade so scrolled content passes cleanly beneath it.
	   The sticky behaviour itself lives on the parent `.slot-cmd` grid item (its
	   containing block is the full-height `.bento` grid, so it actually has scroll
	   travel — see +page.svelte); this element just fills that sticky slot. */
	.command-bar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem 0 0.9rem;
		background: linear-gradient(var(--bg) 82%, transparent);
		/* Structural chrome: a brass hairline under the bar that warms brass→ember
		   with --register-heat (the escalation ladder). It divides the sticky scope
		   surface from the scrolling register below without a heavy rule. */
		border-bottom: 1px solid color-mix(in srgb, var(--chrome-warm) 32%, var(--border));
	}
	.controls-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.period-wrap {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.period-wrap.overridden {
		opacity: 0.7;
	}
	.override-note {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.pills {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.provider-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 34px;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--provider) 45%, var(--border));
		background: color-mix(in srgb, var(--provider) 10%, var(--surface-2));
		color: var(--text-muted);
		padding: 0.35rem 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		transition: background var(--dur-fast) var(--ease-out);
	}
	.provider-pill.active {
		background: color-mix(in srgb, var(--provider) 22%, var(--surface-2));
		color: var(--text);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--provider) 70%, transparent);
	}

	/* Active-scope chip strip. */
	.scope-chips {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 28px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		padding: 0.15rem 0.3rem 0.15rem 0.7rem;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-snug);
	}
	/* The period chip is always-on scope with no clearable state, so it carries no
	   ✕ and reads as a plain label; pad the right edge back to symmetric. */
	.chip-period {
		padding-right: 0.7rem;
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-dim);
	}
	.chip-pin {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
		background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
		color: var(--text);
	}
	.chip-provider {
		border-color: color-mix(in srgb, var(--provider) 45%, var(--border));
		background: color-mix(in srgb, var(--provider) 12%, var(--surface-2));
		color: var(--text);
	}
	.chip-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		min-height: 20px;
		border-radius: var(--radius-pill);
		background: transparent;
		border: 0;
		color: var(--text-muted);
		font-size: 0.72rem;
		line-height: 1;
		padding: 0;
		cursor: pointer;
	}
	.chip-x:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 12%, transparent);
	}
	.chip-x:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* One-action bulk clear — reads as an action, not a scope label; sits after the
	   chips it dismisses. Full-height chip so it lines up with the strip. */
	.chip-clear {
		gap: 0.35rem;
		padding-left: 0.7rem;
		padding-right: 0.7rem;
		cursor: pointer;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
	.chip-clear:hover {
		color: var(--text);
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text) 8%, var(--surface-2));
	}
	.chip-clear:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.chip-clear-x {
		font-size: 0.72rem;
		line-height: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.provider-pill {
			transition: none;
		}
	}
</style>
