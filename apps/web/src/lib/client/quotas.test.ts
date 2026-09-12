import { describe, expect, it } from 'vitest';
import { quotaRows } from './quotas';
import type { ProviderQuotaStatus } from '@chaching/shared/sync-types';

describe('quotaRows', () => {
	it('retains Accounts without observations, respecting machine and Account scopes', () => {
		const accounts = [{ id: 'peer', provider: 'codex', name: 'Peer only', identityKey: null }];
		const mappings = [{ machineId: 'two', provider: 'codex', accountId: 'peer' }];
		const all = quotaRows([], new Set(), new Set(), new Set(), accounts, mappings);
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ accountId: 'peer', observedAt: null, windows: [], machines: ['two'], currentMachines: [] });
		expect(quotaRows([], new Set(), new Set(['one']), new Set(), accounts, mappings)).toEqual([]);
		expect(quotaRows([], new Set(), new Set(['two']), new Set(['peer']), accounts, mappings)).toHaveLength(1);
		expect(quotaRows([], new Set(['claude']), new Set(), new Set(), accounts, mappings)).toEqual([]);
		expect(quotaRows([], new Set(), new Set(), new Set(['other']), accounts, mappings)).toEqual([]);
		expect(quotaRows([], new Set(), new Set(), new Set(), accounts)[0].machines).toEqual([]);
	});
	it('filters by the canonical pool Account even when peer local IDs differ', () => {
		const accounts = [{ id: 'pool-account', provider: 'claude', identityKey: 'v1:shared', name: 'Work' }];
		const statuses: ProviderQuotaStatus[] = ['one', 'two'].map((machineId, index) => ({
			machineId, source: 'tokenmaxx', observedAt: `2026-09-10T1${index}:00:00Z`,
			accounts: [{ accountId: `local-${machineId}`, identityKey: 'v1:shared', provider: 'claude', label: 'Old label', plan: 'pro', hardLimitReached: false, windows: [], current: true }]
		}));
		const rows = quotaRows(statuses, new Set(), new Set(), new Set(['pool-account']), accounts);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ accountId: 'pool-account', label: 'Work', machines: ['one', 'two'] });
		expect(quotaRows(statuses, new Set(), new Set(), new Set(['local-one']), accounts)).toEqual([]);
		expect(quotaRows(statuses, new Set(), new Set(['two']), new Set(['pool-account']), accounts)[0].machines).toEqual(['two']);
		statuses[0].accounts[0].identityKey = 'v1:different';
		statuses[0].accounts[0].accountId = 'pool-account';
		expect(quotaRows([statuses[0]], new Set(), new Set(), new Set(['pool-account']), accounts)).toMatchObject([{ accountId: 'pool-account', observedAt: null, windows: [] }]);
	});
	it('uses the newest observation without losing per-machine selections or filtering them away', () => {
		const statuses: ProviderQuotaStatus[] = ['one', 'two'].map((machineId, index) => ({
			machineId, source: 'tokenmaxx', observedAt: `2026-09-10T1${index}:00:00Z`,
			accounts: [{
				identityKey: 'v1:shared', label: 'Claude account', provider: 'claude', plan: 'max',
				current: index === 0, hardLimitReached: false,
				windows: [{ id: '5h', label: '5h', usedPercent: 20 + index, resetAt: null }]
			}]
		}));
		const [row] = quotaRows(statuses, new Set(), new Set());
		expect(row.machines).toEqual(['one', 'two']);
		expect(row.currentMachines).toEqual(['one']);
		expect(row.windows[0].usedPercent).toBe(21);
		expect(quotaRows(statuses, new Set(), new Set(['one']))[0].windows[0].usedPercent).toBe(20);
		expect(quotaRows(statuses, new Set(['codex']), new Set())).toEqual([]);
		for (const status of statuses) delete status.accounts[0].identityKey;
		expect(quotaRows(statuses, new Set(), new Set())).toHaveLength(2);
	});
	it('keeps a real observation when a newer scan has no quota snapshot', () => {
		const account = {
			identityKey: 'same-account', label: 'Claude', provider: 'claude', plan: 'pro',
			hardLimitReached: false, windows: [{ id: '5h', label: '5h', usedPercent: 25, resetAt: null }]
		};
		const statuses: ProviderQuotaStatus[] = [
			{ machineId: 'old', source: 'tokenmaxx', observedAt: '2026-09-10T10:00:00Z', accounts: [account] },
			{ machineId: 'new', source: 'tokenmaxx', observedAt: '2026-09-10T12:00:00Z', accounts: [{ ...account, observedAt: null, windows: [], current: true }] }
		];
		for (const input of [statuses, [...statuses].reverse()]) {
			const row = quotaRows(input, new Set(), new Set())[0];
			expect(row.observedAt).toBe('2026-09-10T10:00:00Z');
			expect(row.windows[0].usedPercent).toBe(25);
			expect(row.currentMachines).toEqual(['new']);
		}
		const missing = quotaRows([statuses[1]], new Set(), new Set())[0];
		expect(missing.observedAt).toBeNull();
		expect(missing.windows).toEqual([]);
	});

});
