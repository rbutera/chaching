<script lang="ts">
	// SubsidisationCard — the headline "how much API value did my flat fee buy me
	// this month" framing. Always month-basis (does NOT follow the dashboard period
	// selector): month-to-date burn vs the full monthly fee, plus a labelled
	// projected figure. Per-provider + combined, $0-tier ("∞ — all of it") and
	// negative-subsidy ("under-using your plan") states. Brass-accent headline.
	//
	// Owns the per-provider tier switcher (a preset <select> + a Custom number input
	// shown only for Custom), controlled off the publicConfig the page holds. On
	// change it emits `onTierChange`, which the page POSTs to /api/config.
	import { money } from '$lib/format';
	import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '$lib/core/config';
	import type {
		BurnPace,
		ProviderSubsidisation,
		SubsidisationRollup,
		SubsidisedProvider
	} from '$lib/core/subsidisation';

	let {
		rollup,
		config,
		onTierChange,
		burnPace = null
	}: {
		rollup: SubsidisationRollup;
		/** the current persisted tier/fee per provider (from publicConfig) */
		config: Record<SubsidisedProvider, { enabled: boolean; tier: string; monthlyUsd: number }>;
		/** commit a tier change for one provider; the page persists via /api/config */
		onTierChange: (provider: SubsidisedProvider, tier: string, monthlyUsd: number) => void;
		/** whole-account month-to-date burn-pace projection; null suppresses the line (cost-honesty guards) */
		burnPace?: BurnPace | null;
	} = $props();

	const PROVIDER_LABEL: Record<SubsidisedProvider, string> = {
		claude: 'Claude',
		codex: 'Codex'
	};

	/** Render a multiple as "97×" / "1.4×" / "∞ — all of it" / "0× — nothing yet". */
	function fmtMultiple(multiple: number | null): string {
		if (multiple == null) return '∞ — all of it';
		if (multiple === 0) return '0× — nothing used yet this month';
		return multiple >= 100 ? `${Math.round(multiple)}×` : `${multiple.toFixed(1)}×`;
	}

	let enabledProviders = $derived(rollup.providers.filter((p) => p.enabled));

	function presetsFor(provider: SubsidisedProvider): SubscriptionPreset[] {
		return SUBSCRIPTION_PRESETS[provider];
	}

	function onSelect(provider: SubsidisedProvider, value: string): void {
		if (value === 'custom') {
			// Keep the current amount as the seed for the Custom field.
			onTierChange(provider, 'custom', config[provider].monthlyUsd);
			return;
		}
		const preset = presetsFor(provider).find((p) => p.id === value);
		if (preset) onTierChange(provider, preset.id, preset.monthlyUsd);
	}

	function onCustomAmount(provider: SubsidisedProvider, raw: string): void {
		const n = Number(raw);
		const monthlyUsd = Number.isFinite(n) && n >= 0 ? n : 0;
		onTierChange(provider, 'custom', monthlyUsd);
	}
</script>

<section class="subsidy" aria-labelledby="subsidy-heading">
	<div class="head">
		<div>
			<h2 id="subsidy-heading" class="title">Subscription subsidy</h2>
			<p class="basis">this month so far · vs your flat monthly fee</p>
			{#if burnPace}
				<p class="pace">
					on pace for ~<span class="num">{money(burnPace.projectedCost)}</span> this month
				</p>
			{/if}
		</div>
	</div>

	<!-- COMBINED HEADLINE -->
	<div class="headline">
		<span class="multiple num" aria-label="combined subsidy multiple">
			{fmtMultiple(rollup.combined.mtd.multiple)}
		</span>
		<p class="headline-sub">
			<span class="num">{money(rollup.combined.mtd.apiEquivalentUsd)}</span> of API value for
			<span class="num">{money(rollup.combined.monthlyUsd)}</span>
		</p>
		<p class="headline-net">
			{#if rollup.combined.mtd.netSubsidyUsd >= 0}
				<span class="net-pos">net subsidy +{money(rollup.combined.mtd.netSubsidyUsd)}</span>
			{:else}
				<span class="net-neg">under-using your plan · {money(rollup.combined.mtd.netSubsidyUsd)}</span>
			{/if}
			<span class="projected">
				· projected <span class="num">{fmtMultiple(rollup.combined.projected.multiple)}</span>
			</span>
		</p>
	</div>

	<!-- PER-PROVIDER ROWS + TIER SWITCHER -->
	<ul class="providers">
		{#each enabledProviders as p (p.provider)}
			{@const label = PROVIDER_LABEL[p.provider]}
			<li class="prov">
				<div class="prov-top">
					<span class="prov-name">{label}</span>
					<span class="prov-mult num">{fmtMultiple(p.mtd.multiple)}</span>
				</div>
				<div class="prov-detail">
					<span class="num">{money(p.mtd.apiEquivalentUsd)}</span> value ·
					{#if p.mtd.netSubsidyUsd >= 0}
						<span class="net-pos">+{money(p.mtd.netSubsidyUsd)} subsidy</span>
					{:else}
						<span class="net-neg">{money(p.mtd.netSubsidyUsd)} (under-using)</span>
					{/if}
				</div>
				<div class="switcher">
					<label class="sw-label" for={`tier-${p.provider}`}>{label} plan</label>
					<select
						id={`tier-${p.provider}`}
						class="sw-select"
						value={config[p.provider].tier}
						onchange={(e) => onSelect(p.provider, (e.currentTarget as HTMLSelectElement).value)}
					>
						{#each presetsFor(p.provider) as preset (preset.id)}
							<option value={preset.id}>
								{preset.label}{preset.custom ? '' : ` · ${money(preset.monthlyUsd)}`}
							</option>
						{/each}
					</select>
					{#if config[p.provider].tier === 'custom'}
						<span class="sw-custom-label">
							<span class="dollar" aria-hidden="true">$</span>
							<input
								class="sw-custom num"
								type="number"
								min="0"
								step="1"
								inputmode="decimal"
								aria-label={`${label} custom monthly fee in USD`}
								value={config[p.provider].monthlyUsd}
								onchange={(e) => onCustomAmount(p.provider, (e.currentTarget as HTMLInputElement).value)}
							/>
							<span class="per">/mo</span>
						</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</section>

<style>
	.subsidy {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		box-shadow: var(--shadow);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.title {
		font-size: 0.82rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin: 0;
	}
	.basis {
		font-size: 0.72rem;
		color: var(--fg-dim);
		margin: 0.15rem 0 0;
	}
	.pace {
		font-size: 0.72rem;
		color: var(--fg-muted);
		margin: 0.1rem 0 0;
	}
	.headline {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.4rem 0 0.6rem;
		border-bottom: 1px dashed var(--border);
	}
	.multiple {
		font-size: 2.4rem;
		font-weight: 700;
		line-height: 1;
		color: var(--accent);
		letter-spacing: -0.01em;
	}
	.headline-sub {
		font-size: 0.86rem;
		color: var(--fg);
		margin: 0.1rem 0 0;
	}
	.headline-net {
		font-size: 0.76rem;
		color: var(--fg-muted);
		margin: 0;
	}
	.net-pos {
		color: var(--good);
	}
	.net-neg {
		color: var(--warn);
	}
	.projected {
		color: var(--fg-dim);
	}
	.providers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.prov {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.prov-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.prov-name {
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--fg);
	}
	.prov-mult {
		font-size: 1rem;
		font-weight: 650;
		color: var(--accent);
	}
	.prov-detail {
		font-size: 0.74rem;
		color: var(--fg-muted);
	}
	.switcher {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.15rem;
	}
	.sw-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-dim);
	}
	.sw-select {
		background: var(--surface-2);
		color: var(--fg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
	}
	.sw-select:focus-visible,
	.sw-custom:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.sw-custom-label {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.2rem 0.45rem;
	}
	.dollar,
	.per {
		font-size: 0.78rem;
		color: var(--fg-dim);
	}
	.sw-custom {
		width: 5.5ch;
		background: transparent;
		border: none;
		color: var(--fg);
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		font-family: var(--font-num);
	}
	.sw-custom:focus {
		outline: none;
	}
</style>
