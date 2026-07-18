<script lang="ts">
	// REGION · COUNTERFACTUAL LAB (task 3.1). Reprices the dashboard's current window
	// under a different basis and shows it side-by-side against the real bill. Pricing
	// RESOLUTION is server-only, so this component never builds scenarios: it derives
	// the window + target from the snapshot it already has and asks GET /api/whatif to
	// reprice (design decision 6 — the endpoint returns the SAME ScenarioResult[] the
	// CLI `whatif` renders, so the two surfaces agree for the same window). Every figure
	// is a price-only counterfactual (bounds, not promises); a null total renders
	// "unavailable" and unknown-priced usage is surfaced as an exclusion — never a
	// fabricated $0 (cost-honesty hard rule).
	import { resolve } from '$app/paths';
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import type { ScenarioResult } from '$lib/core/whatif/types';
	import { PRICE_ONLY_COUNTERFACTUAL } from '$lib/core/whatif/types';
	import { altModelTargets, defaultAltTarget } from '$lib/core/whatif/targets';
	import { money } from '$lib/format';

	let {
		feed,
		dash,
		reducedMotion = false
	}: { feed: FeedStore; dash: Dashboard; reducedMotion?: boolean } = $props();

	let snap = $derived(feed.snapshot);

	// Window primitives (not the object) so the fetch effect fires only when the
	// window actually MOVES, not on every SSE delta that recomputes an equal window.
	let win = $derived(snap ? dash.periodWindow(snap) : null);
	let from = $derived(win?.from ?? null);
	let to = $derived(win?.to ?? null);
	let windowLabel = $derived(win?.label ?? '');

	// Models present in the current window (cost-desc) → the alt-model target menu.
	let modelsPresent = $derived(snap ? dash.models(snap).map((m) => m.model) : []);
	let targetOptions = $derived(altModelTargets(modelsPresent));

	// null = "auto" (follow the window's default). A user pick pins an explicit target.
	let picked = $state<string | null>(null);
	let effectiveTarget = $derived(picked ?? defaultAltTarget(modelsPresent));

	// Fetched scenario ledger for the current (window, target).
	let results = $state<ScenarioResult[]>([]);
	let actualUsd = $state<number | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	// The query the current `results` belong to — drops out-of-order responses.
	let liveKey = '';

	$effect(() => {
		if (!from || !to) return;
		const target = effectiveTarget;
		const key = `${from}|${to}|${target ?? ''}`;
		liveKey = key;
		loading = true;
		failed = false;
		const params = new URLSearchParams({ from, to });
		if (target) params.set('model', target);
		fetch(`${resolve('/api/whatif')}?${params.toString()}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((data: { results?: ScenarioResult[]; actual?: { costUsd?: number } }) => {
				if (liveKey !== key) return; // a newer request won
				results = Array.isArray(data?.results) ? data.results : [];
				actualUsd = typeof data?.actual?.costUsd === 'number' ? data.actual.costUsd : null;
				loading = false;
			})
			.catch(() => {
				if (liveKey !== key) return;
				failed = true;
				loading = false;
			});
	});

	// Window-frame scenarios (alt-model, no-cache) rank against the window bill; plan-fit
	// is a DIFFERENT (monthly-normalized) frame and renders in its own block — never
	// mixed into the same comparison.
	let windowScenarios = $derived(results.filter((r) => r.kind !== 'plan-fit'));
	let planFits = $derived(results.filter((r) => r.kind === 'plan-fit'));

	function signed(v: number): string {
		if (v > 0) return `+${money(v)}`;
		if (v < 0) return `-${money(-v)}`;
		return money(0);
	}
	/** Bar width % of a value against the larger of (actual, counterfactual). */
	function pct(value: number, actual: number, total: number): number {
		const max = Math.max(actual, total, 0);
		if (max <= 0) return 0;
		return Math.max(2, Math.min(100, (value / max) * 100));
	}
	/** Non-label notes (the price-only label shows once as the region caption). */
	function detailNotes(r: ScenarioResult): string[] {
		return r.notes.filter((n) => n !== PRICE_ONLY_COUNTERFACTUAL);
	}
	function exclusionText(r: ScenarioResult): string | null {
		const ex = r.exclusions;
		if (ex.modelCount === 0) return null;
		const amount = ex.spendUsd == null ? 'spend unknown' : `${money(ex.spendUsd)}`;
		return `${ex.modelCount} model(s) excluded · ${amount}`;
	}
</script>

<!-- REGION · COUNTERFACTUAL LAB -->
{#if snap}
	<section class="whatif panel" aria-label="Counterfactual lab">
		<div class="whatif-head">
			<h2 class="panel-title"><span>counterfactual lab</span></h2>
			<p class="caption">{PRICE_ONLY_COUNTERFACTUAL}</p>
		</div>

		<div class="anchor">
			<span class="anchor-label">You actually billed · {windowLabel}</span>
			<span class="anchor-figure">{actualUsd == null ? '—' : money(actualUsd)}</span>
		</div>

		<div class="picker">
			<label for="whatif-target">Reprice everything at</label>
			<select
				id="whatif-target"
				value={effectiveTarget ?? ''}
				onchange={(e) => (picked = (e.currentTarget as HTMLSelectElement).value || null)}
			>
				{#each targetOptions as opt (opt)}
					<option value={opt}>{opt}</option>
				{/each}
			</select>
		</div>

		{#if failed}
			<p class="state">Couldn't load the counterfactual right now.</p>
		{:else if loading && results.length === 0}
			<p class="state">Repricing…</p>
		{:else if windowScenarios.length === 0}
			<p class="state">No repriceable usage in this window.</p>
		{:else}
			<ul class="scenarios">
				{#each windowScenarios as r (r.id)}
					<li class="scenario" class:unavailable={r.totalUsd == null}>
						<div class="scenario-head">
							<span class="scenario-label">{r.label}</span>
							{#if r.totalUsd != null && r.deltaUsd != null}
								<span class="delta" class:cheaper={r.deltaUsd < 0} class:dearer={r.deltaUsd > 0}>
									{signed(r.deltaUsd)} vs actual
								</span>
							{:else}
								<span class="delta unavailable-tag">unavailable</span>
							{/if}
						</div>

						{#if r.totalUsd != null && r.actualUsd != null}
							<div class="bars" class:motion={!reducedMotion}>
								<div class="bar-row">
									<span class="bar-key">actual</span>
									<span class="bar-track"
										><span class="bar bar-actual" style:width="{pct(r.actualUsd, r.actualUsd, r.totalUsd)}%"
										></span></span
									>
									<span class="bar-val">{money(r.actualUsd)}</span>
								</div>
								<div class="bar-row">
									<span class="bar-key">would have billed</span>
									<span class="bar-track"
										><span
											class="bar bar-alt"
											class:cheaper={r.deltaUsd != null && r.deltaUsd < 0}
											style:width="{pct(r.totalUsd, r.actualUsd, r.totalUsd)}%"
										></span></span
									>
									<span class="bar-val">{money(r.totalUsd)}</span>
								</div>
							</div>
						{/if}

						<p class="basis">{r.basis}</p>
						{#if exclusionText(r)}
							<p class="excl">{exclusionText(r)}</p>
						{/if}
						{#each detailNotes(r) as note, i (i)}
							{#if note !== r.basis}
								<p class="note">{note}</p>
							{/if}
						{/each}
					</li>
				{/each}
			</ul>
		{/if}

		{#if planFits.length > 0}
			<div class="planfit">
				<h3 class="sub-title">subscription plan-fit</h3>
				<p class="planfit-frame">Monthly-normalized — a different frame to the window totals above.</p>
				<ul class="scenarios">
					{#each planFits as r (r.id)}
						<li class="scenario" class:unavailable={r.totalUsd == null}>
							<div class="scenario-head">
								<span class="scenario-label">{r.label}</span>
								{#if r.totalUsd != null && r.deltaUsd != null}
									<span class="delta" class:cheaper={r.deltaUsd < 0} class:dearer={r.deltaUsd > 0}>
										{r.deltaUsd < 0 ? `saves ${money(-r.deltaUsd)}/mo` : `${money(r.deltaUsd)}/mo more`}
									</span>
								{:else}
									<span class="delta unavailable-tag">unavailable</span>
								{/if}
							</div>
							{#if r.totalUsd != null}
								<p class="planfit-total">{money(r.totalUsd)}/mo</p>
							{/if}
							<p class="basis">{r.basis}</p>
							{#if exclusionText(r)}
								<p class="excl">{exclusionText(r)}</p>
							{/if}
							{#each detailNotes(r) as note, i (i)}
								{#if note !== r.basis}
									<p class="note">{note}</p>
								{/if}
							{/each}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
{/if}

<style>
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
		margin-bottom: 1rem;
	}
	.panel-title {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
	}
	.caption {
		margin: 0.45rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		line-height: 1.5;
		color: var(--text-dim);
	}
	.anchor {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
		margin: 0.9rem 0 0.4rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid var(--border-faint);
	}
	.anchor-label {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.anchor-figure {
		font-family: var(--font-num);
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--text);
	}
	.picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.7rem 0 0.9rem;
		flex-wrap: wrap;
	}
	.picker label {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.picker select {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		padding: 0.35rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.76rem;
	}
	.state {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-dim);
		padding: 1rem 0;
		text-align: center;
	}
	.scenarios {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.scenario {
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-sm);
		padding: 0.75rem 0.85rem;
		background: var(--surface-2);
	}
	.scenario.unavailable {
		opacity: 0.72;
	}
	.scenario-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
	}
	.scenario-label {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text);
	}
	.delta {
		font-family: var(--font-num);
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-muted);
	}
	.delta.cheaper {
		color: var(--good);
	}
	.delta.dearer {
		color: var(--bad);
	}
	.unavailable-tag {
		color: var(--text-dim);
		font-weight: 500;
		text-transform: uppercase;
		font-size: 0.68rem;
		letter-spacing: 0.05em;
	}
	.bars {
		margin: 0.7rem 0 0.55rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.bar-row {
		display: grid;
		grid-template-columns: 8.5rem 1fr auto;
		align-items: center;
		gap: 0.55rem;
	}
	.bar-key {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
		text-align: right;
	}
	.bar-track {
		display: block;
		height: 0.5rem;
		background: var(--surface-3);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.bar {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--text-dim);
	}
	.bar-actual {
		background: var(--accent);
	}
	.bar-alt {
		background: var(--bad);
	}
	.bar-alt.cheaper {
		background: var(--good);
	}
	.motion .bar {
		transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.bar-val {
		font-family: var(--font-num);
		font-size: 0.74rem;
		color: var(--text-muted);
		text-align: right;
	}
	.basis {
		margin: 0.35rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-muted);
	}
	.excl {
		margin: 0.3rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--warn);
	}
	.note {
		margin: 0.3rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		line-height: 1.5;
		color: var(--text-dim);
	}
	.planfit {
		margin-top: 1.1rem;
		padding-top: 0.85rem;
		border-top: 1px solid var(--border-faint);
	}
	.sub-title {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
	}
	.planfit-frame {
		margin: 0.35rem 0 0.7rem;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
	}
	.planfit-total {
		margin: 0.45rem 0 0;
		font-family: var(--font-num);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}
</style>
