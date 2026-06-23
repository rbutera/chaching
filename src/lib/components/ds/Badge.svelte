<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type BadgeTone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn' | 'info';

	export interface BadgeProps {
		/** Maps to the brand semantic ladders. good=savings, bad=burn. */
		tone?: BadgeTone;
		/** Fill instead of tint. */
		solid?: boolean;
		/** Prefix a glowing status dot. */
		dot?: boolean;
		children?: Snippet;
	}

	// Tone → token color. `accent` flips the solid text color to ink-on-gold.
	const TONE_VARS = {
		neutral: 'var(--text-muted)',
		accent: 'var(--accent)',
		good: 'var(--good)',
		bad: 'var(--bad)',
		warn: 'var(--warn)',
		info: 'var(--info)'
	} satisfies Record<BadgeTone, string>;
</script>

<script lang="ts">
	// chaching Badge — compact uppercase-mono status/label chip. `tone` maps to a
	// brand token; `solid` fills (else a color-mix tint); `dot` prefixes a
	// decorative status dot. Content is rendered uppercase via CSS.
	let { tone = 'neutral', solid = false, dot = false, children }: BadgeProps = $props();

	const c = $derived(TONE_VARS[tone] ?? TONE_VARS.neutral);
</script>

<span
	class="badge {tone}"
	class:solid
	style:--badge-c={c}
>
	{#if dot}<span class="dot" aria-hidden="true"></span>{/if}
	{@render children?.()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 9px;
		border-radius: var(--radius-pill);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: var(--fw-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		white-space: nowrap;

		/* tint (default) */
		background: color-mix(in srgb, var(--badge-c) 14%, var(--surface-2));
		color: var(--badge-c);
		border: 1px solid color-mix(in srgb, var(--badge-c) 38%, transparent);
	}

	/* solid fill — ink text by default, ink-on-gold for the accent tone */
	.badge.solid {
		background: var(--badge-c);
		color: var(--ink-950);
		border: 1px solid var(--badge-c);
	}
	.badge.solid.accent {
		color: var(--text-on-gold);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--badge-c);
		box-shadow: 0 0 6px color-mix(in srgb, var(--badge-c) 70%, transparent);
		flex: 0 0 auto;
	}
	/* in solid mode the dot follows the (ink) text color */
	.badge.solid .dot {
		background: currentColor;
	}
</style>
