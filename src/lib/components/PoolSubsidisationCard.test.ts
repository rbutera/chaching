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

	it.each([
		[0, '—'],
		[40, '∞ — all of it']
	])('renders the zero-fee multiple for %s usage', (valueUsd, multiple) => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days',
			rows: [
				{
					id: 'free-plan',
					name: 'Free tier',
					provider: 'claude',
					account: '',
					valueUsd,
					feeUsd: 0
				}
			]
		});

		const text = container.textContent ?? '';
		expect(text).toContain(multiple);
		if (valueUsd === 0) expect(text).not.toContain('∞');
	});

	it('annotates the fee as a whole-plan fee when a machine filter is active', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days',
			wholePlanFee: true,
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: '',
					valueUsd: 800,
					feeUsd: 200
				}
			]
		});

		expect(container.textContent).toContain('shared Account fee');
	});

	it('omits the whole-plan annotation without a machine filter', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days',
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: '',
					valueUsd: 800,
					feeUsd: 200
				}
			]
		});

		expect(container.textContent).not.toContain('shared Account fee');
	});
});
