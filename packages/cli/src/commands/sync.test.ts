import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '@chaching/shared/sync-types';

vi.mock('@chaching/core/sync/manager', () => ({
	getSyncStatus: vi.fn(),
	performSyncAction: vi.fn(),
	setSyncInterval: vi.fn()
}));

import { getSyncStatus, performSyncAction } from '@chaching/core/sync/manager';
import { runSync } from './sync';

function status(accounts: SyncStatus['accounts']): SyncStatus {
	return {
		enabled: true,
		databaseConfigured: true,
		pool: { id: 'pool-1', name: 'Rai machines' },
		machine: { id: 'machine-1', name: 'kinto', hostname: 'kinto', lastSeenAt: null },
		machines: [],
		accounts,
		mappings: []
	};
}

describe('sync Account commands', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([[], ['foo'], ['status'], ['--help']])('rejects unsupported Account subcommands %j', async (...args) => {
		await expect(runSync(['account', ...args])).rejects.toThrow('expected create|join');
		expect(performSyncAction).not.toHaveBeenCalled();
		expect(getSyncStatus).not.toHaveBeenCalled();
	});

	it.each(['account', 'subscription'])('%s add prints the newly created ID', async (command) => {
		const work = {
			id: 'work-id',
			provider: 'claude',
			name: 'Work Claude Max',
			account: 'work-shared',
			tier: 'max-20x',
			monthlyUsd: 200
		};
		const nimbus = {
			id: 'nimbus-id',
			provider: 'claude',
			name: 'Nimbus Claude Max',
			account: 'nimbus-personal',
			tier: 'max-20x',
			monthlyUsd: 200
		};
		vi.mocked(getSyncStatus).mockResolvedValue(status([work]));
		vi.mocked(performSyncAction).mockResolvedValue(status([nimbus, work]));
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await runSync([
			command,
			'add',
			'--provider',
			'claude',
			'--name',
			'Nimbus Claude Max',
			'--tier',
			'max-20x',
			'--monthly-usd',
			'200'
		]);

		expect(performSyncAction).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'add-account' })
		);
		expect(log).toHaveBeenCalledWith('added Account Nimbus Claude Max (nimbus-id)');
		log.mockRestore();
	});
	it.each(['--account', '--subscription'])('maps using %s', async (flag) => {
		vi.mocked(getSyncStatus).mockResolvedValue(status([]));
		vi.mocked(performSyncAction).mockResolvedValue(status([]));
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await runSync(['map', '--provider', 'claude', flag, 'account-1']);
		expect(performSyncAction).toHaveBeenCalledWith({
			action: 'map',
			machineId: 'machine-1',
			provider: 'claude',
			accountId: 'account-1'
		});
		log.mockRestore();
	});
});
