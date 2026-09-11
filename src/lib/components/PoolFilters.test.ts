// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PoolFilters from './PoolFilters.svelte';

afterEach(cleanup);

describe('PoolFilters', () => {
	it('toggles machine and subscription scopes and exposes one clear action', async () => {
		const onMachineToggle = vi.fn();
		const onAccountToggle = vi.fn();
		const onClear = vi.fn();
		const { getByRole, getByText } = render(PoolFilters, {
			machines: [
				{ id: 'kinto', name: 'kinto', hostname: 'kinto', lastSeenAt: null },
				{ id: 'nimbus', name: 'nimbus', hostname: 'nimbus', lastSeenAt: null }
			],
			accounts: [
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
			accountFilter: new Set<string>(),
			onMachineToggle,
			onAccountToggle,
			onClear
		});

		await fireEvent.click(getByText('Machines · 1'));
		await fireEvent.click(getByRole('button', { name: 'nimbus' }));
		await fireEvent.click(getByText('Accounts'));
		await fireEvent.click(getByRole('button', { name: 'Personal Claude' }));
		await fireEvent.click(getByRole('button', { name: /clear pool filters/i }));

		expect(onMachineToggle).toHaveBeenCalledWith('nimbus');
		expect(onAccountToggle).toHaveBeenCalledWith('personal');
		expect(onClear).toHaveBeenCalledOnce();
	});
});
