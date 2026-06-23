// @vitest-environment jsdom
/**
 * Tests for the web "no-art" equivalent (design D9, scenario row 22).
 * The web mirrors the CLI suppression BEHAVIOUR via a `?no-art` query param or a
 * persisted `chaching.noArt` setting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { webSuppressArt } from './suppress.js';

function setSearch(search: string) {
	window.history.replaceState({}, '', `/${search}`);
}

describe('webSuppressArt', () => {
	beforeEach(() => {
		setSearch('');
		window.localStorage.clear();
	});
	afterEach(() => {
		setSearch('');
		window.localStorage.clear();
	});

	it('default (no param, no setting) = not suppressed', () => {
		expect(webSuppressArt()).toBe(false);
	});

	it('?no-art (bare) suppresses', () => {
		setSearch('?no-art');
		expect(webSuppressArt()).toBe(true);
	});

	it('?no-art=1 suppresses', () => {
		setSearch('?no-art=1');
		expect(webSuppressArt()).toBe(true);
	});

	it('?no-art=0 / =false does NOT suppress', () => {
		setSearch('?no-art=0');
		expect(webSuppressArt()).toBe(false);
		setSearch('?no-art=false');
		expect(webSuppressArt()).toBe(false);
	});

	it('persisted chaching.noArt setting suppresses', () => {
		window.localStorage.setItem('chaching.noArt', '1');
		expect(webSuppressArt()).toBe(true);
	});

	it('persisted "0" does not suppress', () => {
		window.localStorage.setItem('chaching.noArt', '0');
		expect(webSuppressArt()).toBe(false);
	});
});
