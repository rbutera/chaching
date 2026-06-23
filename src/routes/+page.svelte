<script lang="ts">
	import { onMount } from 'svelte';
	import { FeedStore } from '$lib/client/feed.svelte';
	import { Dashboard } from '$lib/client/dashboard.svelte';
	import PeriodSwitcher from '$lib/components/PeriodSwitcher.svelte';
	import SummaryCard from '$lib/components/SummaryCard.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import DetailSheet from '$lib/components/DetailSheet.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import CalendarHeatmap from '$lib/components/CalendarHeatmap.svelte';
	import DayNavigator from '$lib/components/DayNavigator.svelte';
	import Wordmark from '$lib/brand/Wordmark.svelte';
	import {
		money,
		compactTokens,
		pctDelta,
		modelLabel,
		modelColor,
		providerColor,
		providerLabel,
		fmtDay,
		fmtPeriodKey,
		int
	} from '$lib/format';
	import { totalTokens, dayCoverageState } from '$lib/core/aggregate';
	import type { PeriodBucket } from '$lib/core/aggregate';
	import { coverageSub } from '$lib/core/coverage-marks';

	const feed = new FeedStore();
	const dash = new Dashboard();

	onMount(() => {
		feed.start();
		return () => feed.stop();
	});

	let snap = $derived(feed.snapshot);

	// UTC today (YYYY-MM-DD): the live tail. Matches the engine's isoDayUTC(now()); used to
	// tell a "so far today" partial bar from a PAST day a gated scan left partial.
	let todayUTC = $derived(new Date(snap?.generatedAt ?? Date.now()).toISOString().slice(0, 10));

	// The zoomed-in pin (null = rolling-period mode). When set, the hero/cards/donut/session
	// list scope to this single day; the heatmap + trend stay full-range and highlight it.
	let focusedDay = $derived(dash.focusedDay);

	// Clamp/clear a persisted out-of-range pin once the snapshot (and its data range) lands.
	$effect(() => {
		if (snap) dash.reconcileFocusedDay(snap);
	});

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

	// trend buckets (always full rolling window — the navigation surface)
	let trend = $derived<PeriodBucket[]>(snap ? dash.trend(snap) : []);
	let heroSpark = $derived(trend.map((b) => b.cost));

	// calendar heatmap series: one cell per banked day (full range), cost-shaded + coverage.
	let dayCells = $derived(snap ? dash.byDay(snap) : []);
	// Wire the real coverage state from the snapshot map (the sibling change landed) rather
	// than the heatmap's all-frozen default.
	function coverageFor(day: string): import('$lib/types').DayCoverage {
		return snap ? dayCoverageState(day, snap.coverage) : 'frozen';
	}

	// scoped models / totals — pinned-day-scoped when focused, else period-scoped.
	let modelTotals = $derived(
		snap ? (focusedDay ? dash.focusedModels(snap, focusedDay) : dash.models(snap)) : []
	);
	let providerTotals = $derived(snap ? dash.providers(snap) : []);
	let scopedTotals = $derived(
		snap
			? focusedDay
				? dash.focusedTotals(snap, focusedDay)
				: dash.scopedTotals(snap)
			: { tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, cost: 0, requests: 0, costUnknownRequests: 0, coverage: { states: {}, worst: 'frozen' as const } }
	);
	let scopedSessions = $derived(
		snap ? (focusedDay ? dash.focusedSessions(snap, focusedDay) : dash.scopedSessions(snap)) : []
	);

	// whether the scoped window's partial day is TODAY (live tail) vs a past gated-partial day.
	// In focused mode this is "is the pinned day today".
	let windowIncludesToday = $derived(
		!!snap && (focusedDay ? focusedDay === todayUTC : snap.coverage[todayUTC] === 'partial')
	);

	// stacking order = models by cost (scoped)
	let stackModels = $derived(modelTotals.map((m) => m.model));

	// cache savings: what cache-read WOULD have cost at fresh-input rate, minus what it did
	let cacheSavings = $derived.by(() => {
		if (modelTotals.length === 0) return { saved: 0, hitRate: 0 };
		let saved = 0;
		let cacheRead = 0;
		let totalInputish = 0;
		for (const m of modelTotals) {
			const fam = /opus/i.test(m.model) ? 5e-6 : /sonnet/i.test(m.model) ? 3e-6 : /haiku/i.test(m.model) ? 1e-6 : 3e-6;
			const readRate = /opus/i.test(m.model) ? 5e-7 : /sonnet/i.test(m.model) ? 3e-7 : /haiku/i.test(m.model) ? 1e-7 : 3e-7;
			saved += m.tokens.cacheRead * (fam - readRate);
			cacheRead += m.tokens.cacheRead;
			totalInputish += m.tokens.cacheRead + m.tokens.cacheCreation + m.tokens.input;
		}
		return { saved, hitRate: totalInputish > 0 ? cacheRead / totalInputish : 0 };
	});

	let topModel = $derived(modelTotals[0] ?? null);
	let totalTok = $derived(totalTokens(scopedTotals.tokens));

	// 5h cap-proximity active block
	let activeBlock = $derived(snap?.blocks.find((b) => b.isActive) ?? null);

	const isDayBucket = (b: PeriodBucket) => /^\d{4}-\d{2}-\d{2}$/.test(b.key);

	function onTrendPick(b: PeriodBucket) {
		if (!snap) return;
		// A single-DAY bar pins the focused day (the new primary path, single source of truth).
		// A coarse week/month bar (long-span trend) keeps the existing bucket-range drill —
		// focusedDay is single-day only, so a week bar opens the DetailSheet, not a pin.
		if (isDayBucket(b)) {
			dash.setFocusedDay(snap, b.key);
			return;
		}
		const range = dash.bucketDayRange(snap, b);
		dash.openPeriodDrill({ from: range.from, to: range.to, periodKey: b.key, label: fmtPeriodKey(b.key) });
	}

	// Page-level Arrow Left/Right steps the focused day, but ONLY when a day is pinned, focus
	// is not in a text field, and the heatmap grid (which owns its own roving arrows) isn't
	// the focused element — so the page handler never fights the grid or a date input.
	function onPageKey(e: KeyboardEvent) {
		if (!snap || !dash.focusedDay) return;
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const el = document.activeElement as HTMLElement | null;
		if (el) {
			const tag = el.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
			// the heatmap grid cells own arrow nav; let them handle it
			if (el.closest('[data-heatmap-grid]')) return;
		}
		e.preventDefault();
		dash.stepFocusedDay(snap, e.key === 'ArrowRight' ? 1 : -1);
	}

	let unknownNote = $derived(snap && snap.unknownPriceModels.length > 0 ? snap.unknownPriceModels.join(', ') : null);
	let cutoverDate = $derived(snap?.cutoverTs ? new Date(snap.cutoverTs).toISOString().slice(0, 10) : '');

	async function saveCutover(value: string) {
		const ts = value ? Date.parse(value + 'T00:00:00Z') : null;
		await fetch('/api/config', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ cutoverTs: ts })
		});
	}

	let connDot = $derived(
		feed.conn === 'live'
			? 'var(--good)'
			: feed.conn === 'paused'
				? 'var(--fg-dim)'
				: feed.conn === 'error'
					? 'var(--bad)'
					: 'var(--warn)'
	);
</script>

<svelte:window onkeydown={onPageKey} />

<div class="page">
	<header class="topbar">
		<div class="brand">
			<h1 class="brand-title"><Wordmark size={22} /></h1>
			<p class="tagline">local AI token spend</p>
		</div>
		<div class="status" title={`feed: ${feed.conn}`}>
			<span class="dot" style={`background:${connDot}`}></span>
			<span class="status-txt">{feed.conn}</span>
		</div>
	</header>

	{#if !snap}
		<div class="loading">
			<div class="spinner" aria-hidden="true"></div>
			<p>Cold-scanning Claude Code transcripts…</p>
			<p class="loading-sub">First load streams every session file once. This is the only slow part.</p>
		</div>
	{:else}
		<main>
			<!-- HERO -->
			<section class="hero-sec" aria-label="Current period spend">
				<div class="hero-left">
				<p class="hero-label">
					Spend · {heroLabel}
						{#if focusedDay}<span class="scope">· pinned day</span>{/if}
					{#if dash.providerFilter.size > 0}<span class="scope">· {[...dash.providerFilter].map(providerLabel).join(', ')}</span>{/if}
					{#if dash.modelFilter.size > 0}<span class="scope">· {[...dash.modelFilter].map(modelLabel).join(', ')}</span>{/if}
				</p>
					<div class="hero-row">
						<span class="hero-num num">{money(heroCost)}</span>
						{#if heroDelta}
							<span class="hero-delta {heroDelta.dir}">
								{heroDelta.text}
								<span class="hero-delta-sub">vs prior {money(hero?.prior.cost ?? 0)}</span>
							</span>
						{/if}
					</div>
				</div>
				<div class="hero-spark">
					{#if heroSpark.length > 1}
						<Sparkline values={heroSpark} width={200} height={56} color="var(--accent)" ariaLabel="Spend trend across periods" />
					{/if}
				</div>
			</section>

			<!-- STICKY CONTROLS -->
			<div class="controls">
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
					<div class="provider-filter" aria-label="Provider filter">
						{#each providerTotals as p (p.provider)}
							<button
								class:active={dash.providerFilter.has(p.provider)}
								style={`--provider:${providerColor(p.provider)}`}
								onclick={() => dash.toggleProvider(p.provider)}
							>
								<span>{providerLabel(p.provider)}</span>
								<span class="num">{money(p.cost)}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if dash.providerFilter.size > 0}
					<button class="clear-filter" onclick={() => dash.clearProviderFilter()}>Clear provider filter ✕</button>
				{/if}
				{#if dash.modelFilter.size > 0}
					<button class="clear-filter" onclick={() => dash.clearModelFilter()}>Clear model filter ✕</button>
				{/if}
			</div>

			<!-- SUMMARY CARDS -->
			<section class="cards" aria-label="Summary">
				<SummaryCard
					label="Total spend (scope)"
					value={money(scopedTotals.cost)}
					accent="var(--accent)"
					sub={coverageSub(scopedTotals.coverage, windowIncludesToday) ?? `${int(scopedTotals.requests)} requests`}
				/>
				<SummaryCard
					label="Total tokens"
					value={compactTokens(totalTok)}
					accent="var(--m-sonnet)"
					sub={`${compactTokens(scopedTotals.tokens.output)} output`}
				/>
				<SummaryCard
					label="Cache savings"
					value={money(cacheSavings.saved)}
					accent="var(--good)"
					sub={`${Math.round(cacheSavings.hitRate * 100)}% cache-read share`}
				/>
				<SummaryCard
					label="Top model"
					value={topModel ? modelLabel(topModel.model) : '—'}
					accent={topModel ? modelColor(topModel.model) : 'var(--m-other)'}
					sub={topModel ? `${money(topModel.cost)} · ${compactTokens(totalTokens(topModel.tokens))}` : ''}
				/>
			</section>

			<!-- CALENDAR HEATMAP: primary time-nav surface -->
				<section class="heatmap-sec" aria-label="Daily spend calendar">
					<div class="panel">
						<CalendarHeatmap
							cells={dayCells}
							{focusedDay}
							coverage={coverageFor}
							onPick={(day) => dash.setFocusedDay(snap, day)}
						/>
					</div>
				</section>

				<!-- MAIN GRID: trend + breakdown -->
			<section class="grid">
				<div class="panel trend-panel">
					{#if trend.length > 0}
						<TrendChart buckets={trend} models={stackModels} onPick={onTrendPick} today={todayUTC} />
					{:else}
						<p class="empty">No data in this scope.</p>
					{/if}
				</div>

				<div class="panel donut-panel">
					<h2 class="panel-title">By model</h2>
					<Donut models={modelTotals} activeFilter={dash.modelFilter} onToggle={(m) => dash.toggleModel(m)} />
				</div>
			</section>

			<!-- 5h cap-proximity + sessions -->
			<section class="grid">
				<div class="panel">
					<SessionList sessions={scopedSessions} onOpen={(s) => dash.openSessionDrill(s)} />
				</div>
				<div class="panel cap-panel">
					<h2 class="panel-title">5-hour window (cap proximity)</h2>
					{#if activeBlock}
						<div class="cap">
							<span class="cap-num num">{money(activeBlock.cost)}</span>
							<span class="cap-sub">current window · {compactTokens(totalTokens(activeBlock.tokens))} tokens</span>
							<span class="cap-time">closes {new Date(activeBlock.endTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
					{:else}
						<p class="empty">No active window right now.</p>
					{/if}
					{#if snap.blocks.length > 0}
						<ul class="recent-blocks">
							{#each snap.blocks.slice(0, 5) as b (b.startTs)}
								<li>
									<span class="num">{money(b.cost)}</span>
									<span class="blk-sub">{new Date(b.startTs).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>

			<!-- HONESTY / LIMITS -->
			<footer class="honesty">
				<p>
					<strong>Cost is a computed estimate.</strong> Claude Code stores token counts, not cost; figures
					are tokens × a vendored LiteLLM price snapshot (provider counts are best-effort, not invoice-exact).
				</p>
				<p>
					Data covers <strong>{snap.earliestDay ? fmtDay(snap.earliestDay) : '—'}</strong> →
					<strong>{snap.latestDay ? fmtDay(snap.latestDay) : '—'}</strong>
					({int(snap.stats.recordsCounted)} responses across {int(snap.stats.filesScanned)} files; {int(snap.stats.duplicatesSkipped)} streamed duplicates removed). Older logs beyond Claude Code's 30-day retention are gone.
				</p>
				<p>Thinking/reasoning tokens are <strong>not separately metered</strong> for Claude — they fold into output.</p>
				{#if unknownNote}
					<p class="warn">Unpriced models (cost excluded): {unknownNote}</p>
				{/if}
				<p class="cutover">
					<label for="cutover">Work/personal cutover (optional, not inferred):</label>
					<input
						id="cutover"
						type="date"
						value={cutoverDate}
						onchange={(e) => saveCutover((e.currentTarget as HTMLInputElement).value)}
					/>
				</p>
			</footer>
		</main>
	{/if}
</div>

{#if snap && dash.drill}
	<DetailSheet drill={dash.drill} snapshot={snap} onClose={() => dash.closeDrill()} />
{/if}

<style>
	.page {
		max-width: var(--maxw);
		margin: 0 auto;
		padding: 0 1rem env(safe-area-inset-bottom, 1rem);
	}
	.topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 0 0.6rem;
		position: sticky;
		top: 0;
		background: linear-gradient(var(--bg) 70%, transparent);
		z-index: 10;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.brand-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: inherit;
		line-height: 1;
	}
	.tagline {
		margin: 0;
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.loading {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--fg-muted);
	}
	.loading-sub {
		font-size: 0.8rem;
		color: var(--fg-dim);
	}
	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		margin: 0 auto 1rem;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.hero-sec {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		padding: 0.6rem 0 1rem;
		flex-wrap: wrap;
	}
	.hero-label {
		margin: 0 0 0.2rem;
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-dim);
	}
	.scope {
		color: var(--accent);
	}
	.hero-row {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	.hero-num {
		font-size: clamp(2.6rem, 9vw, 3.6rem);
		font-weight: 720;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.hero-delta {
		font-family: var(--font-num);
		font-size: 1rem;
		font-weight: 600;
		display: flex;
		flex-direction: column;
	}
	.hero-delta.up {
		color: var(--bad);
	}
	.hero-delta.down {
		color: var(--good);
	}
	.hero-delta.flat {
		color: var(--fg-dim);
	}
	.hero-delta-sub {
		font-size: 0.7rem;
		color: var(--fg-dim);
		font-weight: 400;
	}
	.hero-spark {
		flex: 0 0 auto;
	}

	.controls {
		position: sticky;
		top: 56px;
		z-index: 9;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0;
		background: linear-gradient(var(--bg) 75%, transparent);
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
		font-size: 0.68rem;
		color: var(--fg-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.heatmap-sec {
		margin-bottom: 1rem;
	}
	.clear-filter {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.35rem 0.8rem;
		font-size: 0.78rem;
		color: var(--fg-muted);
		min-height: 36px;
	}
	.clear-filter:hover {
		color: var(--fg);
	}
	.provider-filter {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.provider-filter button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 36px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--provider) 45%, var(--border));
		background: color-mix(in srgb, var(--provider) 10%, var(--surface-2));
		color: var(--fg-muted);
		padding: 0.35rem 0.7rem;
		font-size: 0.74rem;
	}
	.provider-filter button.active {
		background: color-mix(in srgb, var(--provider) 22%, var(--surface-2));
		color: var(--fg);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--provider) 70%, transparent);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.7rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 720px) {
		.cards {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 860px) {
		.grid {
			grid-template-columns: 2fr 1fr;
		}
	}
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem;
		box-shadow: var(--shadow);
	}
	.panel-title {
		margin: 0 0 0.8rem;
		font-size: 0.8rem;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
	}
	.empty {
		color: var(--fg-dim);
		text-align: center;
		padding: 2rem 1rem;
	}
	.cap {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-bottom: 0.8rem;
	}
	.cap-num {
		font-size: 1.8rem;
		font-weight: 680;
	}
	.cap-sub {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.cap-time {
		font-size: 0.74rem;
		color: var(--fg-dim);
	}
	.recent-blocks {
		list-style: none;
		margin: 0;
		padding: 0.6rem 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.recent-blocks li {
		display: flex;
		justify-content: space-between;
		font-size: 0.82rem;
	}
	.blk-sub {
		color: var(--fg-dim);
		font-size: 0.74rem;
	}

	.honesty {
		margin: 1.5rem 0 3rem;
		padding: 1rem 1.1rem;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--fg-muted);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.honesty p {
		margin: 0 0 0.5rem;
	}
	.honesty strong {
		color: var(--fg);
		font-weight: 600;
	}
	.honesty .warn {
		color: var(--warn);
	}
	.cutover {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.7rem !important;
	}
	.cutover input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--fg);
		padding: 0.35rem 0.5rem;
		font-family: var(--font-num);
		color-scheme: dark;
	}
</style>
