import { describe, it, expect } from 'vitest';
import { wcagContrast } from 'culori';
import { palettes, paletteVars, semanticGroups, resolveTheme } from './palettes';
import { modelColor, providerColor, modelHex } from '../format';

describe.each(palettes)('$name', (palette) => {
	it('keeps text readable and accents visible across every surface', () => {
		const vars = paletteVars(palette);
		expect(wcagContrast(vars['text-on-gold'], vars.accent)).toBeGreaterThanOrEqual(4.5);
		for (const names of Object.values(semanticGroups))
			for (const name of names)
				for (const surface of palette.surfaces) {
					if (name === 'warn') {
						expect(
							wcagContrast(vars['warn-ink'], palette.scheme === 'light' ? vars.warn : surface),
						).toBeGreaterThanOrEqual(4.5);
						continue;
					}
					const graphical = [
						'accent',
						'focus-ring',
						'spend-warm',
						'chrome-brass',
						'chrome-ember',
						'chrome-edge',
					].includes(name);
					expect(wcagContrast(vars[name], surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(
						graphical ? 3 : 4.5,
					);
				}
	});
});
it('uses provider semantics and keeps fixed export colours concrete', () => {
	expect(modelColor('claude-opus-5')).toBe(providerColor('claude'));
	expect(modelColor('claude-opus-5', 'pi')).toBe(providerColor('pi'));
	expect(modelColor('gpt-6-astra', 'cursor')).toBe(providerColor('cursor'));
	expect(providerColor('unrecognized')).toBe('var(--p-unknown)');
	expect(modelHex('claude-opus-5')).toMatch(/^hsl/);
	expect(resolveTheme('bad', false)).toBe('register-light');
	expect(resolveTheme('auto', true)).toBe('register-dark');
	expect(resolveTheme('latte', true)).toBe('latte');
});
