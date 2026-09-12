<script lang="ts">
	import { palettes } from '@chaching/shared/brand/palettes';
	import { themePreference, setTheme } from '$lib/client/theme';
	let error = $state('');
	function change(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLSelectElement)) return;
		try { setTheme(input.value); error = ''; }
		catch { input.value = $themePreference; error = 'Could not save this theme. Browser storage may be blocked.'; }
	}
</script>

<label for="theme-choice">Theme</label>
<select id="theme-choice" value={$themePreference} onchange={change}>
	<option value="auto">Auto · follows system</option>
	{#each palettes as palette}<option value={palette.id}>{palette.name}</option>{/each}
</select>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	select { min-height: 44px; width: 100%; background: var(--surface-2); color: var(--text); border: 1px solid var(--text-dim); border-radius: var(--r-sm); padding: .5rem; font: inherit; }
	select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
	label { display: block; margin-bottom: .5rem; color: var(--text); }
	p { color: var(--bad); }
</style>
