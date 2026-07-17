<script lang="ts">
	import type { FeedStore } from '$lib/client/feed.svelte';
	import type { Dashboard } from '$lib/client/dashboard.svelte';
	import SessionExplorer from '$lib/components/SessionExplorer.svelte';

	let { feed, dash }: { feed: FeedStore; dash: Dashboard } = $props();

	let snap = $derived(feed.snapshot);
	let focusedDay = $derived(dash.focusedDay);

	// The explorer is cross-day by default (design D6): all banked sessions, frozen ∪ live.
	// A pinned focusedDay deep-links it to that single day (design D8 drill-target scope).
	let explorerSessions = $derived(
		snap ? (focusedDay ? dash.focusedSessions(snap, focusedDay) : dash.allSessions(snap)) : []
	);
</script>

<!-- REGION 8 · SESSIONS -->
{#if snap}
	<section class="sessions-sec" aria-label="Sessions">
		<div class="panel">
			<SessionExplorer
				sessions={explorerSessions}
				now={snap.generatedAt || Date.now()}
				onOpen={(s) => dash.openSessionDrill(s)}
			/>
		</div>
	</section>
{/if}

<style>
	/* REGION 8 · SESSIONS */
	.sessions-sec {
		margin-bottom: 1rem;
	}
	/* Shared panel surface. */
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		box-shadow: var(--shadow);
	}
</style>
