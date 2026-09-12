<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface CardProps extends HTMLAttributes<HTMLDivElement> {
		/** Gold top hairline. */
		accent?: boolean;
		/** Gold-glow shadow — reserve for one hero moment per view. */
		glow?: boolean;
		/** Lift on hover; keyboard-focusable + activatable when an onclick is supplied. */
		interactive?: boolean;
		/** Default true; set false to control padding yourself. */
		padded?: boolean;
		children?: Snippet;
	}
</script>

<script lang="ts">
	// chaching Card — the dashboard panel. Warm-ink surface, hairline border,
	// precise radius, soft lift. `accent` adds a gold top hairline; `glow` swaps
	// to the gold-glow shadow; `interactive` lifts on hover and (when an onclick
	// is passed) becomes a keyboard-operable button: focusable + Enter/Space.
	let {
		accent = false,
		glow = false,
		interactive = false,
		padded = true,
		onclick,
		children,
		...rest
	}: CardProps = $props();

	// Only an interactive card with a handler takes part in the tab order and
	// keyboard activation. Decorative/interactive-styled cards without a handler
	// stay non-focusable (no fake button).
	const activatable = $derived(interactive && typeof onclick === 'function');

	function onkeydown(e: KeyboardEvent) {
		if (!activatable) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			(e.currentTarget as HTMLElement).click();
		}
	}
</script>

{#if activatable}
	<div
		class="card"
		class:accent
		class:glow
		class:interactive
		class:flush={!padded}
		role="button"
		tabindex="0"
		{onclick}
		{onkeydown}
		{...rest}
	>
		{#if accent}<span class="accent-bar" aria-hidden="true"></span>{/if}
		{@render children?.()}
	</div>
{:else}
	<div
		class="card"
		class:accent
		class:glow
		class:interactive
		class:flush={!padded}
		{...rest}
	>
		{#if accent}<span class="accent-bar" aria-hidden="true"></span>{/if}
		{@render children?.()}
	</div>
{/if}

<style>
	.card {
		position: relative;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-5);
		box-shadow: var(--shadow);
		overflow: hidden;
		cursor: default;
	}
	.card.flush {
		padding: 0;
	}
	.card.glow {
		box-shadow: var(--shadow-gold);
	}
	.card.interactive {
		cursor: pointer;
	}

	.accent-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, var(--accent), transparent 70%);
	}

	.card.interactive:hover {
		border-color: var(--border-strong);
	}
	.card[role='button']:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.card {
			transition:
				transform var(--dur) var(--ease-out),
				border-color var(--dur) var(--ease-out);
		}
		.card.interactive:hover {
			transform: translateY(-2px);
		}
	}
</style>
