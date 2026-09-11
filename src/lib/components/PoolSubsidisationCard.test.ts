// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PoolSubsidisationCard from './PoolSubsidisationCard.svelte';

afterEach(cleanup);

describe('PoolSubsidisationCard', () => {
	it('shows combined value without inventing individual Account values', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days', totalValue: 2000,
			rows: ['a', 'b'].map(id => ({ id, name: id, provider: 'claude', account: '', feeUsd: 200 }))
		});
		expect(container.textContent).toContain('Across 2 Accounts');
		expect(container.textContent).toContain('5.0×');
		expect(container.textContent).toContain('$2,000');
		expect(container.textContent).not.toContain('$1,000');
	});

	it('counts a shared subscription fee once while combining its pooled value', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days', totalValue: 2400,
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: 'shared@example.com',
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
			windowLabel: 'Last 30 days', totalValue: valueUsd,
			rows: [
				{
					id: 'free-plan',
					name: 'Free tier',
					provider: 'claude',
					account: '',
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
			windowLabel: 'Last 30 days', totalValue: 800,
			wholePlanFee: true,
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: '',
					feeUsd: 200
				}
			]
		});

		expect(container.textContent).toContain('shared Account fee');
	});

	it('omits the whole-plan annotation without a machine filter', () => {
		const { container } = render(PoolSubsidisationCard, {
			windowLabel: 'Last 30 days', totalValue: 800,
			rows: [
				{
					id: 'shared-codex',
					name: 'Shared ChatGPT Pro',
					provider: 'codex',
					account: '',
					feeUsd: 200
				}
			]
		});

		expect(container.textContent).not.toContain('shared Account fee');
	});
});
