// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ProviderPill from './ProviderPill.svelte';

describe('ProviderPill', () => {
	it('auto-resolves label + hue for known providers', () => {
		const cases: Array<[string, string, string]> = [
			['claude', 'Claude Code', 'var(--p-claude)'],
			['codex', 'Codex', 'var(--p-codex)'],
			['opencode', 'OpenCode', 'var(--p-opencode)'],
			['cursor', 'Cursor', 'var(--p-cursor)']
		];
		for (const [provider, name, hue] of cases) {
			const { container } = render(ProviderPill, { props: { provider } });
			const btn = container.querySelector('.pill') as HTMLElement;
			expect(btn.querySelector('.name')?.textContent).toBe(name);
			expect(btn.style.getPropertyValue('--pill-c')).toBe(hue);
		}
	});

	it('label and color overrides win', () => {
		const { container } = render(ProviderPill, {
			props: { provider: 'claude', label: 'My Bot', color: 'var(--accent)' }
		});
		const btn = container.querySelector('.pill') as HTMLElement;
		expect(btn.querySelector('.name')?.textContent).toBe('My Bot');
		expect(btn.style.getPropertyValue('--pill-c')).toBe('var(--accent)');
	});

	it('active sets aria-pressed=true + the active class', () => {
		const { container } = render(ProviderPill, { props: { provider: 'codex', active: true } });
		const btn = container.querySelector('.pill') as HTMLElement;
		expect(btn.getAttribute('aria-pressed')).toBe('true');
		expect(btn.classList.contains('active')).toBe(true);
	});

	it('is a real <button> that fires onclick', async () => {
		const onclick = vi.fn();
		render(ProviderPill, { props: { provider: 'cursor', onclick } });
		const btn = screen.getByRole('button');
		expect(btn.tagName).toBe('BUTTON');
		await userEvent.click(btn);
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('shows an amount MoneyFigure only when amount is given', () => {
		const without = render(ProviderPill, { props: { provider: 'claude' } });
		expect(without.container.querySelector('.money')).toBeNull();
		const withAmt = render(ProviderPill, { props: { provider: 'claude', amount: 9.5 } });
		expect(withAmt.container.querySelector('.money')).not.toBeNull();
	});
});
