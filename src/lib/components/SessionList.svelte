<script lang="ts">
	import type { SessionSummary } from '$lib/types';
	import { money, compactTokens, modelColor, modelLabel, fmtDateTime, shortProject } from '$lib/format';
	import { totalTokens } from '$lib/core/aggregate';

	let {
		sessions,
		onOpen,
		limit = 12
	}: {
		sessions: SessionSummary[];
		onOpen: (s: SessionSummary) => void;
		limit?: number;
	} = $props();

	let shown = $derived(sessions.slice(0, limit));
</script>

<div class="list-wrap">
	<h2 class="title">Recent sessions</h2>
	<ul class="list">
		{#each shown as s (s.sessionId)}
			<li>
				<button class="row" onclick={() => onOpen(s)}>
					<span class="dots" aria-hidden="true">
						{#each s.models.slice(0, 3) as m (m)}
							<span class="dot" style={`background:${modelColor(m)}`}></span>
						{/each}
					</span>
					<span class="meta">
						<span class="proj">{shortProject(s.project)}</span>
						<span class="when">{fmtDateTime(s.lastTs)} · {modelLabel(s.models[0] ?? '')}</span>
					</span>
					<span class="figs">
						<span class="cost num">{money(s.cost)}</span>
						<span class="tok num">{compactTokens(totalTokens(s.tokens))} tok</span>
					</span>
				</button>
			</li>
		{:else}
			<li class="empty">No sessions in scope.</li>
		{/each}
	</ul>
</div>

<style>
	.list-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.title {
		font-size: 0.8rem;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
		font-weight: 600;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.7rem;
		align-items: center;
		width: 100%;
		text-align: left;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.8rem;
		min-height: 48px;
		transition: border-color 0.15s;
	}
	.row:hover {
		border-color: var(--border-strong);
	}
	.dots {
		display: flex;
		gap: 3px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.proj {
		font-size: 0.88rem;
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when {
		font-size: 0.74rem;
		color: var(--fg-dim);
	}
	.figs {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.cost {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.tok {
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
	.empty {
		color: var(--fg-dim);
		font-size: 0.85rem;
		padding: 1rem;
		text-align: center;
	}
</style>
