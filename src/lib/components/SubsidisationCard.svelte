<script lang="ts">
	// SubsidisationCard — "how much API value did my flat fee buy me" over the
	// SELECTED WINDOW. Follows the period selector / pinned day: the burn in the
	// window is compared against the fee pro-rated to it from a monthlyUsd/30 daily
	// rate (day = fee/30, week = ×7, month = the full fee, quarter = ×90). The
	// receipt footer and `chaching wrapped` keep the calendar-month basis. $0-tier
	// renders "∞ — all of it". Brass-accent headline.
	//
	// Owns the per-provider tier switcher (a preset <select> + a Custom number input
	// shown only for Custom), controlled off the publicConfig the page holds. On
	// change it emits `onTierChange`, which the page POSTs to /api/config.
	import { money } from '$lib/format';
	import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '$lib/core/subscription-presets';
	import type {
		BurnPace,
		SubsidisedProvider,
		WindowSubsidisationRollup
	} from '$lib/core/subsidisation';

	let {
		rollup,
		windowLabel,
		config,
		onTierChange,
		burnPace = null
	}: {
		rollup: WindowSubsidisationRollup;
		/** the human window label the page already renders (e.g. "Last 7 days", a pinned day) */
		windowLabel: string;
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
		if (multiple === 0) return '0× — nothing used yet';
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
			<p class="basis">
				{windowLabel} · vs {money(rollup.combined.windowFeeUsd)}
				({rollup.windowDays === 30
					? 'your monthly fee'
					: `${rollup.windowDays} ${rollup.windowDays === 1 ? 'day' : 'days'} of fee at 1/30 per day`})
			</p>
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
			{fmtMultiple(rollup.combined.sub.multiple)}
		</span>
		<p class="headline-sub">
			<span class="num">{money(rollup.combined.sub.apiEquivalentUsd)}</span> of API value for
			<span class="num">{money(rollup.combined.windowFeeUsd)}</span>
		</p>
		<p class="headline-net">
			{#if rollup.combined.sub.netSubsidyUsd >= 0}
				<span class="net-pos">net subsidy +{money(rollup.combined.sub.netSubsidyUsd)}</span>
			{:else}
				<span class="net-dim">net {money(rollup.combined.sub.netSubsidyUsd)} vs the pro-rated fee</span>
			{/if}
		</p>
	</div>

	<!-- PER-PROVIDER ROWS + TIER SWITCHER -->
	<ul class="providers">
		{#each enabledProviders as p (p.provider)}
			{@const label = PROVIDER_LABEL[p.provider]}
			<li class="prov">
				<div class="prov-top">
					<span class="prov-name">{label}</span>
					<span class="prov-mult num">{fmtMultiple(p.sub.multiple)}</span>
				</div>
				<div class="prov-detail">
					<span class="num">{money(p.sub.apiEquivalentUsd)}</span> value ·
					{#if p.sub.netSubsidyUsd >= 0}
						<span class="net-pos">+{money(p.sub.netSubsidyUsd)} subsidy</span>
					{:else}
						<span class="net-dim">net {money(p.sub.netSubsidyUsd)} vs {money(p.windowFeeUsd)} pro-rated</span>
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
	.net-dim {
		color: var(--text-dim);
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
