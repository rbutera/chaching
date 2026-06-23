<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
	export type ButtonSize = 'sm' | 'md' | 'lg';

	export interface ButtonProps extends HTMLButtonAttributes {
		/** Visual weight. `primary` is brass gold; use it once per view. */
		variant?: ButtonVariant;
		size?: ButtonSize;
		/** Stretch to container width. */
		full?: boolean;
		disabled?: boolean;
		/** Leading icon snippet (e.g. a Lucide SVG). */
		icon?: Snippet;
		/** Trailing icon snippet. */
		iconRight?: Snippet;
		children?: Snippet;
	}
</script>

<script lang="ts">
	// chaching Button — the register key. Primary is brass gold on warm ink with a
	// physical press (shrink + darken). Mono label, tight tracking. Hover/press
	// are CSS-only (cheaper than JS state, free keyboard + reduced-motion).
	let {
		variant = 'primary',
		size = 'md',
		full = false,
		disabled = false,
		type = 'button',
		icon,
		iconRight,
		children,
		...rest
	}: ButtonProps = $props();
</script>

<button
	{type}
	{disabled}
	class="btn {variant} {size}"
	class:full
	{...rest}
>
	{#if icon}<span class="icon">{@render icon()}</span>{/if}
	{@render children?.()}
	{#if iconRight}<span class="icon">{@render iconRight()}</span>{/if}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: auto;
		font-family: var(--font-mono);
		font-weight: var(--fw-semibold);
		letter-spacing: var(--tracking-snug);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transform: scale(1);
	}
	.btn.full {
		width: 100%;
	}
	.btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.icon {
		display: inline-flex;
		line-height: 0;
	}

	/* sizes */
	.sm {
		height: 32px;
		padding: 0 12px;
		font-size: var(--text-xs);
	}
	.md {
		height: 40px;
		padding: 0 16px;
		font-size: var(--text-sm);
	}
	.lg {
		height: 48px;
		padding: 0 22px;
		font-size: var(--text-base);
	}

	/* variants */
	.primary {
		background: var(--accent);
		color: var(--text-on-gold);
		border: 1px solid var(--accent);
	}
	.secondary {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border-strong);
	}
	.ghost {
		background: transparent;
		color: var(--text-muted);
		border: 1px solid transparent;
	}
	.danger {
		background: color-mix(in srgb, var(--bad) 16%, var(--surface-2));
		color: var(--bad);
		border: 1px solid color-mix(in srgb, var(--bad) 45%, var(--border));
	}

	/* hover (only when enabled) */
	.primary:hover:not(:disabled) {
		background: var(--accent-bright);
		border-color: var(--accent-bright);
	}
	.secondary:hover:not(:disabled) {
		border-color: var(--accent-line);
		color: var(--text);
	}
	.ghost:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--text);
	}
	.danger:hover:not(:disabled) {
		border-color: var(--accent-line);
		color: var(--text);
	}

	/* keyboard focus ring — 2px gold outline with offset */
	.btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* physical press + transitions only when motion is welcome */
	@media (prefers-reduced-motion: no-preference) {
		.btn {
			transition:
				transform var(--dur-fast) var(--ease-snap),
				background var(--dur-fast) var(--ease-out),
				border-color var(--dur-fast) var(--ease-out),
				color var(--dur-fast) var(--ease-out);
		}
		.btn:active:not(:disabled) {
			transform: scale(0.97);
		}
	}
</style>
