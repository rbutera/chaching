import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { themesCss, themeBootstrap } from '@chaching/shared/brand/palettes';
import { tokens } from '@chaching/shared/brand/tokens';
import { toCss, CSS_BEGIN_MARKER, CSS_END_MARKER } from '@chaching/shared/brand/generate';

it('generated CSS matches shared brand tokens', () => {
	const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
	const begin = css.indexOf(CSS_BEGIN_MARKER);
	const end = css.indexOf(CSS_END_MARKER);
	expect(begin).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(begin);
	expect(css.slice(begin, end + CSS_END_MARKER.length).replace(/\t(\/\* END GENERATED brand tokens \*\/)$/, '$1')).toBe(toCss(tokens));
});

it('keeps every palette and the early theme bootstrap in generated artifacts', () => {
	expect(readFileSync(new URL('../../app.css', import.meta.url), 'utf8')).toContain(themesCss());
	expect(readFileSync(new URL('../../app.html', import.meta.url), 'utf8')).toContain(themeBootstrap());
});
