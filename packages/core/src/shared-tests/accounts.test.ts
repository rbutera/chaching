import { describe, expect, it } from 'vitest';
import { accountWindowValues, reportAccountFees, accountFeesByProvider } from '@chaching/shared/accounts';
import { defaultConfig } from '@chaching/core/config';

function input(): Parameters<typeof accountWindowValues>[0] {
	return {
		from: '2026-08-12', to: '2026-09-10', providers: new Set(), machines: new Set(), models: new Set(),
		accounts: ['a', 'b'].map(id => ({ id, provider: 'claude', name: id, account: '', tier: 'max', monthlyUsd: 200 })),
		mappings: ['a', 'b'].map(accountId => ({ machineId: 'one', provider: 'claude', accountId })),
		grain: [{ day: '2026-09-10', provider: 'claude', model: 'model', machineId: 'one', cost: 2000, requests: 1, costUnknownRequests: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 } }]
	};
}

describe('Account window values', () => {
	it('uses all distinct pool bills in reports and never substitutes local fees offline', () => {
		const cfg = defaultConfig();
		cfg.providers.claude.enabled = false;
		const account = input().accounts[0];
		const fees = reportAccountFees(cfg, { enabled: true, accounts: [account, account, { ...account, id: 'peer', monthlyUsd: 300 }] });
		expect(fees.claude).toMatchObject({ enabled: true, monthlyUsd: 500 });
		expect(reportAccountFees(cfg, { enabled: true, unreachable: true, accounts: [account] }).claude.monthlyUsd).toBeNull();
		expect(reportAccountFees(cfg, { enabled: true, unreachable: true, accounts: [] }).claude).toMatchObject({ enabled: true, monthlyUsd: null });
		expect(reportAccountFees(cfg, { enabled: true, accounts: [account, { ...account, id: 'peer', monthlyUsd: null }] }).claude.monthlyUsd).toBeNull();
	});
	it('retains provider spend independently of missing or ambiguous Account attribution', () => {
		const data = input();
		for (const accountId of [undefined, 'missing', 'a']) {
			data.grain[0].accountId = accountId;
			expect(accountWindowValues(data)).toMatchObject({ valueUsd: 2000, feeUsd: 400 });
		}
		data.mappings = [];
		data.grain[0].accountCandidates = ['missing', 'b'];
		expect(accountWindowValues(data)).toMatchObject({ valueUsd: 2000, feeUsd: 400 });
		expect(accountWindowValues(data).rows.every(row => !('valueUsd' in row))).toBe(true);
	});

	it('counts a shared fee once and charges the same period fee to a machine view', () => {
		const data = input();
		data.from = '2026-09-04';
		data.accounts = [{ ...data.accounts[0], monthlyUsd: 300 }];
		data.mappings = ['one', 'two'].map(machineId => ({ machineId, provider: 'claude', accountId: 'a' }));
		data.grain = [...data.grain, { ...data.grain[0], machineId: 'two', cost: 1000 }];
		expect(accountWindowValues(data)).toMatchObject({ feeUsd: 70, valueUsd: 3000 });
		expect(accountWindowValues({ ...data, machines: new Set(['one']) })).toMatchObject({ feeUsd: 70, valueUsd: 2000 });
	});

	it('retains zero-use and unknown-fee Accounts under model filtering', () => {
		const data = input();
		data.grain[0].accountId = 'a';
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
	const status = { enabled: true, accounts: [...accounts, { ...accounts[0], id: 'peer-only', monthlyUsd: 900 }], mappings: [
		{ machineId: 'one', provider: 'claude', accountId: 'a' },
		{ machineId: 'two', provider: 'claude', accountId: 'a' },
		{ machineId: 'one', provider: 'claude', accountId: 'b' }
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


it('keeps unresolved pooled fee totals unknown in dashboard and reports', () => {
	const cfg = defaultConfig();
	const data = input();
	cfg.accounts = [{ ...data.accounts[0], id: 'pending', feeSource: 'inferred', identity: null,
		registrations: [], legacy: false, pendingLegacyIds: ['a'] }];
	const other = { ...data.accounts[0], id: 'codex', provider: 'codex', monthlyUsd: 20 };
	data.accounts = [...data.accounts, other];
	const values = accountWindowValues({ ...data, localAccounts: cfg.accounts });
	expect(values.feeUsd).toBeNull();
	expect(values.valueUsd).toBe(2000);
	expect(values.rows.filter(row => row.provider === 'claude').map(row => row.feeUsd)).toEqual([null, null]);
	expect(values.rows.find(row => row.id === 'codex')?.feeUsd).toBe(20);
	expect(reportAccountFees(cfg, { enabled: true, accounts: [...data.accounts] }).claude.monthlyUsd).toBeNull();
	expect(accountWindowValues({ ...data, localAccounts: cfg.accounts, providers: new Set(['codex']) }).feeUsd).toBe(20);
	cfg.accounts[0].pendingLegacyIds = [];
	expect(accountWindowValues({ ...data, localAccounts: cfg.accounts }).feeUsd).toBe(420);
});
