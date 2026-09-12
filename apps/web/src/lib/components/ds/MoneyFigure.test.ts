// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import MoneyFigure from './MoneyFigure.svelte';

function text(c: HTMLElement) {
	return (c.querySelector('.money')?.textContent ?? '').trim();
}

describe('MoneyFigure', () => {
	it('drops decimals for abs >= 1000, keeps 2 below', () => {
		const big = render(MoneyFigure, { props: { amount: 1234.56 } });
		expect(text(big.container as HTMLElement)).toBe('$1,235');

		const small = render(MoneyFigure, { props: { amount: 12.3 } });
		expect(text(small.container as HTMLElement)).toBe('$12.30');
	});

	it('honors a decimals override', () => {
		const { container } = render(MoneyFigure, { props: { amount: 1234.5, decimals: 2 } });
		expect(text(container as HTMLElement)).toBe('$1,234.50');
	});

	it('forces +/− with sign', () => {
		const pos = render(MoneyFigure, { props: { amount: 10, sign: true } });
		expect(text(pos.container as HTMLElement)).toBe('+$10.00');
		const neg = render(MoneyFigure, { props: { amount: -10, sign: true } });
		expect(text(neg.container as HTMLElement)).toBe('−$10.00');
	});

	it('renders negatives with U+2212 (not a hyphen)', () => {
		const { container } = render(MoneyFigure, { props: { amount: -42 } });
		const t = text(container as HTMLElement);
		expect(t.startsWith('−')).toBe(true);
		expect(t.includes('-')).toBe(false);
	});

	it('dims the currency glyph', () => {
		const { container } = render(MoneyFigure, { props: { amount: 5 } });
		expect(container.querySelector('.currency')?.textContent).toBe('$');
	});

	it('applies tones and sizes via class', () => {
		const { container } = render(MoneyFigure, { props: { amount: 5, tone: 'save', size: 'hero' } });
		const el = container.querySelector('.money')!;
		expect(el.classList.contains('save')).toBe(true);
		expect(el.classList.contains('hero')).toBe(true);
	});

	it('renders through the .money class (carries the tabular-nums rule)', () => {
		// jsdom does not load Svelte's scoped <style>, so we assert the class that
		// owns `font-variant-numeric: tabular-nums` is present rather than computed
		// style. The CSS itself is verified by `npm run build`.
		const { container } = render(MoneyFigure, { props: { amount: 5 } });
		expect(container.querySelector('.money')).not.toBeNull();
	});

	it('non-animated renders the final value immediately (no count-up)', () => {
		const { container } = render(MoneyFigure, { props: { amount: 1234.56 } });
		expect(text(container as HTMLElement)).toBe('$1,235');
	});

	it('row 9: animate + reduced-motion sets the final value immediately (no tween)', () => {
		// Force prefers-reduced-motion: reduce → countUp must jump straight to target.
		vi.stubGlobal('matchMedia', (q: string) => ({
			matches: /reduce/.test(q),
			media: q,
			addEventListener() {},
			removeEventListener() {}
		}));
		const { container } = render(MoneyFigure, { props: { amount: 4242, animate: true } });
		expect(text(container as HTMLElement)).toBe('$4,242');
		vi.unstubAllGlobals();
	});

	// NB: the count-up tween itself (intermediate frames + landing exactly on target)
	// is covered deterministically with an injected rAF in src/lib/client/motion.test.ts;
	// asserting it here against jsdom's wall-clock rAF is flaky, so we only assert the
	// reduced-motion immediate-set contract at the component level (above).
});
