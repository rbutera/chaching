import { describe, expect, it } from 'vitest';
import { accountWindowValues } from './accounts';

function input(): Parameters<typeof accountWindowValues>[0] {
	return {
		from: '2026-08-12', to: '2026-09-10', providers: new Set(), machines: new Set(), selected: new Set(), models: new Set(),
		accounts: ['a', 'b'].map(id => ({ id, provider: 'claude', name: id, account: '', tier: 'max', monthlyUsd: 200 })),
		mappings: ['a', 'b'].map(subscriptionId => ({ machineId: 'one', provider: 'claude', subscriptionId })),
		grain: [{ day: '2026-09-10', provider: 'claude', model: 'model', machineId: 'one', cost: 2000, requests: 1, costUnknownRequests: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 } }]
	};
}

describe('Account window values', () => {
	it('marks missing Account references unavailable without counting excluded Accounts', () => {
		const data = input();
		data.grain[0].subscriptionId = 'missing';
		expect(accountWindowValues(data).valueUsd).toBeNull();
		expect(accountWindowValues({ ...data, selected: new Set(['a']) }).valueUsd).toBe(0);
		data.grain[0].subscriptionId = 'b';
		expect(accountWindowValues({ ...data, selected: new Set(['a']) }).valueUsd).toBe(0);
	});
	it('retains combined usage across known Accounts without inventing a split', () => {
		const result = accountWindowValues(input());
		expect(result.valueUsd).toBe(2000);
		expect(result.feeUsd).toBe(400);
		expect(result.rows.map(row => row.valueUsd)).toEqual([null, null]);
		const partial = accountWindowValues({ ...input(), selected: new Set(['a']) });
		expect(partial.valueUsd).toBeNull();
		expect(partial.feeUsd).toBe(200);
	});

	it('counts a shared fee once and charges the same period fee to a machine view', () => {
		const data = input();
		data.from = '2026-09-04';
		data.accounts = [{ ...data.accounts[0], monthlyUsd: 300 }];
		data.mappings = ['one', 'two'].map(machineId => ({ machineId, provider: 'claude', subscriptionId: 'a' }));
		data.grain = [...data.grain, { ...data.grain[0], machineId: 'two', cost: 1000 }];
		expect(accountWindowValues(data)).toMatchObject({ feeUsd: 70, valueUsd: 3000 });
		expect(accountWindowValues({ ...data, machines: new Set(['one']) })).toMatchObject({ feeUsd: 70, valueUsd: 2000 });
	});

	it('retains zero-use and unknown-fee Accounts under model filtering', () => {
		const data = input();
		data.grain[0].subscriptionId = 'a';
		data.accounts[1].monthlyUsd = null;
		expect(accountWindowValues(data)).toMatchObject({ valueUsd: 2000, feeUsd: null });
		const filtered = accountWindowValues({ ...data, models: new Set(['other']) });
		expect(filtered).toMatchObject({ valueUsd: 0, feeUsd: null });
		expect(filtered.rows).toHaveLength(2);
		expect(accountWindowValues({ ...data, providers: new Set(['codex']) }).rows).toEqual([]);
	});
});
