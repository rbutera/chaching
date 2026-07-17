// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PoolFilters from './PoolFilters.svelte';

afterEach(cleanup);

describe('PoolFilters', () => {
	it('toggles machine and subscription scopes and exposes one clear action', async () => {
		const onMachineToggle = vi.fn();
		const onSubscriptionToggle = vi.fn();
		const onClear = vi.fn();
		const { getByRole } = render(PoolFilters, {
			machines: [
				{ id: 'kinto', name: 'kinto', hostname: 'kinto', lastSeenAt: null },
				{ id: 'nimbus', name: 'nimbus', hostname: 'nimbus', lastSeenAt: null }
			],
			subscriptions: [
				{
					id: 'work',
					provider: 'claude',
					name: 'Work Claude',
					account: 'work@example.com',
					tier: 'max-20x',
					monthlyUsd: 200
				},
				{
					id: 'personal',
					provider: 'claude',
					name: 'Personal Claude',
					account: 'personal@example.com',
					tier: 'max-20x',
					monthlyUsd: 200
				}
			],
			machineFilter: new Set(['kinto']),
			subscriptionFilter: new Set<string>(),
			onMachineToggle,
			onSubscriptionToggle,
			onClear
		});

		await fireEvent.click(getByRole('button', { name: 'nimbus' }));
		await fireEvent.click(getByRole('button', { name: 'Personal Claude' }));
		await fireEvent.click(getByRole('button', { name: /clear pool filters/i }));

		expect(onMachineToggle).toHaveBeenCalledWith('nimbus');
		expect(onSubscriptionToggle).toHaveBeenCalledWith('personal');
		expect(onClear).toHaveBeenCalledOnce();
	});
});
