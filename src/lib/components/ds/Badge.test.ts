// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Badge from './Badge.svelte';
import { createRawSnippet } from 'svelte';

const content = createRawSnippet(() => ({ render: () => '<span>live</span>' }));

function badge(container: HTMLElement) {
	return container.querySelector('.badge') as HTMLElement;
}

describe('Badge', () => {
	it('maps each tone to its token color via --badge-c', () => {
		const cases: Array<[string, string]> = [
			['neutral', 'var(--text-muted)'],
			['accent', 'var(--accent)'],
			['good', 'var(--good)'],
			['bad', 'var(--bad)'],
			['warn', 'var(--warn)'],
			['info', 'var(--info)']
		];
		for (const [tone, token] of cases) {
			const { container } = render(Badge, { props: { tone: tone as never, children: content } });
			const el = badge(container as HTMLElement);
			expect(el.classList.contains(tone)).toBe(true);
			expect(el.style.getPropertyValue('--badge-c')).toBe(token);
		}
	});

	it('toggles the solid class for fill vs tint', () => {
		const tint = render(Badge, { props: { children: content } });
		expect(badge(tint.container as HTMLElement).classList.contains('solid')).toBe(false);
		const solid = render(Badge, { props: { solid: true, children: content } });
		expect(badge(solid.container as HTMLElement).classList.contains('solid')).toBe(true);
	});

	it('renders a decorative aria-hidden dot when dot is set', () => {
		const { container } = render(Badge, { props: { dot: true, children: content } });
		const dot = container.querySelector('.dot');
		expect(dot).not.toBeNull();
		expect(dot?.getAttribute('aria-hidden')).toBe('true');
	});

	it('keeps the content text node lowercase (uppercase is CSS only)', () => {
		const { container } = render(Badge, { props: { children: content } });
		expect(badge(container as HTMLElement).textContent).toContain('live');
	});
});
