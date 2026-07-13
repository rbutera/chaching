<script lang="ts" module>
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import MoneyFigure from './MoneyFigure.svelte';

	export type KnownProvider = 'claude' | 'codex' | 'opencode' | 'cursor' | 'pi';

	export interface ProviderPillProps extends HTMLButtonAttributes {
		/** Known provider — sets hue + label automatically. */
		provider?: KnownProvider | string;
		/** Spend to show on the pill (optional). */
		amount?: number;
		/** Selected state — fills + inset ring. */
		active?: boolean;
		/** Override the auto label. */
		label?: string;
		/** Override the auto hue. */
		color?: string;
	}

	const PROVIDER_HUES = {
		claude: 'var(--p-claude)',
		codex: 'var(--p-codex)',
		opencode: 'var(--p-opencode)',
		cursor: 'var(--p-cursor)',
		pi: 'var(--p-pi)'
	} satisfies Record<KnownProvider, string>;

	const PROVIDER_LABELS = {
		claude: 'Claude Code',
		codex: 'Codex',
		opencode: 'OpenCode',
		cursor: 'Cursor',
		pi: 'Pi'
	} satisfies Record<KnownProvider, string>;
</script>

<script lang="ts">
	// chaching ProviderPill — a toggleable provider filter chip: a hue dot, the
	// provider name, and optional spend. A real `<button>` (keyboard + Enter/Space
	// free). Tinted in the provider's hue; `active` fills, adds an inset ring, and
	// sets `aria-pressed`. Known providers auto-resolve label + hue.
	let {
		provider = 'claude',
		amount,
		active = false,
		label,
		color,
		...rest
	}: ProviderPillProps = $props();

	const c = $derived(
		color ?? PROVIDER_HUES[provider as KnownProvider] ?? 'var(--m-other)'
	);
	const name = $derived(
		label ?? PROVIDER_LABELS[provider as KnownProvider] ?? provider
	);
</script>

<button
	type="button"
	class="pill"
	class:active
	style:--pill-c={c}
	aria-pressed={active}
	{...rest}
>
	<span class="dot"></span>
	<span class="name">{name}</span>
	{#if amount != null}
		<MoneyFigure amount={Number(amount) || 0} size="sm" />
	{/if}
</button>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		min-height: 34px;
		padding: 0 12px;
		border-radius: var(--radius-pill);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;

		border: 1px solid color-mix(in srgb, var(--pill-c) 42%, var(--border));
		background: color-mix(in srgb, var(--pill-c) 9%, var(--surface-2));
		color: var(--text-muted);
	}
	.pill:hover {
		background: color-mix(in srgb, var(--pill-c) 16%, var(--surface-2));
	}
	.pill.active {
		border-color: color-mix(in srgb, var(--pill-c) 70%, var(--border));
		background: color-mix(in srgb, var(--pill-c) 22%, var(--surface-2));
		color: var(--text);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pill-c) 60%, transparent);
	}
	.pill:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--pill-c);
		flex: 0 0 auto;
	}
	.pill.active .dot {
		box-shadow: 0 0 8px color-mix(in srgb, var(--pill-c) 70%, transparent);
	}

	/* the pill's MoneyFigure reads small + bold */
	.pill :global(.money) {
		font-size: var(--text-xs);
		font-weight: var(--fw-bold);
	}

	@media (prefers-reduced-motion: no-preference) {
		.pill {
			transition:
				background var(--dur-fast) var(--ease-out),
				color var(--dur-fast) var(--ease-out);
		}
	}
</style>
