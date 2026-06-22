<script lang="ts">
	// The horizontal lockup: the Till Stack mark + the "chaching" wordmark. The
	// mark renders in the brand accent (var(--accent), from chaching-brand-tokens);
	// the wordmark text uses the inherited foreground colour. Inline SVG mark so it
	// scales crisply and needs no extra request.
	import BrandMark from './BrandMark.svelte';

	let {
		size = 22,
		class: className
	}: { size?: number; class?: string } = $props();
</script>

<span class={['wordmark', className]}>
	<span class="mark" style={`--mark-size:${size}px`}>
		<BrandMark {size} title="chaching" />
	</span>
	<span class="text">chaching</span>
</span>

<style>
	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.mark {
		display: inline-flex;
		color: var(--accent);
		line-height: 0;
	}
	.text {
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--fg);
	}
</style>
