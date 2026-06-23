// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import BrandMark from './BrandMark.svelte';

describe('BrandMark', () => {
	it('mark-only renders an <svg role=img> with a <title>', () => {
		const { container } = render(BrandMark, {});
		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('role')).toBe('img');
		expect(svg?.querySelector('title')?.textContent).toBe('chaching');
		expect(container.querySelector('.lockup')).toBeNull();
	});

	it('wordmark renders the full "Chaching!" lockup (244×48, mark + wordmark paths)', () => {
		const { container } = render(BrandMark, { props: { wordmark: true } });
		const svg = container.querySelector('svg');
		expect(svg).not.toBeNull();
		// The full lockup uses the wide 244×48 viewBox (not the 24×24 mark box).
		expect(svg?.getAttribute('viewBox')).toBe('0 0 244 48');
		// Mark group (3 paths) + the outlined wordmark path = at least 4 paths.
		expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(4);
		// No leftover text-based wordmark element.
		expect(container.querySelector('.text')).toBeNull();
	});

	it('size scales the svg dimensions', () => {
		const { container } = render(BrandMark, { props: { size: 48 } });
		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('width')).toBe('48');
		expect(svg?.getAttribute('height')).toBe('48');
	});

	it('color override recolors via the color style', () => {
		const { container } = render(BrandMark, { props: { color: 'var(--text)' } });
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.style.color).toBe('var(--text)');
	});

	it('title override flows into <title> and aria-label', () => {
		const { container } = render(BrandMark, { props: { title: 'chaching pro' } });
		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('aria-label')).toBe('chaching pro');
		expect(svg?.querySelector('title')?.textContent).toBe('chaching pro');
	});
});
