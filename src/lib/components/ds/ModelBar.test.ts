// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ModelBar from './ModelBar.svelte';

function bar(container: HTMLElement) {
	return container.querySelector('.modelbar') as HTMLElement;
}

describe('ModelBar', () => {
	it('auto-hues opus/sonnet/haiku, else other', () => {
		const cases: Array<[string, string]> = [
			['claude-opus-4', 'var(--m-opus)'],
			['Sonnet 3.5', 'var(--m-sonnet)'],
			['haiku', 'var(--m-haiku)'],
			['gpt-5', 'var(--m-other)']
		];
		for (const [label, hue] of cases) {
			const { container } = render(ModelBar, { props: { label, amount: 1 } });
			expect(bar(container as HTMLElement).style.getPropertyValue('--bar-c')).toBe(hue);
		}
	});

	it('color overrides the auto hue', () => {
		const { container } = render(ModelBar, {
			props: { label: 'opus', amount: 1, color: 'var(--accent)' }
		});
		expect(bar(container as HTMLElement).style.getPropertyValue('--bar-c')).toBe('var(--accent)');
	});

	it('clamps pct to [0,1] for the fill width', () => {
		const over = render(ModelBar, { props: { label: 'x', amount: 1, pct: 2 } });
		expect((over.container.querySelector('.fill') as HTMLElement).style.width).toBe('100%');
		const under = render(ModelBar, { props: { label: 'x', amount: 1, pct: -1 } });
		expect((under.container.querySelector('.fill') as HTMLElement).style.width).toBe('0%');
		const mid = render(ModelBar, { props: { label: 'x', amount: 1, pct: 0.5 } });
		expect((mid.container.querySelector('.fill') as HTMLElement).style.width).toBe('50%');
	});

	it('renders MoneyFigure for money, raw span otherwise', () => {
		const m = render(ModelBar, { props: { label: 'x', amount: 12.5 } });
		expect(m.container.querySelector('.money')).not.toBeNull();
		const raw = render(ModelBar, { props: { label: 'x', amount: '3 calls', money: false } });
		expect(raw.container.querySelector('.money')).toBeNull();
		expect(raw.container.querySelector('.raw')?.textContent).toBe('3 calls');
	});

	it('marks the track aria-hidden', () => {
		const { container } = render(ModelBar, { props: { label: 'x', amount: 1 } });
		expect(container.querySelector('.track')?.getAttribute('aria-hidden')).toBe('true');
	});
});
