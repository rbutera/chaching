// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PoolFilters from './PoolFilters.svelte';

afterEach(cleanup);

describe('PoolFilters', () => {
	it('toggles machine scopes and exposes one clear action', async () => {
		const onMachineToggle = vi.fn();
		const onClear = vi.fn();
		const { getByRole, getByText } = render(PoolFilters, {
			machines: [
				{ id: 'kinto', name: 'kinto', hostname: 'kinto', lastSeenAt: null },
				{ id: 'nimbus', name: 'nimbus', hostname: 'nimbus', lastSeenAt: null }
			],
			machineFilter: new Set(['kinto']),
			onMachineToggle,
			onClear
		});

		await fireEvent.click(getByText('Machines · 1'));
		await fireEvent.click(getByRole('button', { name: 'nimbus' }));
		await fireEvent.click(getByRole('button', { name: /clear machine filters/i }));

		expect(onMachineToggle).toHaveBeenCalledWith('nimbus');
		expect(onClear).toHaveBeenCalledOnce();
	});
});
