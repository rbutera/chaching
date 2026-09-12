<script lang="ts">
	import { onMount } from 'svelte';
	import type { SortingState } from '@tanstack/svelte-table';
	import { resolve } from '$app/paths';
	import { FeedStore } from '../lib/client/feed.svelte';
	import { Dashboard } from '../lib/client/dashboard.svelte';
	import DetailSheet from '../lib/components/DetailSheet.svelte';
	import Button from '../lib/components/ds/Button.svelte';
	import PlanSettings from '../lib/components/PlanSettings.svelte';
	import DataSettings from '../lib/components/DataSettings.svelte';
	import SyncPanel from '../lib/components/SyncPanel.svelte';
	import HeroRegion from '../lib/components/regions/HeroRegion.svelte';
	import CommandBar from '../lib/components/CommandBar.svelte';
	import StatRowRegion from '../lib/components/regions/StatRowRegion.svelte';
	import ValueBandRegion from '../lib/components/regions/ValueBandRegion.svelte';
	import LifetimeRegion from '../lib/components/regions/LifetimeRegion.svelte';
	import SpendOverview from '../lib/components/regions/SpendOverview.svelte';
	import SpendChart from '../lib/components/regions/SpendChart.svelte';
	import QuotaRegion from '../lib/components/regions/QuotaRegion.svelte';
	import SessionExplorer from '../lib/components/SessionExplorer.svelte';
	import HeatmapRegion from '../lib/components/regions/HeatmapRegion.svelte';
	import ByModelRegion from '../lib/components/regions/ByModelRegion.svelte';
	import ByProjectRegion from '../lib/components/regions/ByProjectRegion.svelte';
	import SessionsRegion from '../lib/components/regions/SessionsRegion.svelte';
	// Register & Receipt design-system primitives (chaching-ds-components).
	import BrandMark from '../lib/components/ds/BrandMark.svelte';
	import type { SubsidisedProvider } from '@chaching/shared/subsidisation';
	import type { PublicchachingConfig } from '@chaching/shared/config';
	import type { SyncAction, SyncStatusView } from '../lib/client/sync';
	// Baked at build time (Vite JSON import) — the header version badge.
	const version = __CHACHING_VERSION__;
	// Shared voice (escalation ladder) — the joy crossings key off the same ladder.
	import {
		tierIndex,
		crossedUp,
		DAILY_FLOURISHES,
		LIFETIME_FLOURISHES
	} from '@chaching/shared/voice/index';
	import { JoyController } from '../lib/client/joy';
	import { webSuppressArt, setWebSuppressArt } from '../lib/client/suppress';

	const feed = new FeedStore();
	const dash = new Dashboard();
	let section = $state<'Dashboard' | 'Explore' | 'Settings'>('Dashboard');
	let sessionSearch = $state('');
	let sessionSorting = $state<SortingState>([{ id: 'recency', desc: true }]);
	function exploreRecentSessions() {
		sessionSearch = '';
		sessionSorting = [{ id: 'recency', desc: true }];
		section = 'Explore';
	}
	let now = $state(Date.now());


	// The persisted public config (carries the per-provider subscription block). The
	// subsidisation card + tier switcher are controlled off this local copy; a tier
	// change POSTs to /api/config and merges the echoed config back in. Held separate
	// from the feed snapshot so a live SSE delta and a tier write never reset each other.
	let config = $state<PublicchachingConfig | null>(null);
	let syncStatus = $state<SyncStatusView | null>(null);
	let syncRevision = 0;

	async function loadPublicConfig() {
		try {
			const res = await fetch(resolve('/api/config'));
			if (res.ok) config = (await res.json()) as PublicchachingConfig;
		} catch {
			/* config stays null → cards fall back to defaults */
		}
	}

	async function loadSyncStatus() {
		const revision = syncRevision;
		try {
			const res = await fetch(resolve('/api/sync'));
			if (res.ok) {
				const status = (await res.json()) as SyncStatusView;
				if (revision === syncRevision) syncStatus = status;
			}
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
		syncRevision += 1;
		syncStatus = body;
		if (action.action === 'create' || action.action === 'join' || action.action === 'leave') {
			dash.clearPoolFilters();
		}
		// The server resets its singleton after every sync mutation so changed
		// mappings are used for the very next record. Reconnect to that fresh engine.
		feed.stop();
		feed.start();
		await loadPublicConfig();
	}

	// Honour prefers-reduced-motion in JS (the count-up must render the final value
	// immediately when reduced; the token base reset already nukes CSS transitions).
	let systemReducedMotion = $state(false);
	let motionDisabled = $state(false);
	let reducedMotion = $derived(systemReducedMotion || motionDisabled);
	let preferenceError = $state('');

	function togglePersonality(input: HTMLInputElement) {
		try {
			setWebSuppressArt(!suppressArt);
			suppressArt = webSuppressArt();
			preferenceError = '';
		} catch {
			preferenceError = 'Could not save this preference. Browser storage may be blocked.';
		} finally {
			input.checked = !suppressArt;
		}
	}

	function toggleMotion(input: HTMLInputElement) {
		try {
			localStorage.setItem('chaching.reducedMotion', motionDisabled ? '0' : '1');
			motionDisabled = !motionDisabled;
			preferenceError = '';
		} catch {
			preferenceError = 'Could not save this preference. Browser storage may be blocked.';
		} finally {
			input.checked = !reducedMotion && !suppressArt;
		}
	}

	// Web "no-art" equivalent (design D9): suppress personality copy + extra motion
	// when `?no-art` or the persisted setting is on, mirroring the CLI contract.
	let suppressArt = $state(false);

	onMount(() => {
		feed.start();
		const dayClock = setInterval(() => {
			now = Date.now();
			dash.today = new Date(now).toISOString().slice(0, 10);
		}, 1000);
		void loadPublicConfig();
		let disposed = false;
		let quotaTimer: ReturnType<typeof setTimeout>;
		async function refreshQuotas() {
			await loadSyncStatus();
			if (!disposed) quotaTimer = setTimeout(refreshQuotas, 30_000);
		}
		void refreshQuotas();
		suppressArt = webSuppressArt();
		try { motionDisabled = localStorage.getItem('chaching.reducedMotion') === '1'; } catch { /* Storage is optional. */ }
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		systemReducedMotion = mq.matches;
		const onMq = (e: MediaQueryListEvent) => (systemReducedMotion = e.matches);
		mq.addEventListener('change', onMq);
		return () => {
			disposed = true;
			clearTimeout(quotaTimer);
			feed.stop();
			clearInterval(dayClock);
			mq.removeEventListener('change', onMq);
		};
	});

	let snap = $derived(feed.snapshot);
	let recentSessions = $derived(snap ? dash.scopedSessions(snap).toSorted((a,b) => b.lastTs - a.lastTs).slice(0,5) : []);

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

	// Register-heat (escalation-ladder chrome — design decision 5, task 4.3): warm the
	// structural chrome brass→ember from the EXISTING voice ladder (tierIndex over
	// DAILY_FLOURISHES). The ladder is a DAILY one, so feed it a DAILY amount, not the
	// selected period's total (a week/month total saturates the daily ladder at ember
	// and the range never shows). Use the pinned day when one is pinned, else the
	// latest day (today) — so the register warms as today heats up, independent of the
	// period you're viewing. No new spend-threshold logic; no displayed number changes.
	let heatDayCost = $derived(
		focusedDay
			? (focusedTotals?.cost ?? 0)
			: snap?.latestDay
				? (dash.focusedTotals(snap, snap.latestDay)?.cost ?? 0)
				: 0
	);
	let registerHeat = $derived(
		tierIndex(heatDayCost, DAILY_FLOURISHES) / (DAILY_FLOURISHES.length - 1)
	);

	let feeSaving = $state(false);

	async function onTierChange(id: string, name: string, tier: string, monthlyUsd: number) {
		feeSaving = true;
		try {
			const res = await fetch(resolve('/api/config'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ account: { id, name, tier, monthlyUsd } })
			});
			if (!res.ok) throw new Error(`Could not save the fee (${res.status}). Try again.`);
			config = await res.json();
		} finally {
			feeSaving = false;
		}
	}

	async function onMatchAccount(discoveredId: string, legacyId: string | null) {
		feeSaving = true;
		try {
			const res = await fetch(resolve('/api/config'), {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ match: { discoveredId, legacyId } })
			});
			if (!res.ok) throw new Error(`Could not match the Account (${res.status}).`);
			config = await res.json();
		} finally { feeSaving = false; }
	}

	let accountError = $state('');
	async function addAccount(provider: SubsidisedProvider) {
		feeSaving = true;
		accountError = '';
		try {
			const res = await fetch(resolve('/api/config'), {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ account: { provider, name: provider === 'claude' ? 'Claude' : 'Codex', tier: 'unknown', monthlyUsd: null } })
			});
			if (!res.ok) throw new Error(`Could not add the Account (${res.status}).`);
			config = await res.json();
		} catch (error) { accountError = error instanceof Error ? error.message : 'Could not add the Account.'; }
		finally { feeSaving = false; }
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

<div class="page" class:still={reducedMotion || suppressArt} style="--register-heat: {registerHeat}">
	<header class="topbar">
		<div class="brand">
			<h1 class="brand-title"><BrandMark size={24} wordmark title="chaching" /></h1>
			<span class="ver" title="chaching version">v{version}</span>

		</div>
		<nav aria-label="Main navigation">{#each ['Dashboard', 'Explore', 'Settings'] as label}<button class:active={section === label} onclick={() => { if(label === 'Dashboard' || label === 'Explore' || label === 'Settings') section = label; }}>{label}</button>{/each}</nav>
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
			{#if section === 'Settings'}
				<h2>Settings</h2>
				<section class="preferences" aria-labelledby="appearance-heading">
					<h3 id="appearance-heading">Appearance</h3>
					<label><span>Personality<small>Remarks and emoji, including room to grow.</small></span><input type="checkbox" checked={!suppressArt} onchange={(event) => togglePersonality(event.currentTarget)}/></label>
					<label><span>Animations<small>{systemReducedMotion ? 'Reduced motion is enabled in your system settings.' : suppressArt ? 'Paused while personality is off.' : 'Rolling numbers and moving charts.'}</small></span><input type="checkbox" checked={!reducedMotion && !suppressArt} disabled={systemReducedMotion || suppressArt} onchange={(event) => toggleMotion(event.currentTarget)}/></label>
					<label><span>Celebrations<small>Chime and confetti at milestones.</small></span><input type="checkbox" checked={joyEnabled} disabled={suppressArt} onchange={toggleJoy}/></label>
					{#if joyEnabled}<label><span>Mute chime<small>Keep celebrations silent.</small></span><input type="checkbox" checked={joyMuted} disabled={suppressArt} onchange={toggleMute}/></label>{/if}
					{#if preferenceError}<p role="alert">{preferenceError}</p>{/if}
				</section>
				<SyncPanel status={syncStatus} onAction={onSyncAction}/>
				{#if config}
					<DataSettings snapshot={snap}/>
					<section class="plan-settings" aria-label="Plans and fees">
						<h3>Plans and fees</h3>
						{#each config.accounts as account (account.id)}
							<PlanSettings {account} matches={config.accounts.filter(item => account.pendingLegacyIds?.includes(item.id))} busy={feeSaving || syncStatus?.managementAllowed === false} onSave={onTierChange} onMatch={onMatchAccount}/>
						{/each}
						{#if syncStatus?.managementAllowed === false}<p class="hint">Open Chaching on its host to edit Accounts.</p>{/if}
						<div><Button variant="secondary" disabled={feeSaving || syncStatus?.managementAllowed === false} onclick={() => addAccount('claude')}>Add Claude Account</Button> <Button variant="secondary" disabled={feeSaving || syncStatus?.managementAllowed === false} onclick={() => addAccount('codex')}>Add Codex Account</Button></div>
						{#if accountError}<p role="alert">{accountError}</p>{/if}
					</section>
				{/if}
			{:else if section === 'Explore'}
				<h2>Explore</h2>
				<CommandBar {feed} {dash} {syncStatus}/>
				<HeroRegion {feed} {dash} reducedMotion={reducedMotion || suppressArt} {suppressArt}/>
				<StatRowRegion {feed} {dash}/>
				<HeatmapRegion {feed} {dash}/>
				<ByModelRegion {feed} {dash} {syncStatus} {suppressArt} reducedMotion={reducedMotion || suppressArt}/>
				<ByProjectRegion {feed} {dash} reducedMotion={reducedMotion || suppressArt}/>
				<SessionsRegion {feed} {dash} bind:search={sessionSearch} bind:sorting={sessionSorting}/>
				<LifetimeRegion {feed} {dash}/>
			{:else}
				<SpendOverview {feed} {dash} {reducedMotion} {suppressArt}/>
				<CommandBar {feed} {dash} {syncStatus}/>
				<SpendChart {feed} {dash} reducedMotion={reducedMotion || suppressArt}/>
				<QuotaRegion {dash} {syncStatus} {now} reducedMotion={reducedMotion || suppressArt}/>
				<section aria-label="Recent sessions"><div class="section-heading"><h2>Sessions</h2><button onclick={exploreRecentSessions}>View all →</button></div><SessionExplorer compact sessions={recentSessions} now={snap.generatedAt} onOpen={s => dash.openSessionDrill(s)}/></section>
				<ValueBandRegion {feed} {dash} {config} {syncStatus}/>
			{/if}
		</main>
	{/if}

{#if snap && dash.drill}
	<DetailSheet drill={dash.drill} snapshot={snap} scope={dash} onClose={() => dash.closeDrill()} />
{/if}
</div>

<style>
	.plan-settings {max-width:720px;display:grid;gap:16px}
	.plan-settings h3 {font-size:18px;margin:0}
	.preferences {border:1px solid var(--border);border-radius:var(--radius);padding:20px;max-width:720px}
	.preferences h3 {font-size:18px;margin:0 0 12px}
	.preferences label {display:flex;justify-content:space-between;align-items:center;gap:24px;padding:12px 0;border-top:1px solid var(--border);font-size:14px;cursor:pointer}
	.preferences small {display:block;color:var(--text-muted);font-size:12px;margin-top:4px}
	.preferences input {accent-color:var(--accent);width:18px;height:18px;flex:none}
	.preferences p {color:var(--bad)}
	.page.still :global(*), .page.still :global(*::before), .page.still :global(*::after) {animation:none !important;transition:none !important;scroll-behavior:auto !important}
	.page{max-width:1440px;margin:auto;padding:0 40px 40px}.topbar{display:flex;align-items:center;gap:28px;padding:8px 0;border-bottom:1px solid var(--border)}.brand{display:flex;align-items:center;gap:10px}.brand-title{margin:0}.ver{font:var(--type-label);color:var(--text-muted)}nav{display:flex;gap:20px}button{font:inherit;cursor:pointer;color:var(--text);background:none;border:0;min-height:36px}nav button{color:var(--text-muted)}nav button.active{color:var(--text);box-shadow:0 2px var(--accent)}button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.topbar-right{margin-left:auto;display:flex;align-items:center;gap:16px}.joy-controls{display:flex;gap:6px;font-size:11px}.conn{display:flex;align-items:center;gap:6px;font:var(--type-label)}.dot{width:6px;height:6px;border-radius:50%}main{display:grid;gap:20px;padding-top:16px;min-width:0}.section-heading{display:flex;justify-content:space-between;align-items:center}h2{font:var(--type-title)}.loading{min-height:65vh;display:grid;align-content:center;justify-items:center;text-align:center}.loading-sub{color:var(--text-muted);font-size:12px}.spinner{width:24px;height:24px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}@media(max-width:760px){.page{padding:0 16px 24px}.topbar{gap:12px;flex-wrap:wrap}.ver,.conn-txt{display:none}nav{gap:12px}nav button{font-size:12px}.topbar-right{gap:8px}.joy-controls{display:none}main{gap:16px}}@media(max-width:500px){.topbar-right{display:none}.brand :global(svg){max-width:105px}nav{margin-left:auto;gap:8px}}
	@media(max-height:650px){main{gap:8px;padding-top:8px}}
</style>
