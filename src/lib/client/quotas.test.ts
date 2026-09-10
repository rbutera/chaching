import { describe, expect, it } from 'vitest';
import { quotaRows } from './quotas';
import type { ProviderQuotaStatus } from '$lib/core/sync/types';

describe('quotaRows', () => {
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
