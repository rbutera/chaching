<script lang="ts">
	import type { FeedStore } from '../../client/feed.svelte';
	import type { Dashboard } from '../../client/dashboard.svelte';
	import MoneyOdometer from '../ds/MoneyOdometer.svelte';
	import Sparkline from '../ds/Sparkline.svelte';
	import { money, pctDelta, modelLabel, providerLabel, fmtDay } from '@chaching/shared/format';
	import type { PeriodBucket } from '@chaching/shared/aggregate';
	import { flourishFor, formatFlourishText, DAILY_FLOURISHES } from '@chaching/shared/voice/index';
	import { trailingThrottle } from '../../client/motion';
	import { coverageWord, coverageGlyph } from '@chaching/shared/coverage-marks';

	// Regions receive `{ feed, dash }` as props (no Svelte context). `reducedMotion`
	// and `suppressArt` are page-level cross-cutting flags (shared with joy + loading
	// copy) threaded down explicitly — still props, never context.
	let {
		feed,
		dash,
		reducedMotion,
		suppressArt
	}: { feed: FeedStore; dash: Dashboard; reducedMotion: boolean; suppressArt: boolean } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// hero — focused-day totals when pinned, else the rolling-period totals + delta.
	let hero = $derived(snap ? dash.heroTotals(snap) : null);
	let focusedTotals = $derived(snap && focusedDay ? dash.focusedTotals(snap, focusedDay) : null);
	// suppress the period delta when there's no prior baseline (prior window
	// predates our earliest data) vs a real $0 prior. No delta in focused mode (single day).
	let heroDelta = $derived(
		!focusedDay && hero ? pctDelta(hero.current.cost, hero.prior.cost, hero.priorHasBaseline) : null
	);
	let heroCost = $derived(focusedTotals ? focusedTotals.cost : (hero?.current.cost ?? 0));
	let heroLabel = $derived(focusedDay ? fmtDay(focusedDay) : (hero?.label ?? '—'));

	// A pinned day
	// that is a gap (`missing`) or still landing (`partial`) must NOT be headlined as
	// a dollar figure — `focusedTotals.cost` is 0/incomplete for those, so rolling it
	// on the odometer would fabricate a final "$0.00". For a single-day window the
	// coverage summary's `worst` IS that day's class, so we render the SAME coverage
	// vocabulary (`coverageWord`/`coverageGlyph`) in the figure slot instead of money.
	// A genuine `zero` day (frozen, real quiet day) still shows $0.00, a `frozen` day
	// its real total, and period scope always shows money. Delta suppression is
	// unchanged (`heroDelta` is already null in focused mode).
	let pinnedMark = $derived.by(() => {
		if (!focusedDay || !focusedTotals) return null;
		const worst = focusedTotals.coverage.worst;
		if (worst === 'missing' || worst === 'partial') {
			return { state: worst, word: coverageWord(worst), glyph: coverageGlyph(worst) };
		}
		return null;
	});

	// Hero odometer feed: the figure is rendered by MoneyOdometer (NumberFlow), which
	// owns the roll animation and the reduced-motion gate. We only decide HOW OFTEN it
	// receives a new value — a chatty SSE feed must not hand it a new target every
	// delta or the columns thrash. So live deltas pass through the SAME rate-limited
	// trailing throttle the count-up used (~900ms window, coalesce-to-latest); the
	// leading edge fires the first value immediately, so on first paint NumberFlow
	// rolls 0 → the initial total. Under reduced motion the window collapses to 0
	// (every push immediate) and NumberFlow itself renders without a roll.
	//
	// The throttle CADENCE is unchanged from the pre-odometer hero; only the per-tick
	// action changed (a plain assignment now, NumberFlow does the animating).
	let displayCost = $state(0);
	let tickThrottle = $derived(
		trailingThrottle<number>(reducedMotion ? 0 : 900, (target) => (displayCost = target))
	);
	$effect(() => {
		tickThrottle.push(heroCost);
	});
	$effect(() => () => tickThrottle.cancel());

	// trend buckets (always full rolling window — the navigation surface)
	let trend = $derived<PeriodBucket[]>(snap ? dash.trend(snap) : []);
	let heroSpark = $derived(trend.map((b) => b.cost));

	// Escalation flourish — the affectionate daily ladder keyed off the scoped hero cost
	// (design D6), sourced from the SHARED voice module so web/TUI/receipt speak one
	// ladder. Shown only in day / focused-day scope: a "🚨 on fire" against an all-time
	// total is meaningless (resolves the design.md open question — scope-gate rather
	// than per-period rescale). Emoji are the severity encoding (data, not decor).
	let flourish = $derived.by(() => {
		// Web suppression (D9): no personality copy when no-art is in effect.
		if (suppressArt) return '';
		// only meaningful at a single-day grain: a pinned day, or the rolling "day" period.
		const dayScoped = focusedDay != null || dash.period === 'day';
		if (!dayScoped) return '';
		return formatFlourishText(flourishFor(heroCost, DAILY_FLOURISHES));
	});
</script>

<!-- REGION 2 · HERO -->
<section class="hero" aria-label="Current period spend">
	<div class="hero-left">
		<p class="hero-label">
			spend · {heroLabel}
			{#if focusedDay}<span class="scope">· pinned day</span>{/if}
			{#if dash.providerFilter.size > 0}<span class="scope">· {[...dash.providerFilter].map(providerLabel).join(', ')}</span>{/if}
			{#if dash.modelFilter.size > 0}<span class="scope">· {[...dash.modelFilter].map(modelLabel).join(', ')}</span>{/if}
		</p>
		<div class="hero-figure">
			{#if pinnedMark}
				<!-- Honest coverage mark instead of a fabricated $0.00 headline for a gap/partial pinned day. -->
				<p class="hero-coverage" data-testid="hero-coverage-mark" data-coverage={pinnedMark.state}>
					<span class="hero-coverage-glyph" aria-hidden="true">{pinnedMark.glyph}</span>
					<span class="hero-coverage-word">{pinnedMark.word}</span>
				</p>
			{:else}
				<MoneyOdometer amount={displayCost} size="hero" tone="gold" {reducedMotion} />
			{/if}
			{#if heroDelta}
				<span class="delta {heroDelta.dir}" title={`Compared with the preceding equal-length window: ${money(hero?.prior.cost ?? 0)}`} aria-label={`${heroDelta.text} compared with the preceding equal-length window`}>
					{heroDelta.text}
				</span>
			{/if}
		</div>
		{#if flourish}<div class="flourish">{flourish}</div>{/if}

	</div>
	<div class="hero-spark">
		{#if heroSpark.length > 1}
			<Sparkline values={heroSpark} width={240} height={64} color="var(--accent)" area dot ariaLabel="Spend trend across periods" />
		{/if}
	</div>
</section>

<style>
	/* REGION 2 · HERO — total + delta + flourish left, sparkline right, wraps on narrow. */
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1.5rem;
		padding: 1.1rem 0 1.4rem;
		flex-wrap: wrap;
	}
	/* Receipt "print-in" — the register surface reveals like thermal paper feeding
	   out: a quick clip + slide from the top. Motion-gated: the base reset already
	   neutralises the animation under prefers-reduced-motion, and we additionally
	   only declare it under no-preference so it shows the final state immediately. */
	@media (prefers-reduced-motion: no-preference) {
		.hero {
			animation: print-in var(--dur-slow) var(--ease-out) both;
		}
		@keyframes print-in {
			from {
				opacity: 0;
				transform: translateY(-8px);
				clip-path: inset(0 0 100% 0);
			}
			to {
				opacity: 1;
				transform: translateY(0);
				clip-path: inset(0 0 0 0);
			}
		}
	}
	.hero-label {
		margin: 0 0 0.4rem;
		font-family: var(--font-sans);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.scope {
		color: var(--accent-ink);
	}
	.hero-figure {
		display: flex;
		align-items: baseline;
		gap: 1.1rem;
		flex-wrap: wrap;
	}
	/* Coverage mark standing in for the hero money figure on a gap/partial pinned day.
	   Same figure slot, mono voice, deliberately dimmer than a real total so it never
	   reads as a dollar amount. `missing` is the most muted (a true gap); `partial`
	   carries the warn hue (data still landing). */
	.hero-coverage {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-3xl);
		font-weight: var(--fw-medium);
		letter-spacing: var(--tracking-snug);
		color: var(--text-dim);
	}
	.hero-coverage[data-coverage='partial'] {
		color: var(--warn-ink);
	}
	.hero-coverage-glyph {
		font-size: 0.85em;
	}
	.delta {
		font-family: var(--font-num);
		font-size: 0.9rem;
		font-weight: 700;
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.delta.up {
		color: var(--bad);
	}
	.delta.down {
		color: var(--good);
	}
	.delta.flat {
		color: var(--text-dim);
	}
	.flourish {
		margin-top: 0.5rem;
		font-family: var(--font-sans);
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.hero-spark {
		flex: 0 0 auto;
	}

</style>
