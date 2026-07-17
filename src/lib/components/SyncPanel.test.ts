// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SyncPanel from './SyncPanel.svelte';
import type { SyncStatusView } from '$lib/client/sync';

afterEach(cleanup);

const localStatus: SyncStatusView = {
	enabled: false,
	databaseConfigured: false,
	pool: null,
	machine: null,
	machines: [],
	subscriptions: [],
	mappings: []
};

describe('SyncPanel', () => {
	it('creates a pool without rendering the database password back into the page', async () => {
		const onAction = vi.fn(async () => {});
		const { getByRole, getByLabelText, container } = render(SyncPanel, {
			status: localStatus,
			onAction
		});

		await fireEvent.input(getByLabelText('PostgreSQL URL'), {
			target: { value: 'postgresql://chaching:secret@100.64.0.1/chaching' }
		});
		await fireEvent.input(getByLabelText('pool name'), { target: { value: 'Rai machines' } });
		await fireEvent.input(getByLabelText('this machine'), { target: { value: 'kinto' } });
		await fireEvent.click(getByRole('button', { name: 'create pool' }));

		expect(onAction).toHaveBeenCalledWith({
			action: 'create',
			databaseUrl: 'postgresql://chaching:secret@100.64.0.1/chaching',
			poolName: 'Rai machines',
			machineName: 'kinto'
		});
		expect(container.textContent).not.toContain('secret');
	});

	it('shows machines and maps this machine to a shared subscription', async () => {
		const onAction = vi.fn(async () => {});
		const status: SyncStatusView = {
			enabled: true,
			databaseConfigured: true,
			pool: { id: 'pool-1', name: 'Rai machines' },
			machine: {
				id: 'machine-kinto',
				name: 'kinto',
				hostname: 'kinto',
				lastSeenAt: '2026-07-17T08:00:00Z',
				current: true
			},
			machines: [
				{
					id: 'machine-kinto',
					name: 'kinto',
					hostname: 'kinto',
					lastSeenAt: '2026-07-17T08:00:00Z',
					current: true
				},
				{
					id: 'machine-nimbus',
					name: 'nimbus',
					hostname: 'nimbus',
					lastSeenAt: '2026-07-17T07:59:00Z'
				}
			],
			subscriptions: [
				{
					id: 'sub-codex',
					provider: 'codex',
					name: 'Shared ChatGPT Pro',
					account: 'shared@example.com',
					tier: 'pro-20x',
					monthlyUsd: 200
				}
			],
			mappings: []
		};

		const { getByLabelText, container } = render(SyncPanel, { status, onAction });
		expect(container.textContent).toContain('nimbus');
		expect(container.textContent).toContain('Shared ChatGPT Pro');

		await fireEvent.change(getByLabelText('codex'), { target: { value: 'sub-codex' } });
		expect(onAction).toHaveBeenCalledWith({
			action: 'map',
			machineId: 'machine-kinto',
			provider: 'codex',
			subscriptionId: 'sub-codex'
		});
	});
});
