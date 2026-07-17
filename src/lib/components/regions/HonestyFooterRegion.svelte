<script lang="ts">
	import { resolve } from '$app/paths';
	import type { FeedStore } from '$lib/client/feed.svelte';
	import { fmtDay, int } from '$lib/format';

	let { feed }: { feed: FeedStore } = $props();

	let snap = $derived(feed.snapshot);

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
</script>

<!-- REGION 9 · HONESTY FOOTER -->
{#if snap}
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
{/if}

<style>
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
