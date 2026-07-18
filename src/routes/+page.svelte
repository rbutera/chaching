<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { FeedStore } from '$lib/client/feed.svelte';
	import { Dashboard } from '$lib/client/dashboard.svelte';
	import DetailSheet from '$lib/components/DetailSheet.svelte';
	import SyncPanel from '$lib/components/SyncPanel.svelte';
	import HeroRegion from '$lib/components/regions/HeroRegion.svelte';
	import CommandBar from '$lib/components/CommandBar.svelte';
	import SummaryRail from '$lib/components/SummaryRail.svelte';
	import StatRowRegion from '$lib/components/regions/StatRowRegion.svelte';
	import ValueBandRegion from '$lib/components/regions/ValueBandRegion.svelte';
	import LifetimeRegion from '$lib/components/regions/LifetimeRegion.svelte';
	import HeatmapRegion from '$lib/components/regions/HeatmapRegion.svelte';
	import ByModelRegion from '$lib/components/regions/ByModelRegion.svelte';
	import ByProjectRegion from '$lib/components/regions/ByProjectRegion.svelte';
	import SessionsRegion from '$lib/components/regions/SessionsRegion.svelte';
	import HonestyFooterRegion from '$lib/components/regions/HonestyFooterRegion.svelte';
	// Register & Receipt design-system primitives (chaching-ds-components).
	import BrandMark from '$lib/components/ds/BrandMark.svelte';
	import type { SubsidisedProvider } from '$lib/core/subsidisation';
	import type { PublicchachingConfig } from '$lib/core/config';
	import type { SyncAction, SyncStatusView } from '$lib/client/sync';
	// Baked at build time (Vite JSON import) — the header version badge.
	import { version } from '../../package.json';
	// Shared voice (escalation ladder) — the joy crossings key off the same ladder.
	import {
		tierIndex,
		crossedUp,
		DAILY_FLOURISHES,
		LIFETIME_FLOURISHES
	} from '$lib/voice';
	import { JoyController } from '$lib/client/joy';
	import { webSuppressArt } from '$lib/client/suppress';

	const feed = new FeedStore();
	const dash = new Dashboard();

	// The persisted public config (carries the per-provider subscription block). The
	// subsidisation card + tier switcher are controlled off this local copy; a tier
	// change POSTs to /api/config and merges the echoed config back in. Held separate
	// from the feed snapshot so a live SSE delta and a tier write never reset each other.
	let config = $state<PublicchachingConfig | null>(null);
	let syncStatus = $state<SyncStatusView | null>(null);

	async function loadPublicConfig() {
		try {
			const res = await fetch(resolve('/api/config'));
			if (res.ok) config = (await res.json()) as PublicchachingConfig;
		} catch {
			/* config stays null → cards fall back to defaults */
		}
	}

	async function loadSyncStatus() {
		try {
			const res = await fetch(resolve('/api/sync'));
			if (res.ok) syncStatus = (await res.json()) as SyncStatusView;
		} catch {
			/* sync stays unavailable; the local dashboard remains fully usable */
		}
	}

	async function onSyncAction(action: SyncAction): Promise<void> {
		const res = await fetch(resolve('/api/sync'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(action)
		});
		const body = (await res.json().catch(() => ({}))) as SyncStatusView & { error?: string };
		if (!res.ok) throw new Error(body.error || `Sync request failed (${res.status}).`);
		syncStatus = body;
		if (action.action === 'create' || action.action === 'join' || action.action === 'leave') {
			dash.clearPoolFilters();
		}
		// The server resets its singleton after every sync mutation so changed
		// mappings are used for the very next record. Reconnect to that fresh engine.
		feed.stop();
		feed.start();
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
		void loadSyncStatus();
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

	// The zoomed-in pin (null = rolling-period mode). Retained at page level for the
	// joy escalation chain and the arrow-key day stepper; regions derive their own.
	let focusedDay = $derived(dash.focusedDay);

	// Clamp/clear a persisted out-of-range pin once the snapshot (and its data range) lands.
	$effect(() => {
		if (snap) dash.reconcileFocusedDay(snap);
	});

	// hero chain retained at page level only for the cross-cutting joy effect (heroCost).
	// The hero's own figure, delta, receipt action, sparkline, count-up cadence, and
	// flourish live in HeroRegion.
	let hero = $derived(snap ? dash.heroTotals(snap) : null);
	let focusedTotals = $derived(snap && focusedDay ? dash.focusedTotals(snap, focusedDay) : null);
	let heroCost = $derived(focusedTotals ? focusedTotals.cost : (hero?.current.cost ?? 0));

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
		<!-- Bento layout: a persistent summary rail (left, sticky on desktop) plus
		     named grid zones — cmd / rail / now / money / history / pool / ledger.
		     On narrow widths the grid collapses to one column and stacks in the
		     deliberate order now → money → history → pool → ledger, with the rail
		     folded to the top under the command bar (design decision 4). -->
		<main class="bento">
			<div class="slot-cmd">
				<CommandBar {feed} {dash} {syncStatus} />
			</div>

			<div class="slot-rail">
				<SummaryRail {feed} {dash} />
			</div>

			<div class="zone-now">
				<HeroRegion {feed} {dash} {reducedMotion} {suppressArt} />
				<StatRowRegion {feed} {dash} />
			</div>

			<div class="zone-money">
				<ValueBandRegion {feed} {dash} {config} {syncStatus} {onTierChange} />
				<LifetimeRegion {feed} {dash} />
			</div>

			<div class="zone-history">
				<HeatmapRegion {feed} {dash} />
				<ByModelRegion {feed} {dash} {syncStatus} />
				<ByProjectRegion {feed} {dash} />
			</div>

			<div class="zone-pool">
				<SyncPanel status={syncStatus} onAction={onSyncAction} />
			</div>

			<div class="zone-ledger">
				<SessionsRegion {feed} {dash} />
				<HonestyFooterRegion {feed} />
			</div>
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

	/* ── Bento layout ────────────────────────────────────────────────────────
	   Narrow-first: a single column that stacks the command bar, then the folded
	   rail, then the content zones in the deliberate order now → money → history
	   → pool → ledger. At ≥1100px it becomes a two-column instrument: a persistent
	   sticky rail on the left, the command bar + zones on the right. CSS-only —
	   grid-template-areas + a container query per zone for internal density; no
	   layout library (design decision 4). Region INTERNALS are untouched in this
	   wave; this is structure only. */
	.bento {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'cmd'
			'rail'
			'now'
			'money'
			'history'
			'pool'
			'ledger';
		gap: var(--bento-gap);
	}
	.slot-cmd {
		grid-area: cmd;
		/* The command bar sticks under the topbar while the page scrolls. Sticky must
		   live HERE, on the grid item, not on `.command-bar` inside it: a sticky box's
		   containing block is its parent's content box, and `.slot-cmd`'s parent is the
		   `.bento` grid container — which spans the whole page, giving the box the
		   scroll travel it needs. Put on `.command-bar` instead, the containing block
		   is `.slot-cmd`, which is exactly the bar's own height, so it has no room to
		   move and never sticks. (The sibling `.slot-rail` sticks the same way.) */
		position: sticky;
		top: 58px;
		z-index: 8;
	}
	.slot-rail {
		grid-area: rail;
	}
	.zone-now {
		grid-area: now;
	}
	.zone-money {
		grid-area: money;
	}
	.zone-history {
		grid-area: history;
	}
	.zone-pool {
		grid-area: pool;
	}
	.zone-ledger {
		grid-area: ledger;
	}
	/* Each content zone is a query container so its regions can respond to the
	   zone's own width (the rail column narrows the right side on desktop). The
	   density rules themselves land in the restyle wave. */
	.zone-now,
	.zone-money,
	.zone-history,
	.zone-pool,
	.zone-ledger {
		container-type: inline-size;
	}

	@media (min-width: 1100px) {
		.bento {
			grid-template-columns: var(--rail-w) minmax(0, 1fr);
			grid-template-areas:
				'rail cmd'
				'rail now'
				'rail money'
				'rail history'
				'rail pool'
				'rail ledger';
			column-gap: var(--bento-gap);
			align-items: start;
		}
		/* The rail is persistently visible: it sticks under the topbar (top:58px,
		   level with the command bar in the adjacent column) while the zones
		   scroll past it. */
		.slot-rail {
			position: sticky;
			top: 58px;
			align-self: start;
		}
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
</style>
