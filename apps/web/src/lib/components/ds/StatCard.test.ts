// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import StatCard from './StatCard.svelte';

describe('StatCard', () => {
	it('renders the label (cased via CSS, text node preserved)', () => {
		const { container } = render(StatCard, { props: { label: 'today', value: '42' } });
		expect(container.querySelector('.label')?.textContent).toBe('today');
	});

	it('renders a plain value when money is off', () => {
		const { container } = render(StatCard, { props: { label: 'sessions', value: 7 } });
		expect(container.querySelector('.value')?.textContent).toBe('7');
		expect(container.querySelector('.money')).toBeNull();
	});

	it('renders a MoneyFigure when money is on, honoring moneyTone', () => {
		const { container } = render(StatCard, {
			props: { label: 'spend', value: 1234.5, money: true, moneyTone: 'burn' }
		});
		const money = container.querySelector('.money');
		expect(money).not.toBeNull();
		expect(money?.classList.contains('burn')).toBe(true);
		expect(money?.textContent?.trim()).toBe('$1,235');
	});

	it('renders an aria-hidden accent bar in the given hue', () => {
		const { container } = render(StatCard, {
			props: { label: 'opus', value: '1', accent: 'var(--m-opus)' }
		});
		const bar = container.querySelector('.accent-bar') as HTMLElement;
		expect(bar.getAttribute('aria-hidden')).toBe('true');
		expect(bar.style.getPropertyValue('--statcard-accent')).toBe('var(--m-opus)');
	});

	it('renders the sub line when provided', () => {
		const { container } = render(StatCard, {
			props: { label: 'x', value: '1', sub: 'vs yesterday' }
		});
		expect(container.querySelector('.sub')?.textContent?.trim()).toBe('vs yesterday');
	});
});
