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
	import { coverageWord, coverageGlyph } from '$lib/core/coverage-marks';
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
				<MoneyFigure amount={scopedCost} size="lg" tone="gold" />
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
