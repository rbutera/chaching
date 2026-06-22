<script lang="ts">
	import '../app.css';

	// Favicon / OG head tags live in src/app.html (they point at the generated
	// static asset set: icon.svg, favicon.ico, apple-touch-icon.png, manifest).

	let { children } = $props();
</script>

{@render children()}
