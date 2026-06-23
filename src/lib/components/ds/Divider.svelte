<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type DividerVariant = 'solid' | 'dashed' | 'dotted';

	export interface DividerProps {
		/** solid hairline · dashed receipt-cut · dotted coupon-split. */
		variant?: DividerVariant;
		/** Optional centered uppercase-mono label between two rules. */
		label?: Snippet;
	}
</script>

<script lang="ts">
	// chaching Divider — the receipt rule. `variant` picks the texture: solid
	// hairline / dashed receipt-cut / dotted coupon-split. No label → a real
	// `role="separator"`. With a label → two rules + a centered caps caption.
	// Inherits the border color so it works on both ink and `.paper`.
	let { variant = 'solid', label }: DividerProps = $props();
</script>

{#if label}
	<div class="labeled">
		<span class="rule {variant}"></span>
		<span class="caption">{@render label()}</span>
		<span class="rule {variant}"></span>
	</div>
{:else}
	<div class="rule {variant} full" role="separator"></div>
{/if}

<style>
	.rule {
		border-top-style: solid;
		border-top-width: 1px;
		border-top-color: var(--border);
	}
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
