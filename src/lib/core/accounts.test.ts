import { describe, expect, it } from 'vitest';
import { accountWindowValues, reportAccountFees, accountFeesByProvider } from './accounts';
import { defaultConfig } from './config';

function input(): Parameters<typeof accountWindowValues>[0] {
	return {
		from: '2026-08-12', to: '2026-09-10', providers: new Set(), machines: new Set(), selected: new Set(), models: new Set(),
		accounts: ['a', 'b'].map(id => ({ id, provider: 'claude', name: id, account: '', tier: 'max', monthlyUsd: 200 })),
		mappings: ['a', 'b'].map(subscriptionId => ({ machineId: 'one', provider: 'claude', subscriptionId })),
		grain: [{ day: '2026-09-10', provider: 'claude', model: 'model', machineId: 'one', cost: 2000, requests: 1, costUnknownRequests: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 } }]
	};
}

describe('Account window values', () => {
	it('uses all distinct pool bills in reports and never substitutes local fees offline', () => {
		const cfg = defaultConfig();
		cfg.providers.claude.enabled = false;
		const account = input().accounts[0];
		const fees = reportAccountFees(cfg, { enabled: true, subscriptions: [account, account, { ...account, id: 'peer', monthlyUsd: 300 }] });
		expect(fees.claude).toMatchObject({ enabled: true, monthlyUsd: 500 });
		expect(reportAccountFees(cfg, { enabled: true, unreachable: true, subscriptions: [account] }).claude.monthlyUsd).toBeNull();
		expect(reportAccountFees(cfg, { enabled: true, unreachable: true, subscriptions: [] }).claude).toMatchObject({ enabled: true, monthlyUsd: null });
		expect(reportAccountFees(cfg, { enabled: true, subscriptions: [account, { ...account, id: 'peer', monthlyUsd: null }] }).claude.monthlyUsd).toBeNull();
	});
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


it('retains one whole shared bill for a selected machine, including its unused Accounts', () => {
	const { accounts } = input();
	const status = { enabled: true, subscriptions: [...accounts, { ...accounts[0], id: 'peer-only', monthlyUsd: 900 }], mappings: [
		{ machineId: 'one', provider: 'claude', subscriptionId: 'a' },
		{ machineId: 'two', provider: 'claude', subscriptionId: 'a' },
		{ machineId: 'one', provider: 'claude', subscriptionId: 'b' }
	] };
	const cfg = defaultConfig();
	expect(reportAccountFees(cfg, status, { machines: ['one'] }).claude.monthlyUsd).toBe(400);
	expect(reportAccountFees(cfg, status, { machines: ['two'] }).claude.monthlyUsd).toBe(200);
	const selected = reportAccountFees(cfg, status, { machines: ['one'], accountIds: ['a'] });
	expect(selected.claude.monthlyUsd).toBe(200);
	expect(selected.codex.enabled).toBe(false);
	expect(reportAccountFees(cfg, status, { machines: ['one'], accountIds: ['peer-only'] }).claude.enabled).toBe(false);
});


it('retains configured local Account fees when provider scanning is disabled', () => {
	const cfg = defaultConfig();
	cfg.providers.claude.enabled = false;
	cfg.accounts = [{ ...input().accounts[0], feeSource: 'explicit', identity: null, registrations: [], legacy: false }];
	cfg.providerAccounts.claude = ['a'];
	expect(accountFeesByProvider(cfg).claude).toMatchObject({ enabled: true, monthlyUsd: 200 });
	cfg.providerAccounts.claude = ['missing'];
	expect(accountFeesByProvider(cfg).claude).toMatchObject({ enabled: true, monthlyUsd: null });
});
