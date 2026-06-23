<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export type DividerVariant = 'solid' | 'dashed' | 'dotted';

	export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
		/** solid hairline · dashed receipt-cut · dotted coupon-split. */
		variant?: DividerVariant;
		/** Optional centered uppercase-mono label between two rules (snippet or string). */
		label?: Snippet | string;
	}
</script>

<script lang="ts">
	// chaching Divider — the receipt rule. `variant` picks the texture: solid
	// hairline / dashed receipt-cut / dotted coupon-split. No label → a real
	// `role="separator"`. With a label → two rules + a centered caps caption.
	// Inherits the border color so it works on both ink and `.paper`.
	let { variant = 'solid', label, ...rest }: DividerProps = $props();
</script>

{#if label}
	<div class="labeled" {...rest}>
		<span class="rule {variant}"></span>
		<span class="caption">
			{#if typeof label === 'function'}{@render label()}{:else}{label}{/if}
		</span>
		<span class="rule {variant}"></span>
	</div>
{:else}
	<div class="rule {variant} full" role="separator" {...rest}></div>
{/if}

<style>
	.rule.solid {
		border-top: 1px solid var(--border);
	}
	.rule.dashed {
		border-top: 1.5px dashed var(--border-strong);
	}
	.rule.dotted {
		border-top: 2px dotted var(--border-strong);
	}
	.full {
		width: 100%;
	}

	.labeled {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.labeled .rule {
		flex: 1;
	}
	.caption {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-dim);
		white-space: nowrap;
	}
</style>
