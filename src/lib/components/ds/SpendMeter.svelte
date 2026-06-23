<script lang="ts" module>
	import MoneyFigure from './MoneyFigure.svelte';

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
	}

	interface Rung {
		t: number;
		emoji: string;
		remark: string;
	}

	// The escalation ladders, verbatim from the design reference (mirrors the
	// product's personality module).
	const LADDERS = {
		block: [
			{ t: 0, emoji: '', remark: '' },
			{ t: 10, emoji: '💸', remark: 'warming up' },
			{ t: 30, emoji: '💸💸', remark: 'getting spicy' },
			{ t: 75, emoji: '🔥', remark: 'full send' },
			{ t: 120, emoji: '🔥🔥', remark: 'please take a break' },
			{ t: 200, emoji: '🚨', remark: 'the register is on fire' }
		],
		daily: [
			{ t: 0, emoji: '', remark: '' },
			{ t: 20, emoji: '💰', remark: 'decent day' },
			{ t: 50, emoji: '💸', remark: 'treating yourself' },
			{ t: 100, emoji: '💸💸', remark: 'big day' },
			{ t: 200, emoji: '🔥', remark: 'account on fire' },
			{ t: 500, emoji: '🚨🚨', remark: 'send help' }
		],
		lifetime: [
			{ t: 0, emoji: '', remark: '' },
			{ t: 100, emoji: '💰', remark: "you've committed" },
			{ t: 500, emoji: '💸', remark: 'well into it now' },
			{ t: 1000, emoji: '🔥', remark: 'you live here now' },
			{ t: 5000, emoji: '🚨', remark: 'write a blog post' }
		]
	} satisfies Record<SpendContext, Rung[]>;

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
		showEmoji = true
	}: SpendMeterProps = $props();

	const ladder = $derived(LADDERS[context] ?? LADDERS.block);

	const idx = $derived.by(() => {
		let i = 0;
		for (let j = 0; j < ladder.length; j++) if (amount >= ladder[j].t) i = j;
		return i;
	});
	const tier = $derived(ladder[idx]);
	const color = $derived(
		TIER_COLORS[
			Math.min(TIER_COLORS.length - 1, Math.floor((idx / (ladder.length - 1)) * TIER_COLORS.length))
		] || TIER_COLORS[0]
	);
	const ceiling = $derived(max ?? ladder[ladder.length - 1].t);
	const frac = $derived(Math.max(0.03, Math.min(1, amount / ceiling)));
</script>

<div class="spendmeter">
	<div class="row">
		<MoneyFigure {amount} size="md" tone="default" />
		{#if tier.remark}
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
		font-family: var(--font-mono);
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
		font-family: var(--font-mono);
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
</style>
