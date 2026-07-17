// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PoolSubsidisationCard from './PoolSubsidisationCard.svelte';

afterEach(cleanup);

describe('PoolSubsidisationCard', () => {
	it('counts a shared subscription fee once while combining its pooled value', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days',
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: 'shared@example.com',
					valueUsd: 2400,
					feeUsd: 200
				}
			]
		});

		const text = container.textContent ?? '';
		expect(text).toContain('12.0×');
		expect(text).toContain('$2,400');
		expect(text).toContain('$200');
		expect(text.match(/Shared ChatGPT Pro/g)).toHaveLength(1);
	});
});
