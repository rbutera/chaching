import { writable } from 'svelte/store';
import { palettes, resolveTheme, themeIds } from '@chaching/shared/brand/palettes';

const key = 'chaching.theme.v1';
export const themePreference = writable('auto');
let preference = 'auto';
function normalize(value: string | null): string {
	return value && themeIds.includes(value) ? value : 'auto';
}
function apply(dark: boolean) {
	const id = resolveTheme(preference, dark);
	document.documentElement.dataset.theme = id;
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', palettes.find((p) => p.id === id)!.surfaces[0]);
	themePreference.set(preference);
}
export function setTheme(value: string): void {
	const next = normalize(value);
	localStorage.setItem(key, next);
	preference = next;
	apply(matchMedia('(prefers-color-scheme: dark)').matches);
}
export function startTheme(): () => void {
	const media = matchMedia('(prefers-color-scheme: dark)');
	try {
		preference = normalize(localStorage.getItem(key));
	} catch {
		preference = 'auto';
	}
	apply(media.matches);
	const changed = () => {
		if (preference === 'auto') apply(media.matches);
	};
	const stored = (event: StorageEvent) => {
		if (event.key !== key && event.key !== null) return;
		preference = normalize(event.newValue);
		apply(media.matches);
	};
	media.addEventListener('change', changed);
	window.addEventListener('storage', stored);
	return () => {
		media.removeEventListener('change', changed);
		window.removeEventListener('storage', stored);
	};
}
