// @vitest-environment jsdom
//
// MoneyOdometer — the NumberFlow-backed headline figure (hero + rail). NumberFlow
// draws the digits as CSS-transformed reels inside an open shadow root, so there is
// no plain-text value in the light DOM; the component mirrors the value as a
// visually-hidden node (the a11y tree + these tests read that) and marks the visual
// aria-hidden. These smoke tests guard that mirror + the MoneyFigure-parity format.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import MoneyOdometer from './MoneyOdometer.svelte';

beforeEach(() => {
	// NumberFlow feature-detects motion via matchMedia; jsdom has none.
	vi.stubGlobal(
		'matchMedia',
		vi.fn((q: string) => ({
			matches: /reduce/.test(q),
			media: q,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	);
});
afterEach(() => cleanup());

function accessible(c: HTMLElement) {
	return (c.querySelector('.visually-hidden')?.textContent ?? '').trim();
}

describe('MoneyOdometer', () => {
	it('mirrors the value as an accessible text node, matching MoneyFigure decimals', () => {
		const big = render(MoneyOdometer, { props: { amount: 1234.56 } });
		expect(accessible(big.container as HTMLElement)).toBe('$1,235');

		const small = render(MoneyOdometer, { props: { amount: 12.3 } });
		expect(accessible(small.container as HTMLElement)).toBe('$12.30');
	});

	it('renders the NumberFlow odometer element and hides it from the a11y tree', () => {
		const { container } = render(MoneyOdometer, { props: { amount: 42 } });
		// The visual odometer group is aria-hidden (the mirror is the accessible name).
		const visual = container.querySelector('.odometer');
		expect(visual?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('number-flow-svelte')).toBeTruthy();
	});

	it('applies tone and size via class (drop-in for MoneyFigure)', () => {
		const { container } = render(MoneyOdometer, { props: { amount: 5, tone: 'gold', size: 'hero' } });
		const el = container.querySelector('.money')!;
		expect(el.classList.contains('gold')).toBe(true);
		expect(el.classList.contains('hero')).toBe(true);
	});
});
