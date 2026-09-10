<script lang="ts">
	// SubsidisationCard — "how much API value did my flat fee buy me" over the
	// SELECTED WINDOW. Follows the period selector / pinned day: the burn in the
	// window is compared against the fee pro-rated to it from a monthlyUsd/30 daily
	// rate (day = fee/30, week = ×7, month = the full fee, quarter = ×90). The
	// receipt footer and `chaching wrapped` keep the calendar-month basis. $0-tier
	// renders "∞ — all of it". Brass-accent headline.
	import { money } from '$lib/format';
	import type {
		BurnPace,
		SubsidisedProvider,
		WindowSubsidisationRollup
	} from '$lib/core/subsidisation';

	let {
		rollup,
		windowLabel,
		burnPace = null
	}: {
		rollup: WindowSubsidisationRollup;
		/** the human window label the page already renders (e.g. "Last 7 days", a pinned day) */
		windowLabel: string;
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
</style>
