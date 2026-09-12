<script lang="ts">
	import type { FeedStore } from '../../client/feed.svelte';
	import type { Dashboard } from '../../client/dashboard.svelte';
	import SessionExplorer from '../SessionExplorer.svelte';
	import type { SortingState } from '@tanstack/svelte-table';

	let { feed, dash, search = $bindable(''), sorting = $bindable<SortingState | undefined>() }: {
		feed: FeedStore; dash: Dashboard; search?: string; sorting?: SortingState;
	} = $props();

	let snap = $derived(feed.snapshot);
	let explorerSessions = $derived(snap ? dash.scopedSessions(snap) : []);
</script>

<!-- REGION 8 · SESSIONS -->
{#if snap}
	<section class="sessions-sec" aria-label="Sessions">
		<div class="panel">
			<SessionExplorer
				bind:search
				bind:sorting
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
