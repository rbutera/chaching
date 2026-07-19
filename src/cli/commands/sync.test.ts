import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../lib/core/sync/types';

vi.mock('../../lib/core/sync/manager.js', () => ({
	getSyncStatus: vi.fn(),
	performSyncAction: vi.fn(),
	setSyncInterval: vi.fn()
}));

import { getSyncStatus, performSyncAction } from '../../lib/core/sync/manager.js';
import { runSync } from './sync';

function status(subscriptions: SyncStatus['subscriptions']): SyncStatus {
	return {
		enabled: true,
		databaseConfigured: true,
		pool: { id: 'pool-1', name: 'Rai machines' },
		machine: { id: 'machine-1', name: 'kinto', hostname: 'kinto', lastSeenAt: null },
		machines: [],
		subscriptions,
		mappings: []
	};
}

describe('sync subscription add', () => {
	beforeEach(() => vi.clearAllMocks());

	it('prints the newly created ID when sorted subscriptions end with an older row', async () => {
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
			'subscription',
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

		expect(log).toHaveBeenCalledWith('added subscription Nimbus Claude Max (nimbus-id)');
		log.mockRestore();
	});
});
