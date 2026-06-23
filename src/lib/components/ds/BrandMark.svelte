<script lang="ts" module>
	export interface BrandMarkProps {
		/** Mark size in px (wordmark text scales from it). */
		size?: number;
		/** Render the full horizontal lockup (mark + "chaching"). */
		wordmark?: boolean;
		title?: string;
		/** Override the mark color (default brass `--accent`). */
		color?: string;
	}
</script>

<script lang="ts">
	// chaching BrandMark — the gold "Till Stack": a register-slot diamond above
	// two stacked cache-layer chevrons. Inline `<svg role="img">` + `<title>`;
	// fills with `currentColor` (default brass). `wordmark` renders the full
	// horizontal lockup. Paths are the source of truth shared with assets/mark.svg.
	let {
		size = 28,
		wordmark = false,
		title = 'chaching',
		color = 'var(--accent)'
	}: BrandMarkProps = $props();
</script>

{#snippet mark()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		role="img"
		aria-label={title}
		style:color
		style="display:block"
	>
		<title>{title}</title>
		<g fill="currentColor">
			<path fill-rule="evenodd" d="M12 1.5 22 6.1 12 10.7 2 6.1ZM9.2 5.35h5.6v1.5H9.2Z" />
			<path d="m2 10.35 10 4.6 10-4.6v3.2l-10 4.6-10-4.6Z" />
			<path d="m2 16.15 10 4.6 10-4.6v3.2L12 23.95 2 19.35Z" />
		</g>
	</svg>
{/snippet}

{#if wordmark}
	<span class="lockup" style:gap={`${size * 0.42}px`}>
		{@render mark()}
		<span class="text" style:font-size={`${size * 0.92}px`}>chaching</span>
	</span>
{:else}
	<span class="mark-only">{@render mark()}</span>
{/if}

<style>
	.mark-only {
		line-height: 0;
	}
	.lockup {
		display: inline-flex;
		align-items: center;
	}
	.text {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		letter-spacing: var(--tracking-tight);
		color: var(--text);
		line-height: 1;
	}
</style>
