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

	const joinedStatus: SyncStatusView = {
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
			}
		],
		subscriptions: [],
		mappings: []
	};

	it('shows a distinct offline state (identity + error, no onboarding form) when the pool is unreachable', () => {
		const offlineStatus: SyncStatusView = {
			enabled: true,
			databaseConfigured: true,
			unreachable: true,
			localIdentity: { poolId: 'pool-xyz', machineId: 'machine-latios', machineName: 'latios' },
			pool: null,
			machine: null,
			machines: [],
			subscriptions: [],
			mappings: [],
			error: 'connect ECONNREFUSED 100.64.0.1:5432'
		};

		const { queryByLabelText, queryByRole, container } = render(SyncPanel, {
			status: offlineStatus,
			onAction: vi.fn(async () => {})
		});

		// Joined identity is shown, not treated as never-joined onboarding.
		expect(container.textContent).toContain('latios');
		expect(container.textContent).toContain('pool-xyz');
		expect(container.textContent).toContain('unreachable');
		expect(container.textContent).toContain('connect ECONNREFUSED');
		// No create/join form and no destructive mutation control while offline.
		expect(queryByLabelText('PostgreSQL URL')).toBeNull();
		expect(queryByRole('button', { name: 'leave pool' })).toBeNull();
	});

	it('requires a two-step confirm before leaving, warning about the local-history gap', async () => {
		const onAction = vi.fn(async () => {});
		const { getByRole, queryByRole, container } = render(SyncPanel, {
			status: joinedStatus,
			onAction
		});

		// First click arms the confirm; it must NOT leave yet.
		await fireEvent.click(getByRole('button', { name: 'leave pool' }));
		expect(onAction).not.toHaveBeenCalled();
		expect(container.textContent).toContain('will show a gap');
		expect(queryByRole('button', { name: 'leave pool' })).toBeNull();

		// Second click confirms and fires the leave.
		await fireEvent.click(getByRole('button', { name: 'confirm leave' }));
		expect(onAction).toHaveBeenCalledWith({ action: 'leave' });
	});

	it('renders remote dashboards as read-only for sync management', () => {
		const { queryByLabelText, container } = render(SyncPanel, {
			status: { ...localStatus, managementAllowed: false },
			onAction: vi.fn(async () => {})
		});
		expect(queryByLabelText('PostgreSQL URL')).toBeNull();
		expect(container.textContent).toContain('Sync setup is local-only');
	});
});
