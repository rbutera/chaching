import { describe, it, expect } from 'vitest';
import { normalizeBasePath } from './base-path';

describe('normalizeBasePath', () => {
	it('treats empty / root / nullish as the empty base', () => {
		expect(normalizeBasePath('')).toBe('');
		expect(normalizeBasePath('/')).toBe('');
		expect(normalizeBasePath('   ')).toBe('');
		expect(normalizeBasePath(undefined)).toBe('');
		expect(normalizeBasePath(null)).toBe('');
	});

	it('adds a leading slash and strips a trailing one', () => {
		expect(normalizeBasePath('chaching')).toBe('/chaching');
		expect(normalizeBasePath('/chaching')).toBe('/chaching');
		expect(normalizeBasePath('/chaching/')).toBe('/chaching');
		expect(normalizeBasePath('chaching/')).toBe('/chaching');
	});

	it('preserves nested subpaths', () => {
		expect(normalizeBasePath('/tools/chaching/')).toBe('/tools/chaching');
		expect(normalizeBasePath('tools/chaching')).toBe('/tools/chaching');
	});

	it('collapses stray leading/trailing slashes', () => {
		expect(normalizeBasePath('///chaching///')).toBe('/chaching');
	});
});
