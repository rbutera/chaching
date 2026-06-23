// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Card from './Card.svelte';
import { createRawSnippet } from 'svelte';

const body = createRawSnippet(() => ({ render: () => '<p data-testid="kid">panel</p>' }));

function card(container: HTMLElement) {
	return container.querySelector('.card') as HTMLElement;
}

describe('Card', () => {
	it('renders children', () => {
		render(Card, { props: { children: body } });
		expect(screen.getByTestId('kid').textContent).toBe('panel');
	});

	it('accent adds an aria-hidden gold top hairline', () => {
		const { container } = render(Card, { props: { accent: true, children: body } });
		const bar = container.querySelector('.accent-bar');
		expect(bar).not.toBeNull();
		expect(bar?.getAttribute('aria-hidden')).toBe('true');
	});

	it('glow adds the glow class', () => {
		const { container } = render(Card, { props: { glow: true, children: body } });
		expect(card(container as HTMLElement).classList.contains('glow')).toBe(true);
	});

	it('interactive + onclick is a focusable button activatable by click and Enter/Space', async () => {
		const onclick = vi.fn();
		render(Card, { props: { interactive: true, onclick, children: body } });
		const el = screen.getByRole('button');
		expect(el.getAttribute('tabindex')).toBe('0');

		await userEvent.click(el);
		expect(onclick).toHaveBeenCalledTimes(1);

		el.focus();
		await userEvent.keyboard('{Enter}');
		await userEvent.keyboard(' ');
		expect(onclick).toHaveBeenCalledTimes(3);
	});

	it('interactive without a handler is not a button (no fake role)', () => {
		const { container } = render(Card, { props: { interactive: true, children: body } });
		expect(card(container as HTMLElement).getAttribute('role')).toBeNull();
		expect(card(container as HTMLElement).getAttribute('tabindex')).toBeNull();
	});

	it('padded=false adds the flush class', () => {
		const { container } = render(Card, { props: { padded: false, children: body } });
		expect(card(container as HTMLElement).classList.contains('flush')).toBe(true);
	});
});
