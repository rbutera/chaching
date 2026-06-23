// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Sparkline from './Sparkline.svelte';

describe('Sparkline', () => {
	it('renders an empty svg (no throw) for <2 values', () => {
		const empty = render(Sparkline, { props: { values: [] } });
		expect(empty.container.querySelector('path')).toBeNull();
		const one = render(Sparkline, { props: { values: [5] } });
		expect(one.container.querySelector('path')).toBeNull();
		// still a labeled img landmark
		expect(empty.container.querySelector('svg')?.getAttribute('role')).toBe('img');
	});

	it('draws a path spanning the series min→max', () => {
		const { container } = render(Sparkline, {
			props: { values: [0, 10], width: 100, height: 50, strokeWidth: 2, area: false, dot: false }
		});
		const line = container.querySelectorAll('path');
		expect(line).toHaveLength(1);
		const d = line[0].getAttribute('d') ?? '';
		// pad = strokeWidth + 1 = 3; min value sits at the bottom (y = height-pad),
		// max value at the top (y = pad).
		expect(d).toContain('M3.0 47.0');
		expect(d).toContain('L97.0 3.0');
	});

	it('area adds a second (fill) path; dot adds a circle', () => {
		const full = render(Sparkline, { props: { values: [1, 2, 3], area: true, dot: true } });
		expect(full.container.querySelectorAll('path')).toHaveLength(2);
		expect(full.container.querySelector('circle')).not.toBeNull();

		const bare = render(Sparkline, { props: { values: [1, 2, 3], area: false, dot: false } });
		expect(bare.container.querySelectorAll('path')).toHaveLength(1);
		expect(bare.container.querySelector('circle')).toBeNull();
	});

	it('is a role=img with an aria-label', () => {
		const { container } = render(Sparkline, {
			props: { values: [1, 2], ariaLabel: 'spend trend' }
		});
		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('role')).toBe('img');
		expect(svg?.getAttribute('aria-label')).toBe('spend trend');
	});
});
