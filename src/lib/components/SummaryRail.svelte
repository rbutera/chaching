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
	import MoneyOdometer from '$lib/components/ds/MoneyOdometer.svelte';
	import { fmtDay, providerLabel } from '$lib/format';
	import { coverageWord, coverageGlyph } from '$lib/core/coverage-marks';
	import { trailingThrottle } from '$lib/client/motion';
	import type { Period } from '$lib/types';

	let {
		feed,
		dash,
		reducedMotion = false
	}: { feed: FeedStore; dash: Dashboard; reducedMotion?: boolean } = $props();

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

	// Cost-honesty (hard rule): a pinned day whose data is a gap (`missing`) or still
	// accumulating (`partial`) must NOT be headlined as a dollar figure — `focusedTotals.cost`
	// is 0 (or incomplete) for those, and rendering it would fabricate a final "$0.00". For a
	// single-day window the coverage summary's `worst` IS that day's class, so we mark those two
	// with the same coverage vocabulary the hero/stat-row use (`coverageWord`) instead of money.
	// A genuine `zero` day (a frozen, real quiet day) is a legitimate classification and still
	// shows $0.00; a `frozen` day shows its real total. Period scope always shows money (its
	// window total is real spend even when it spans a partial today).
	let pinnedMark = $derived.by(() => {
		if (!focusedDay || !focusedTotals) return null;
		const worst = focusedTotals.coverage.worst;
		if (worst === 'missing' || worst === 'partial') {
			return { state: worst, word: coverageWord(worst), glyph: coverageGlyph(worst) };
		}
		return null;
	});

	// Rail odometer feed: the rail's money readout rolls in lock-step with the hero, so
	// it must share the hero's ONE cadence contract rather than handing NumberFlow a
	// fresh target on every SSE delta (which would thrash the columns out of sync with
	// the hero). Same trailing throttle the hero uses (HeroRegion): ~900ms window,
	// coalesce-to-latest, leading edge fires the first value immediately so first paint
	// rolls 0 → the initial total. Under reduced motion the window collapses to 0
	// (every push immediate) and NumberFlow itself renders without a roll.
	let displayCost = $state(0);
	let tickThrottle = $derived(
		trailingThrottle<number>(reducedMotion ? 0 : 900, (target) => (displayCost = target))
	);
	$effect(() => {
		tickThrottle.push(scopedCost);
	});
	$effect(() => () => tickThrottle.cancel());
</script>

{#if snap}
	<aside class="summary-rail" aria-label="Spend summary">
		<p class="rail-label">spend · {scopeLabel}</p>
		<div class="rail-figure">
			{#if pinnedMark}
				<!-- Honest coverage mark instead of a fabricated $0.00 for a gap/partial pinned day. -->
				<p class="rail-coverage" data-testid="rail-coverage-mark" data-coverage={pinnedMark.state}>
					<span class="rail-coverage-glyph" aria-hidden="true">{pinnedMark.glyph}</span>
					<span class="rail-coverage-word">{pinnedMark.word}</span>
				</p>
			{:else}
				<!-- Rail money readout mirrors the hero's scoped total; the odometer roll
				     ties the two always-visible figures together. The all-time figure below
				     stays a static MoneyFigure (a tiny lifetime number rolling would be noise). -->
				<MoneyOdometer amount={displayCost} size="lg" tone="gold" {reducedMotion} />
			{/if}
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
	/* The rail is THE receipt of the register — a structural surface, so it wears
	   chrome + a tear edge (never grain, which is reserved for the detail panels).
	   A brass top rule warms brass→ember with --register-heat (the escalation
	   ladder), a bright chrome-edge sheen sits just under it, and the bottom is torn
	   into thermal-paper teeth via the sawtooth mask token. Rounded top, torn
	   bottom: it reads as a slip fed out of the till. */
	.summary-rail {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.1rem 1rem calc(1.2rem + var(--tear-tooth));
		border: 1px solid var(--border);
		border-top: 2px solid var(--chrome-warm);
		border-bottom: 0;
		border-radius: var(--radius) var(--radius) 0 0;
		background: var(--surface-1);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--chrome-edge) 28%, transparent);
		/* Torn thermal-paper bottom edge: a solid mask over the body plus the
		   sawtooth token tiled along the bottom tooth-strip. Structural surface only. */
		-webkit-mask:
			linear-gradient(#000 0 0) top / 100% calc(100% - var(--tear-tooth)) no-repeat,
			var(--tear-mask) bottom / var(--tear-tooth) var(--tear-tooth) repeat-x;
		mask:
			linear-gradient(#000 0 0) top / 100% calc(100% - var(--tear-tooth)) no-repeat,
			var(--tear-mask) bottom / var(--tear-tooth) var(--tear-tooth) repeat-x;
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
	/* Coverage mark that stands in for the money figure on a gap/partial pinned day.
	   Same figure slot, mono voice, deliberately dimmer than a real total so it never
	   reads as a dollar amount. `missing` is the most muted (a true gap); `partial`
	   carries the warn hue (data still landing). */
	.rail-coverage {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-lg);
		font-weight: var(--fw-medium);
		letter-spacing: var(--tracking-snug);
		color: var(--text-dim);
	}
	.rail-coverage[data-coverage='partial'] {
		color: var(--warn);
	}
	.rail-coverage-glyph {
		font-size: 0.85em;
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
