<script lang="ts" module>
	import MoneyOdometer from './MoneyOdometer.svelte';
	import { BLOCK_FLOURISHES, DAILY_FLOURISHES, LIFETIME_FLOURISHES, tierIndex } from '@chaching/shared/voice/index';

	export type SpendContext = 'block' | 'daily' | 'lifetime';

	export interface SpendMeterProps {
		amount: number;
		/** Which escalation ladder to read: 5h block, day, or lifetime. */
		context?: SpendContext;
		/** Gauge ceiling (defaults to the ladder's top threshold). */
		max?: number;
		/** Optional uppercase-mono caption under the gauge. */
		label?: string;
		/** Show the escalation emoji. Default true. */
		showEmoji?: boolean;
		suppressArt?: boolean;
		reducedMotion?: boolean;
	}

	const LADDERS = { block: BLOCK_FLOURISHES, daily: DAILY_FLOURISHES, lifetime: LIFETIME_FLOURISHES };

	// calm → warm → hot → alarm, by how high up the ladder we are.
	const TIER_COLORS = [
		'var(--spend-calm)',
		'var(--spend-warm)',
		'var(--spend-hot)',
		'var(--spend-alarm)'
	] satisfies string[];
</script>

<script lang="ts">
	// chaching SpendMeter — the signature delight: a spend amount with an
	// affectionate escalation flourish (emoji + remark) and a proportional gauge
	// tinted calm→warm→hot→alarm. `context` picks the ladder; `max` sizes the
	// gauge; `showEmoji=false` hides the emoji. The gauge fill is decorative.
	let {
		amount = 0,
		context = 'block',
		max,
		label,
		showEmoji = true,
		suppressArt = false,
		reducedMotion = false
	}: SpendMeterProps = $props();

	const ladder = $derived(LADDERS[context] ?? LADDERS.block);

	const idx = $derived(tierIndex(amount, ladder));
	const tier = $derived(ladder[idx]);
	const color = $derived(
		TIER_COLORS[
			Math.min(TIER_COLORS.length - 1, Math.floor((idx / (ladder.length - 1)) * TIER_COLORS.length))
		] || TIER_COLORS[0]
	);
	const ceiling = $derived(max ?? ladder[ladder.length - 1].threshold);
	const frac = $derived(Math.max(0.03, Math.min(1, amount / ceiling)));
</script>

<div class="spendmeter" class:still={reducedMotion || suppressArt}>
	<div class="row">
		<MoneyOdometer {amount} size="md" tone="default" reducedMotion={reducedMotion || suppressArt} />
		{#if tier.remark && !suppressArt}
			<span class="remark">
				{#if showEmoji && tier.emoji}<span class="emoji">{tier.emoji}</span>{/if}{tier.remark}
			</span>
		{/if}
	</div>
	<div class="gauge" aria-hidden="true">
		<div class="fill" style:width={`${frac * 100}%`} style:--tier-c={color}></div>
	</div>
	{#if label}<span class="caption">{label}</span>{/if}
</div>

<style>
	.spendmeter {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.remark {
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		color: var(--text-muted);
		white-space: nowrap;
	}
	.emoji {
		margin-right: 6px;
	}
	.gauge {
		height: 8px;
		border-radius: var(--radius-pill);
		background: var(--surface-3);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--tier-c) 55%, var(--surface-3)),
			var(--tier-c)
		);
	}
	.caption {
		font-family: var(--font-sans);
		font-size: var(--text-2xs);
		font-weight: var(--fw-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-dim);
	}

	@media (prefers-reduced-motion: no-preference) {
		.fill {
			transition: width var(--dur-slow) var(--ease-snap);
		}
	}
	.still .fill { transition: none; }
</style>
