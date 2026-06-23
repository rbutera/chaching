// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Button from './Button.svelte';
import { createRawSnippet } from 'svelte';

const label = createRawSnippet(() => ({ render: () => '<span>Charge</span>' }));
const icon = createRawSnippet(() => ({ render: () => '<i data-testid="ic">*</i>' }));

describe('Button', () => {
	it('renders children and is a <button type=button>', () => {
		render(Button, { props: { children: label } });
		const btn = screen.getByRole('button');
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.textContent).toContain('Charge');
	});

	it('applies variant + size classes', () => {
		render(Button, { props: { children: label, variant: 'danger', size: 'lg' } });
		const btn = screen.getByRole('button');
		expect(btn.classList.contains('danger')).toBe(true);
		expect(btn.classList.contains('lg')).toBe(true);
	});

	it('disabled blocks onclick and sets disabled', async () => {
		const onclick = vi.fn();
		render(Button, { props: { children: label, disabled: true, onclick } });
		const btn = screen.getByRole('button') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		await userEvent.click(btn);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('full adds the stretch class', () => {
		render(Button, { props: { children: label, full: true } });
		expect(screen.getByRole('button').classList.contains('full')).toBe(true);
	});

	it('renders icon + iconRight snippets', () => {
		render(Button, { props: { children: label, icon, iconRight: icon } });
		expect(screen.getAllByTestId('ic')).toHaveLength(2);
	});

	it('is keyboard focusable and fires onclick', async () => {
		const onclick = vi.fn();
		render(Button, { props: { children: label, onclick } });
		const btn = screen.getByRole('button');
		btn.focus();
		expect(document.activeElement).toBe(btn);
		await userEvent.keyboard('{Enter}');
		expect(onclick).toHaveBeenCalledTimes(1);
	});
});
