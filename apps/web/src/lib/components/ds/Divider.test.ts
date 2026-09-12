// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Divider from './Divider.svelte';
import { createRawSnippet } from 'svelte';

const cap = createRawSnippet(() => ({ render: () => '<span>summary</span>' }));

describe('Divider', () => {
	it('is a role=separator when unlabeled', () => {
		const { container } = render(Divider, {});
		const sep = container.querySelector('[role="separator"]');
		expect(sep).not.toBeNull();
		expect(sep?.classList.contains('full')).toBe(true);
	});

	it('renders two rules + a caption when labeled', () => {
		const { container } = render(Divider, { props: { label: cap } });
		expect(container.querySelectorAll('.rule')).toHaveLength(2);
		const caption = container.querySelector('.caption');
		expect(caption?.textContent).toContain('summary');
		// labeled form is not a separator landmark
		expect(container.querySelector('[role="separator"]')).toBeNull();
	});

	it('applies the variant texture class', () => {
		for (const variant of ['solid', 'dashed', 'dotted'] as const) {
			const { container } = render(Divider, { props: { variant } });
			expect(container.querySelector('.rule')?.classList.contains(variant)).toBe(true);
		}
	});
});
