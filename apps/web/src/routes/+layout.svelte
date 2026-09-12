<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { startTheme } from '$lib/client/theme';
	onMount(startTheme);

	// Favicon / OG head tags live in src/app.html (they point at the generated
	// static asset set: icon.svg, favicon.ico, apple-touch-icon.png, manifest).

	let { children } = $props();
</script>

{@render children()}
