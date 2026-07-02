<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { FeedStore } from '$lib/client/feed.svelte';
	import { Dashboard } from '$lib/client/dashboard.svelte';
	import PeriodSwitcher from '$lib/components/PeriodSwitcher.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import SessionExplorer from '$lib/components/SessionExplorer.svelte';
	import DetailSheet from '$lib/components/DetailSheet.svelte';
	import CalendarHeatmap from '$lib/components/CalendarHeatmap.svelte';
	import DayNavigator from '$lib/components/DayNavigator.svelte';
	import CachePanel from '$lib/components/CachePanel.svelte';
	import SubsidisationCard from '$lib/components/SubsidisationCard.svelte';
	// Register & Receipt design-system primitives (chaching-ds-components).
	import BrandMark from '$lib/components/ds/BrandMark.svelte';
	import Badge from '$lib/components/ds/Badge.svelte';
	import MoneyFigure from '$lib/components/ds/MoneyFigure.svelte';
	import StatCard from '$lib/components/ds/StatCard.svelte';
	import Sparkline from '$lib/components/ds/Sparkline.svelte';
	import SpendMeter from '$lib/components/ds/SpendMeter.svelte';
	import Divider from '$lib/components/ds/Divider.svelte';
	import type { SubsidisedProvider } from '$lib/core/subsidisation';
	import type { PublicchachingConfig } from '$lib/core/config';
	// Baked at build time (Vite JSON import) — the header version badge.
	import { version } from '../../package.json';
	import {
		money,
		compactTokens,
		pctDelta,
		modelLabel,
		modelColor,
		providerLabel,
		fmtDay,
		fmtPeriodKey,
		int
	} from '$lib/format';
	import { totalTokens, dayCoverageState } from '$lib/core/aggregate';
	import type { PeriodBucket } from '$lib/core/aggregate';
	import { coverageSub } from '$lib/core/coverage-marks';
	// Shared voice (escalation ladder) + web motion (count-up, rate-limited tick).
	import {
		flourishFor,
		formatFlourishText,
		tierIndex,
		crossedUp,
		DAILY_FLOURISHES,
		LIFETIME_FLOURISHES
	} from '$lib/voice';
	import { countUp, trailingThrottle } from '$lib/client/motion';
	import { JoyController } from '$lib/client/joy';
	import { webSuppressArt } from '$lib/client/suppress';

	const feed = new FeedStore();
	const dash = new Dashboard();

	// The persisted public config (carries the per-provider subscription block). The
	// subsidisation card + tier switcher are controlled off this local copy; a tier
	// change POSTs to /api/config and merges the echoed config back in. Held separate
	// from the feed snapshot so a live SSE delta and a tier write never reset each other.
	let config = $state<PublicchachingConfig | null>(null);

	async function loadPublicConfig() {
		try {
			const res = await fetch(resolve('/api/config'));
			if (res.ok) config = (await res.json()) as PublicchachingConfig;
		} catch {
			/* config stays null → cards fall back to defaults */
		}
	}

	// Honour prefers-reduced-motion in JS (the count-up must render the final value
	// immediately when reduced; the token base reset already nukes CSS transitions).
	let reducedMotion = $state(false);

	// Web "no-art" equivalent (design D9): suppress personality copy + extra motion
	// when `?no-art` or the persisted setting is on, mirroring the CLI contract.
	let suppressArt = $state(false);

	onMount(() => {
		feed.start();
		void loadPublicConfig();
		suppressArt = webSuppressArt();
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const onMq = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		mq.addEventListener('change', onMq);
		return () => {
			feed.stop();
			mq.removeEventListener('change', onMq);
		};
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

	// "Receipt" button → /api/receipt.png reflecting the dashboard's current period,
	// focused-day pin, and provider filter. (The receipt has no per-MODEL scope — same
	// as the CLI receipt command — so a model filter isn't forwarded.) Redaction is
	// OPT-IN (no `redact` param here): it's the user's own local data; add `?redact=1`
	// when sharing.
	let receiptUrl = $derived.by(() => {
		const qs = new URLSearchParams();
		qs.set('period', dash.period);
		if (focusedDay) qs.set('day', focusedDay);
		for (const p of dash.providerFilter) qs.append('provider', p);
		return `${resolve('/api/receipt.png')}?${qs.toString()}`;
	});

	function openReceipt(): void {
		// New tab; noopener for safety. The current view is baked into receiptUrl.
		window.open(receiptUrl, '_blank', 'noopener');
	}

	// Hero count-up: animate from 0 → heroCost on first paint only. Live SSE deltas
	// update via a RATE-LIMITED tick (trailing throttle, coalesce-to-latest) so a
	// chatty feed never thrashes the figure. Both paths go through the shared
	// `countUp` util, which no-ops to the final value under prefers-reduced-motion.
	//
	// `started` is a NON-reactive closure flag (a plain let, not $state): the effect
	// must not read+write the same reactive value or it self-invalidates and cancels
	// its own rAF before a single frame runs. The effect tracks only heroCost +
	// reducedMotion.
	let displayCost = $state(0);
	let started = false;
	// Trailing throttle for live deltas (~900ms window): one tick animation per
	// window, always landing on the latest value. Recreated when reducedMotion flips.
	let tickThrottle = $derived(
		trailingThrottle<number>(reducedMotion ? 0 : 900, (target) => {
			countUp(displayCost, target, (v) => (displayCost = v), { durMs: 350, reduced: reducedMotion });
		})
	);
	$effect(() => {
		const target = heroCost;
		// First non-trivial value: the one-shot count-up from 0 (or immediate set when reduced).
		if (!started) {
			if (target <= 0) {
				displayCost = 0;
				return;
			}
			started = true;
			const cancel = countUp(0, target, (v) => (displayCost = v), {
				durMs: 650,
				reduced: reducedMotion
			});
			return cancel;
		}
		// After first paint: live deltas land via the rate-limited tick.
		tickThrottle.push(target);
	});
	$effect(() => () => tickThrottle.cancel());

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
	// Per-project spend (scoped): which repo/client is eating the money. Follows the same
	// period + filter + focusedDay scoping as the session list (design D4 shared lineage).
	let projectTotals = $derived(snap ? dash.projectTotals(snap) : []);
	const PROJECT_TOP_N = 8;
	let projectTop = $derived(projectTotals.slice(0, PROJECT_TOP_N));
	let projectMore = $derived(Math.max(0, projectTotals.length - PROJECT_TOP_N));
	let scopedTotals = $derived(
		snap
			? focusedDay
				? dash.focusedTotals(snap, focusedDay)
				: dash.scopedTotals(snap)
			: { tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, cost: 0, requests: 0, costUnknownRequests: 0, coverage: { states: {}, worst: 'frozen' as const } }
	);
	// The explorer is cross-day by default (design D6): all banked sessions, frozen ∪ live.
	// A pinned focusedDay deep-links it to that single day (design D8 drill-target scope).
	let explorerSessions = $derived(
		snap ? (focusedDay ? dash.focusedSessions(snap, focusedDay) : dash.allSessions(snap)) : []
	);

	// whether the scoped window's partial day is TODAY (live tail) vs a past gated-partial day.
	// In focused mode this is "is the pinned day today".
	let windowIncludesToday = $derived(
		!!snap && (focusedDay ? focusedDay === todayUTC : snap.coverage[todayUTC] === 'partial')
	);

	// stacking order = models by cost (scoped)
	let stackModels = $derived(modelTotals.map((m) => m.model));

	// Cache-cost breakdown for the current scope (follows the period selector). Every
	// rate comes from resolvePrice via cacheCostBreakdown — no hardcoded per-family
	// literals (the old inline-rate drift is gone). Drives the CachePanel + the
	// "Cache savings" StatCard.
	let cacheBreakdown = $derived(snap ? dash.cacheBreakdown(snap).combined : null);
	let cacheSavings = $derived.by(() => {
		const b = cacheBreakdown;
		if (!b) return { saved: 0, hitRate: 0 };
		const cacheRead = b.cacheReadTokens;
		const totalInputish = scopedTotals.tokens.input + scopedTotals.tokens.cacheCreation + cacheRead;
		return { saved: b.savedVsUncached, hitRate: totalInputish > 0 ? cacheRead / totalInputish : 0 };
	});

	// Subsidisation roll-up — follows the period selector / pinned day; the fee is
	// pro-rated to the window from a monthlyUsd/30 daily rate.
	let subsidyConfig = $derived(
		config
			? {
					claude: {
						enabled: config.providers.claude.enabled,
						tier: config.providers.claude.subscription.tier,
						monthlyUsd: config.providers.claude.subscription.monthlyUsd
					},
					codex: {
						enabled: config.providers.codex.enabled,
						tier: config.providers.codex.subscription.tier,
						monthlyUsd: config.providers.codex.subscription.monthlyUsd
					}
				}
			: null
	);
	let subsidy = $derived(snap && subsidyConfig ? dash.subsidisation(snap, subsidyConfig) : null);

	// Burn-pace projection ("on pace for ~$X this month") — same month-basis, does-NOT-follow-
	// the-period-selector semantics as the subsidy above (design D5). null when the cost-honesty
	// guards trip (coverage gap in the elapsed month, or too few elapsed days).
	let pace = $derived(snap ? dash.burnPace(snap) : null);

	// Commit a tier change for one provider: optimistically update the local config
	// copy (so the switcher + card move immediately), then persist via /api/config and
	// merge the echoed config back. A racing SSE delta touches the feed snapshot, not
	// this config copy, so the two never reset each other (design D7 cross-element).
	async function onTierChange(provider: SubsidisedProvider, tier: string, monthlyUsd: number) {
		if (config) {
			config = {
				...config,
				providers: {
					...config.providers,
					[provider]: {
						...config.providers[provider],
						subscription: { tier, monthlyUsd }
					}
				}
			};
		}
		try {
			const res = await fetch(resolve('/api/config'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider, subscription: { tier, monthlyUsd } })
			});
			if (res.ok) config = (await res.json()) as PublicchachingConfig;
		} catch {
			/* keep the optimistic local copy on failure */
		}
	}

	let topModel = $derived(modelTotals[0] ?? null);
	let totalTok = $derived(totalTokens(scopedTotals.tokens));

	// 5h cap-proximity active block
	let activeBlock = $derived(snap?.blocks.find((b) => b.isActive) ?? null);

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

	// Lifetime ladder, keyed off the all-time total (snapshot.totals.cost). Drives the
	// lifetime milestone crossing (the confetti trigger) — same one-ladder source.
	let lifetimeCost = $derived(snap?.totals.cost ?? 0);

	// ── Opt-in joy (default OFF) — chime on escalation crossings, confetti on lifetime
	// milestones. The controller is dynamically-imported on the joy path only; nothing
	// eager loads, no AudioContext, until the user enables it. Page-Visibility-aware,
	// persisted, rate-limited, reduced-motion-suppressed for the burst. See D8.
	const joy = new JoyController();
	let joyEnabled = $state(false);
	let joyMuted = $state(false);
	// Track last-seen tiers so a crossing fires AT MOST once, never retroactively.
	let lastDailyTier = -1;
	let lastLifetimeTier = -1;
	$effect(() => {
		// Sync persisted joy settings into local UI state once mounted.
		joyEnabled = joy.enabled;
		joyMuted = joy.muted;
	});
	$effect(() => {
		const dailyTier = tierIndex(heroCost, DAILY_FLOURISHES);
		const lifeTier = tierIndex(lifetimeCost, LIFETIME_FLOURISHES);
		// Initialise the baseline on first observation (no retroactive fire).
		if (lastDailyTier < 0) lastDailyTier = dailyTier;
		if (lastLifetimeTier < 0) lastLifetimeTier = lifeTier;
		// Web no-art (D9): joy is personality — never fire it when suppressed, even if
		// a persisted enabled=true survives. Keep the tiers tracked so re-enabling
		// doesn't retroactively fire a crossing that happened while suppressed.
		if (suppressArt) {
			lastDailyTier = dailyTier;
			lastLifetimeTier = lifeTier;
			return;
		}
		if (crossedUp(lastDailyTier, dailyTier)) {
			joy.onEscalationCrossing(); // chime (gated internally: enabled+visible+unmuted)
		}
		if (crossedUp(lastLifetimeTier, lifeTier)) {
			joy.onMilestoneCrossing({ reducedMotion }); // confetti (gated internally)
		}
		lastDailyTier = dailyTier;
		lastLifetimeTier = lifeTier;
	});
	$effect(() => () => joy.dispose());

	function toggleJoy() {
		joyEnabled = joy.setEnabled(!joyEnabled);
	}
	function toggleMute() {
		joyMuted = joy.setMuted(!joyMuted);
	}

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
		await fetch(resolve('/api/config'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ cutoverTs: ts })
		});
	}

	// Connection state — all four states kept (P14). Skin only: colour + glow.
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
			<h1 class="brand-title"><BrandMark size={24} wordmark title="chaching" /></h1>
			<span class="ver" title="chaching version">v{version}</span>
			<p class="tagline">local AI token spend</p>
		</div>
		<div class="topbar-right">
			<!-- Opt-in joy (default OFF): a sound toggle + a mute. No AudioContext, no
			     asset, no canvas-confetti loads until enabled and a crossing fires. The
			     joy treat is itself personality, so the web no-art equivalent (D9)
			     hides the controls entirely. -->
			{#if !suppressArt}
				<div class="joy-controls">
					<button
						type="button"
						class="joy-toggle ka-chunk"
						class:on={joyEnabled}
						aria-pressed={joyEnabled}
						title={joyEnabled ? 'cha-ching sound on' : 'cha-ching sound off'}
						onclick={toggleJoy}
					>
						{joyEnabled ? '🔔 sound on' : '🔕 sound off'}
					</button>
					{#if joyEnabled}
						<button
							type="button"
							class="joy-mute ka-chunk"
							class:on={joyMuted}
							aria-pressed={joyMuted}
							title={joyMuted ? 'chime muted' : 'chime unmuted'}
							onclick={toggleMute}
						>
							{joyMuted ? 'muted' : 'mute'}
						</button>
					{/if}
				</div>
			{/if}
			<div class="conn" title={`feed: ${feed.conn}`}>
				<span class="dot" style={`background:${connDot}; box-shadow: 0 0 8px ${connDot}`}></span>
				<span class="conn-txt">{feed.conn}</span>
			</div>
		</div>
	</header>

	{#if !snap}
		<div class="loading" aria-live="polite">
			<div class="spinner" aria-hidden="true"></div>
			<!-- Personality loading copy falls back to the plain functional label under
			     the web no-art equivalent (D9). -->
			<p>{suppressArt ? 'Cold-scanning Claude Code transcripts.' : 'Counting your sins… cold-scanning Claude Code transcripts.'}</p>
			<p class="loading-sub">First load streams every session file once. This is the only slow part.</p>
		</div>
	{:else}
		<main>
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
						<MoneyFigure amount={displayCost} size="hero" tone="gold" />
						{#if heroDelta}
							<span class="delta {heroDelta.dir}">
								{heroDelta.text}
								<span class="sub">vs prior {money(hero?.prior.cost ?? 0)}</span>
							</span>
						{:else if !focusedDay && hero && !hero.priorHasBaseline}
							<!-- Baseline rule (2026-07-02): gap days count as $0, so the only
							     unrenderable comparison is a prior window with NO recorded
							     spend at all (a % of zero is meaningless). Say why. -->
							<span class="delta none" title="The equal-length window before this one has no recorded spend, so there is nothing to compare against yet.">
								no prior spend to compare
							</span>
						{/if}
					</div>
					{#if flourish}<div class="flourish">{flourish}</div>{/if}
					<div class="hero-actions">
						<button
							type="button"
							class="receipt-btn ka-chunk"
							onclick={openReceipt}
							title="Open a shareable receipt PNG of this view in a new tab"
							aria-label="Open a shareable receipt of the current view in a new tab"
						>
							🧾 Receipt
						</button>
					</div>
				</div>
				<div class="hero-spark">
					{#if heroSpark.length > 1}
						<Sparkline values={heroSpark} width={240} height={64} color="var(--accent)" area dot ariaLabel="Spend trend across periods" />
					{/if}
				</div>
			</section>

			<!-- REGION 3 · STICKY CONTROLS -->
			<div class="controls">
				<div class="period-wrap" class:overridden={focusedDay != null}>
					<PeriodSwitcher value={dash.period} onChange={(p) => dash.setPeriod(p)} />
					{#if focusedDay != null}<span class="override-note">overridden by focused day</span>{/if}
				</div>
				{#if focusedDay != null}
					<span class="pinned-badge">
						<Badge tone="accent" solid>pinned · {fmtDay(focusedDay)}</Badge>
						<button class="pin-clear" aria-label="Clear pinned day" onclick={() => dash.clearFocusedDay()}>✕</button>
					</span>
				{/if}
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
					<div class="pills" aria-label="Provider filter">
						{#each providerTotals as p (p.provider)}
							<button
								class="provider-pill"
								class:active={dash.providerFilter.has(p.provider)}
								aria-pressed={dash.providerFilter.has(p.provider)}
								style={`--provider:var(--p-${p.provider}, var(--m-other))`}
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

			<!-- REGION 4 · STAT ROW -->
			<section class="stat-grid" aria-label="Summary">
				<StatCard
					label="total spend"
					value={scopedTotals.cost}
					money
					animate
					moneyTone="gold"
					accent="var(--accent)"
					sub={coverageSub(scopedTotals.coverage, windowIncludesToday) ?? `${int(scopedTotals.requests)} requests`}
				/>
				<StatCard
					label="total tokens"
					value={compactTokens(totalTok)}
					accent="var(--m-sonnet)"
					sub={`${compactTokens(scopedTotals.tokens.output)} output`}
				/>
				<StatCard
					label="cache savings"
					value={cacheSavings.saved}
					money
					animate
					moneyTone="save"
					accent="var(--good)"
					sub={`${Math.round(cacheSavings.hitRate * 100)}% cache-read share`}
				/>
				<StatCard
					label="top model"
					value={topModel ? modelLabel(topModel.model) : '—'}
					accent={topModel ? modelColor(topModel.model) : 'var(--m-other)'}
					sub={topModel ? `${money(topModel.cost)} · ${compactTokens(totalTokens(topModel.tokens))}` : ''}
				/>
			</section>

			<!-- REGION 5 · VALUE-CARD BAND (cache cost + subscription subsidy, design.md D1a) -->
			<section class="value-grid" aria-label="Cache cost and subscription subsidy">
				{#if cacheBreakdown}
					<CachePanel breakdown={cacheBreakdown} />
				{/if}
				{#if subsidy && subsidyConfig}
					<SubsidisationCard rollup={subsidy} windowLabel={heroLabel} config={subsidyConfig} {onTierChange} burnPace={pace} />
				{/if}
			</section>

			<!-- REGION 6 · CALENDAR HEATMAP (primary time-nav surface) -->
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

			<!-- REGION 7 · BY-MODEL / 5H WINDOW GRID -->
			<section class="grid2">
				<div class="panel by-model">
					{#if trend.length > 0}
						<TrendChart buckets={trend} models={stackModels} onPick={onTrendPick} today={todayUTC} />
					{:else}
						<p class="empty">No data in this scope.</p>
					{/if}
					<div class="model-break">
						<h2 class="panel-title"><span>by model</span></h2>
						<Donut models={modelTotals} activeFilter={dash.modelFilter} onToggle={(m) => dash.toggleModel(m)} />
					</div>
				</div>

				<div class="panel cap-panel">
					<h2 class="panel-title"><span>5-hour window · cap proximity</span></h2>
					{#if activeBlock}
						<SpendMeter amount={activeBlock.cost} context="block" label={`closes ${new Date(activeBlock.endTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`} />
						<p class="cap-sub">{compactTokens(totalTokens(activeBlock.tokens))} tokens this window</p>
					{:else}
						<p class="empty">No active window right now.</p>
					{/if}
					{#if snap.blocks.length > 0}
						<div class="cap-recent">
							<Divider variant="solid" />
							<ul class="recent-blocks">
								{#each snap.blocks.slice(0, 5) as b (b.startTs)}
									<li>
										<span class="num">{money(b.cost)}</span>
										<span class="blk-sub">{new Date(b.startTs).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</section>

			<!-- REGION 7b · BY PROJECT (which repo/client is eating the money) -->
			<section class="by-project-sec" aria-label="Spend by project">
				<div class="panel">
					<h2 class="panel-title"><span>by project</span></h2>
					<!-- Session-derived (design D3 overlap rule): whole sessions that touch the
					     window count in full, so this panel reconciles to the session total, not
					     the day-grain cards above. The caption keeps that honest. -->
					<p class="proj-caption">whole sessions overlapping this window</p>
					{#if projectTotals.length > 0}
						<ul class="project-list">
							{#each projectTop as p (p.isUnknown ? 'unknown' : `project:${p.project}`)}
								<li class:unknown={p.isUnknown} title={p.isUnknown ? 'Sessions with no recorded project' : p.project}>
									<span class="proj-name">{p.display}</span>
									<span class="proj-figs">
										<span class="num">{money(p.cost)}</span>
										<span class="proj-sub">{compactTokens(totalTokens(p.tokens))} tok</span>
										<span class="proj-sub">{int(p.sessionCount)} {p.sessionCount === 1 ? 'session' : 'sessions'}</span>
									</span>
								</li>
							{/each}
						</ul>
						{#if projectMore > 0}
							<p class="proj-more">+{projectMore} more</p>
						{/if}
					{:else}
						<p class="empty">No sessions in this scope.</p>
					{/if}
				</div>
			</section>

			<!-- REGION 8 · SESSIONS -->
			<section class="sessions-sec" aria-label="Sessions">
				<div class="panel">
					<SessionExplorer
						sessions={explorerSessions}
						now={snap.generatedAt || Date.now()}
						onOpen={(s) => dash.openSessionDrill(s)}
					/>
				</div>
			</section>

			<!-- REGION 9 · HONESTY FOOTER -->
			<footer class="honesty">
				<p>
					<strong>Cost is a computed estimate.</strong> Claude Code stores token counts, not cost; figures
					are tokens × a vendored LiteLLM price snapshot — best-effort, not invoice-exact. It counts the cache hits too.
				</p>
				<p>
					Coverage is explicit: frozen days are authoritative, today reads partial, gaps read as missing — never a lying $0.
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

	/* REGION 1 · TOPBAR — sticky, brass mark on warm ink, --bg gradient mask. */
	.topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.1rem 0 0.75rem;
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		background: linear-gradient(var(--bg) 72%, transparent);
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.85rem;
	}
	.brand-title {
		margin: 0;
		font-size: 1rem;
		font-weight: inherit;
		line-height: 1;
	}
	.tagline {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-dim);
	}
	.ver {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill, 999px);
		padding: 0.05rem 0.45rem;
		opacity: 0.8;
	}
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.topbar-right {
		display: inline-flex;
		align-items: center;
		gap: 1rem;
	}
	.joy-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.joy-toggle,
	.joy-mute {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-snug);
		color: var(--text-muted);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.2rem 0.6rem;
	}
	.joy-toggle.on {
		color: var(--text-on-gold);
		background: var(--accent);
		border-color: var(--accent);
	}
	.joy-mute.on {
		color: var(--text);
		border-color: var(--border-strong);
	}

	/* Register "ka-chunk" microinteraction — press scale .97 + darken to gold-600,
	   hover lift + brighten to gold-400, 2px gold focus ring. CSS-only, on the
	   --dur-fast/--dur motion tokens; gated by prefers-reduced-motion (the base
	   reset kills the transition, and the transform only applies when motion is ok). */
	.ka-chunk {
		transform: translateY(0) scale(1);
	}
	.ka-chunk:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: no-preference) {
		.ka-chunk {
			transition:
				transform var(--dur-fast) var(--ease-snap),
				background var(--dur-fast) var(--ease-out),
				border-color var(--dur-fast) var(--ease-out),
				color var(--dur-fast) var(--ease-out),
				box-shadow var(--dur) var(--ease-out);
		}
		.ka-chunk:hover:not(:disabled) {
			transform: translateY(-1px);
			border-color: var(--gold-400);
			color: var(--gold-400);
		}
		.ka-chunk:active:not(:disabled) {
			transform: scale(0.97);
			background: var(--gold-600);
			border-color: var(--gold-600);
		}
	}

	/* LOADING — characterful cold-scan state. */
	.loading {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.loading-sub {
		font-size: 0.8rem;
		color: var(--text-dim);
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
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

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
		font-family: var(--font-mono);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.scope {
		color: var(--accent);
	}
	.hero-figure {
		display: flex;
		align-items: baseline;
		gap: 1.1rem;
		flex-wrap: wrap;
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
	.delta.none {
		color: var(--text-dim);
		font-weight: 400;
	}
	.delta.flat {
		color: var(--text-dim);
	}
	.delta .sub {
		font-size: 0.7rem;
		color: var(--text-dim);
		font-weight: 400;
	}
	.flourish {
		margin-top: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.hero-actions {
		margin-top: 0.85rem;
	}
	.receipt-btn {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-snug);
		color: var(--text-on-gold);
		background: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-pill);
		padding: 0.35rem 0.85rem;
		cursor: pointer;
	}
	.hero-spark {
		flex: 0 0 auto;
	}

	/* REGION 3 · STICKY CONTROLS — sticky under the topbar at top: 58px. */
	.controls {
		position: sticky;
		top: 58px;
		z-index: 8;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0 0.9rem;
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
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.pinned-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.pin-clear {
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: 0.8rem;
		line-height: 1;
		min-height: 32px;
		padding: 0 0.3rem;
		cursor: pointer;
	}
	.pin-clear:hover {
		color: var(--text);
	}
	.pills {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.provider-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 34px;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--provider) 45%, var(--border));
		background: color-mix(in srgb, var(--provider) 10%, var(--surface-2));
		color: var(--text-muted);
		padding: 0.35rem 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		transition: background var(--dur-fast) var(--ease-out);
	}
	.provider-pill.active {
		background: color-mix(in srgb, var(--provider) 22%, var(--surface-2));
		color: var(--text);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--provider) 70%, transparent);
	}
	.clear-filter {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-muted);
		min-height: 34px;
		cursor: pointer;
	}
	.clear-filter:hover {
		color: var(--text);
	}

	/* REGION 4 · STAT ROW — base 2-up, 4-up at >= 720px. */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 720px) {
		.stat-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	/* REGION 5 · VALUE BAND — base single column, 1fr 1fr at >= 860px. */
	.value-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 860px) {
		.value-grid {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	/* REGION 6 · HEATMAP */
	.heatmap-sec {
		margin-bottom: 1rem;
	}

	/* REGION 7 · MODEL / 5H GRID — base single column, 2fr 1fr at >= 860px. */
	.grid2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 860px) {
		.grid2 {
			grid-template-columns: 2fr 1fr;
			align-items: start;
		}
	}

	/* Shared panel surface. */
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
	}
	.panel-title {
		margin: 0 0 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
		display: flex;
		justify-content: space-between;
	}
	.model-break {
		margin-top: 1.1rem;
	}
	.empty {
		color: var(--text-dim);
		text-align: center;
		padding: 2rem 1rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.cap-sub {
		margin: 0.6rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.cap-recent {
		margin-top: 1rem;
	}
	.recent-blocks {
		list-style: none;
		margin: 0;
		padding: 0.7rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.recent-blocks li {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.blk-sub {
		color: var(--text-dim);
		font-size: 0.72rem;
	}

	/* REGION 7b · BY PROJECT — receipt-line rows, mono, right-aligned figures. */
	.by-project-sec {
		margin-bottom: 1rem;
	}
	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.project-list li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}
	.project-list li.unknown .proj-name {
		color: var(--text-dim);
		font-style: italic;
	}
	.proj-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		/* flex children default to min-width:auto, which defeats the ellipsis */
		min-width: 0;
	}
	.proj-caption {
		margin: -0.35rem 0 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
	}
	.proj-figs {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
		flex: none;
	}
	.proj-figs .num {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.proj-sub {
		color: var(--text-dim);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.proj-more {
		margin: 0.7rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-dim);
	}

	/* REGION 8 · SESSIONS */
	.sessions-sec {
		margin-bottom: 1rem;
	}

	/* REGION 9 · HONESTY FOOTER — receipt-honesty voice, mono. */
	.honesty {
		margin: 1.4rem 0 3rem;
		padding: 1.1rem 1.2rem;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
	}
	.honesty p {
		margin: 0 0 0.55rem;
	}
	.honesty strong {
		color: var(--text);
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
		margin-top: 0.75rem !important;
	}
	.cutover input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		padding: 0.35rem 0.5rem;
		font-family: var(--font-num);
		color-scheme: dark;
	}
</style>
