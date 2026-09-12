// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { startTheme, setTheme, themePreference } from './theme';
import { themeBootstrap, themeIds } from '@chaching/shared/brand/palettes';
afterEach(() => vi.unstubAllGlobals());
it('bootstraps every palette and follows OS only in Auto, with cleanup and storage failure', () => {
	let listener = () => {};
	const media = {
		matches: false,
		addEventListener: vi.fn((_, fn) => {
			listener = fn;
		}),
		removeEventListener: vi.fn(),
	};
	vi.stubGlobal('matchMedia', () => media);
	localStorage.clear();
	for (const id of [...themeIds, 'bad']) {
		localStorage.setItem('chaching.theme.v1', id);
		new Function(themeBootstrap())();
		expect(document.documentElement.dataset.theme).toBe(id === 'bad' ? 'register-light' : id);
	}
	const stop = startTheme();
	media.matches = true;
	listener();
	expect(document.documentElement.dataset.theme).toBe('register-dark');
	setTheme('latte');
	media.matches = false;
	listener();
	expect(document.documentElement.dataset.theme).toBe('latte');
	window.dispatchEvent(new StorageEvent('storage', { key: 'chaching.theme.v1', newValue: 'auto' }));
	expect(document.documentElement.dataset.theme).toBe('register-light');
	const write = vi
		.spyOn(Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype, 'setItem')
		.mockImplementation(() => {
			throw Error('blocked');
		});
	expect(() => setTheme('mocha')).toThrow('blocked');
	expect(get(themePreference)).toBe('auto');
	write.mockRestore();
	stop();
	expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
});
