// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ReceiptLine from './ReceiptLine.svelte';

function amount(container: HTMLElement) {
	return (container.querySelector('.amount')?.textContent ?? '').trim();
}
function line(container: HTMLElement) {
	return container.querySelector('.line') as HTMLElement;
}

describe('ReceiptLine', () => {
	it('formats numeric amounts (>=1000 no decimals, else 2)', () => {
		const big = render(ReceiptLine, { props: { label: 'Opus', amount: 1234.5 } });
		expect(amount(big.container as HTMLElement)).toBe('$1,235');
		const small = render(ReceiptLine, { props: { label: 'Haiku', amount: 4.2 } });
		expect(amount(small.container as HTMLElement)).toBe('$4.20');
	});

	it('passes string amounts through unformatted', () => {
		const { container } = render(ReceiptLine, { props: { label: 'Cache', amount: '—' } });
		expect(amount(container as HTMLElement)).toBe('—');
	});

	it('coupon renders green + negative U+2212', () => {
		const { container } = render(ReceiptLine, { props: { label: 'Cache hit', amount: 3.2, coupon: true } });
		const el = line(container as HTMLElement);
		expect(el.classList.contains('coupon')).toBe(true);
		const a = amount(container as HTMLElement);
		expect(a).toBe('−$3.20');
		expect(a.includes('-')).toBe(false);
	});

	it('emphasis is the bold uppercase total class', () => {
		const { container } = render(ReceiptLine, { props: { label: 'Total burn', amount: 99, emphasis: true } });
		expect(line(container as HTMLElement).classList.contains('emphasis')).toBe(true);
	});

	it('leader dots are aria-hidden; leader=false swaps to a plain spacer', () => {
		const withLeader = render(ReceiptLine, { props: { label: 'x', amount: 1 } });
		expect(withLeader.container.querySelector('.leader')?.getAttribute('aria-hidden')).toBe('true');
		const noLeader = render(ReceiptLine, { props: { label: 'x', amount: 1, leader: false } });
		expect(noLeader.container.querySelector('.leader')).toBeNull();
		expect(noLeader.container.querySelector('.spacer')).not.toBeNull();
	});

	it('renders a dim sub detail after the label', () => {
		const { container } = render(ReceiptLine, { props: { label: 'Input', amount: 1, sub: '12k tok' } });
		expect(container.querySelector('.sub')?.textContent?.trim()).toBe('12k tok');
	});
});
