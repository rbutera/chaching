<script lang="ts">
	// The Till Stack mark: a register-slot diamond above two stacked cache
	// layers. Inline SVG so it inherits `currentColor` (drive the colour from a
	// parent's `color` / brand token, e.g. `color: var(--accent)`). Source of
	// truth for the paths is src/lib/brand/assets/mark.svg.
	let {
		size = 24,
		class: className,
		title = 'chaching'
	}: { size?: number; class?: string; title?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	role="img"
	aria-label={title}
	class={className}
>
	<title>{title}</title>
	<g fill="currentColor">
		<path fill-rule="evenodd" d="M12 1.5 22 6.1 12 10.7 2 6.1ZM9.2 5.35h5.6v1.5H9.2Z" />
		<path d="m2 10.35 10 4.6 10-4.6v3.2l-10 4.6-10-4.6Z" />
		<path d="m2 16.15 10 4.6 10-4.6v3.2L12 23.95 2 19.35Z" />
	</g>
</svg>
