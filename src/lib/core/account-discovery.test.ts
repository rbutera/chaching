import { describe, expect, it } from 'vitest';
import { accountQuotaSnapshot, matchLegacyAccount, reconcileAccounts } from './account-discovery';
import { defaultConfig, normalizeConfig, publicConfig } from './config';
import { accountFeesByProvider } from './accounts';
import type { DiscoveredAccount } from './providers/tokenmaxx/sqlite';

function discovered(id: string, plan = 'pro', registrationId = id): DiscoveredAccount {
	return {
		registrationId, provider: 'claude', identity: { accountId: id, userId: null }, plan,
		quota: { label: 'Claude', provider: 'claude', plan, observedAt: null, hardLimitReached: false, windows: [] }
	};
}

describe('Account discovery', () => {
	it('keeps one Account across registrations, preserves an explicit fee and retains removed aliases', () => {
		let config = reconcileAccounts(defaultConfig(), [discovered('login', 'pro', 'old'), discovered('login', 'pro', 'current')]);
		expect(config.accounts).toHaveLength(1);
		const id = config.accounts[0].id;
		expect(config.accounts[0]).toMatchObject({ monthlyUsd: 20, feeSource: 'inferred', registrations: ['current', 'old'] });
		config.accounts[0].monthlyUsd = 73;
		config.accounts[0].feeSource = 'explicit';
		config = reconcileAccounts(config, [discovered('login', 'default_claude_max_20x', 'replacement')]);
		expect(config.accounts[0]).toMatchObject({ id, monthlyUsd: 73, registrations: ['current', 'old', 'replacement'] });
		expect(reconcileAccounts(config, [])).toEqual(config);
		const unavailable = accountQuotaSnapshot(config, [])?.accounts[0];
		expect(unavailable).toMatchObject({ accountId: id, observedAt: null, windows: [] });
		expect(JSON.stringify(publicConfig(config))).not.toContain('replacement');
	});


	it.each([
		['claude_max_5x', 'max-5x', 100],
		['claude_max_20x', 'max-20x', 200],
		['default_claude_max_5x', 'max-5x', 100],
		['default_claude_max_20x', 'max-20x', 200]
	])('recognizes Tokenmaxx plan %s for inference and legacy matching', (plan, tier, fee) => {
		const inferred = reconcileAccounts(defaultConfig(), [discovered('login', plan)]);
		expect(inferred.accounts[0]).toMatchObject({ tier, monthlyUsd: fee });
		const legacy = normalizeConfig({ providers: { claude: { subscription: { tier, monthlyUsd: 175 } } } });
		const matched = reconcileAccounts(legacy, [discovered('login', plan)]);
		expect(matched.accounts).toHaveLength(1);
		expect(matched.accounts[0]).toMatchObject({ id: legacy.accounts[0].id, monthlyUsd: 175, legacy: false });
	});
	it('preserves the legacy bill ID and fee when exactly one tier matches', () => {
		const legacy = normalizeConfig({ history: { enabled: false }, sync: { providerSubscriptions: { claude: 'existing-bill' } }, providers: { claude: { subscription: { tier: 'max-20x', monthlyUsd: 175 } } } });
		const config = reconcileAccounts(legacy, [discovered('other', 'pro'), discovered('matching', 'default_claude_max_20x')]);
		expect(config.accounts).toHaveLength(2);
		expect(config.accounts.find(a => a.id === 'existing-bill')).toMatchObject({ identity: { accountId: 'matching', userId: null }, monthlyUsd: 175, feeSource: 'explicit', legacy: false });
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBe(195);
		expect(reconcileAccounts(config, [discovered('matching', 'default_claude_max_20x'), discovered('other', 'pro')])).toEqual(config);
	});


	it('resolves a pending legacy bill when a later observation finally supplies its plan', () => {
		const legacy = normalizeConfig({ providers: { claude: { subscription: { tier: 'max-20x', monthlyUsd: 175 } } } });
		const pending = reconcileAccounts(legacy, [discovered('login', 'unknown', 'first')]);
		expect(pending.accounts).toHaveLength(2);
		expect(accountFeesByProvider(pending).claude.monthlyUsd).toBeNull();
		const resolved = reconcileAccounts(pending, [discovered('login', 'claude_max_20x', 'second')]);
		expect(resolved.accounts).toHaveLength(1);
		expect(resolved.accounts[0]).toMatchObject({ id: legacy.accounts[0].id, monthlyUsd: 175, registrations: ['first', 'second'], legacy: false });
		expect(accountFeesByProvider(resolved).claude.monthlyUsd).toBe(175);
	});
	it('matches interchangeable bills deterministically and consumes each identity once', () => {
		const legacy = normalizeConfig({ providers: { claude: { subscription: { tier: 'pro', monthlyUsd: 20 } } } });
		legacy.accounts[0].id = 'bill-a';
		legacy.accounts.push({ ...legacy.accounts[0], id: 'bill-b' });
		legacy.providerAccounts.claude = ['bill-a', 'bill-b'];
		const config = reconcileAccounts(legacy, [discovered('z'), discovered('a')]);
		expect(config.accounts.map(a => [a.id, a.identity?.accountId])).toEqual([['bill-a', 'a'], ['bill-b', 'z']]);
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBe(40);
	});

	it('keeps conflicting bills unresolved and matches explicitly without creating a second bill', () => {
		const legacy = normalizeConfig({ providers: { claude: { subscription: { tier: 'pro', monthlyUsd: 20 } } } });
		legacy.accounts[0].id = 'bill-a';
		legacy.accounts.push({ ...legacy.accounts[0], id: 'bill-b', monthlyUsd: 30 });
		legacy.providerAccounts.claude = ['bill-a', 'bill-b'];
		let config = reconcileAccounts(legacy, [discovered('login-a'), discovered('login-b')]);
		const candidate = config.accounts.find(a => a.identity?.accountId === 'login-a')!;
		expect(candidate.pendingLegacyIds).toEqual(['bill-a', 'bill-b']);
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBeNull();
		config = matchLegacyAccount(config, candidate.id, 'bill-b');
		expect(config.accounts.find(a => a.id === 'bill-b')).toMatchObject({ monthlyUsd: 30, identity: { accountId: 'login-a', userId: null } });
		expect(config.accounts.some(a => a.id === candidate.id)).toBe(false);
		const remaining = config.accounts.find(a => a.identity?.accountId === 'login-b')!;
		expect(remaining.pendingLegacyIds).toEqual(['bill-a']);
		config = matchLegacyAccount(config, remaining.id, 'bill-a');
		expect(config.accounts).toHaveLength(2);
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBe(50);
		expect(() => matchLegacyAccount(config, 'bill-a', 'bill-b')).toThrow();
	});


	it('activates a separate fee only after the user explicitly resolves it as a separate Account', () => {
		const legacy = normalizeConfig({ providers: { claude: { subscription: { tier: 'custom', monthlyUsd: 99 } } } });
		const pending = reconcileAccounts(legacy, [discovered('new-login')]);
		const candidate = pending.accounts.find(a => a.identity)!;
		expect(accountFeesByProvider(pending).claude.monthlyUsd).toBeNull();
		const separate = matchLegacyAccount(pending, candidate.id, null);
		expect(accountFeesByProvider(separate).claude.monthlyUsd).toBe(119);
		expect(reconcileAccounts(separate, [discovered('new-login')])).toEqual(separate);
	});
	it('keeps unrecognized plans unknown and requires stable OpenAI user identity', () => {
		const a = discovered('org', 'mystery');
		const b: DiscoveredAccount = { ...a, provider: 'codex', identity: { accountId: 'org', userId: 'one' }, quota: { ...a.quota, provider: 'codex' } };
		const c = { ...b, identity: { accountId: 'org', userId: 'two' } };
		const config = reconcileAccounts(defaultConfig(), [a, b, c, { ...a, identity: null }]);
		expect(config.accounts).toHaveLength(3);
		expect(config.accounts.every(a => a.monthlyUsd === null)).toBe(true);
		expect(JSON.stringify(publicConfig(config))).not.toContain('"accountId"');
	});
});
