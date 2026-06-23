// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import SpendMeter from './SpendMeter.svelte';

function remark(container: HTMLElement) {
	return (container.querySelector('.remark')?.textContent ?? '').trim();
}
function fillWidth(container: HTMLElement) {
	return (container.querySelector('.fill') as HTMLElement).style.width;
}

describe('SpendMeter', () => {
	it('selects the right tier remark + emoji at thresholds per context', () => {
		// block ladder
		const cases: Array<[number, 'block' | 'daily' | 'lifetime', string]> = [
			[10, 'block', '💸warming up'],
			[30, 'block', '💸💸getting spicy'],
			[75, 'block', '🔥full send'],
			[120, 'block', '🔥🔥please take a break'],
			[200, 'block', '🚨the register is on fire'],
			[20, 'daily', '💰decent day'],
			[500, 'daily', '🚨🚨send help'],
			[100, 'lifetime', "💰you've committed"],
			[5000, 'lifetime', '🚨write a blog post']
		];
		for (const [amount, context, expected] of cases) {
			const { container } = render(SpendMeter, { props: { amount, context } });
			expect(remark(container as HTMLElement)).toBe(expected);
		}
	});

	it('shows no remark below the first non-zero rung', () => {
		const { container } = render(SpendMeter, { props: { amount: 5, context: 'block' } });
		expect(container.querySelector('.remark')).toBeNull();
	});

	it('clamps the gauge fraction to [0.03, 1]', () => {
		const tiny = render(SpendMeter, { props: { amount: 0, context: 'block', max: 200 } });
		expect(fillWidth(tiny.container as HTMLElement)).toBe('3%');
		const over = render(SpendMeter, { props: { amount: 9999, context: 'block', max: 200 } });
		expect(fillWidth(over.container as HTMLElement)).toBe('100%');
	});

	it('showEmoji=false hides the emoji but keeps the remark', () => {
		const { container } = render(SpendMeter, {
			props: { amount: 75, context: 'block', showEmoji: false }
		});
		expect(container.querySelector('.emoji')).toBeNull();
		expect(remark(container as HTMLElement)).toBe('full send');
	});

	it('marks the gauge aria-hidden', () => {
		const { container } = render(SpendMeter, { props: { amount: 50, context: 'block' } });
		expect(container.querySelector('.gauge')?.getAttribute('aria-hidden')).toBe('true');
	});
});
