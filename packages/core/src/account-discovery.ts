import { randomUUID } from 'node:crypto';
import { loadConfig, updateConfig, type chachingConfig } from './config';
import { expandPath } from './fs-utils';
import type { ProviderQuotaAccount } from '@chaching/shared/sync-types';
import type { PrivateAccount } from '@chaching/shared/accounts';
import { SUBSCRIPTION_PRESETS } from '@chaching/shared/subscription-presets';
import { accountIdentityKey, readTokenmaxxAccounts, type DiscoveredAccount, type TokenmaxxQuotaSnapshot } from './providers/tokenmaxx/sqlite';

function identityKey(provider: string, identity: PrivateAccount['identity']): string | null {
	return identity ? JSON.stringify([provider, identity.accountId, provider === 'codex' ? identity.userId : null]) : null;
}

function discoveredPlan(account: DiscoveredAccount) {
	const tier = (account.plan ?? 'unknown').replace(/^(?:default_)?claude_/, '').replaceAll('_', '-');
	return { tier, monthlyUsd: SUBSCRIPTION_PRESETS[account.provider].find(p => p.id === tier && !p.custom)?.monthlyUsd ?? null };
}

export function reconcileAccounts(config: chachingConfig, discovered: DiscoveredAccount[]): chachingConfig {
	let accounts = structuredClone(config.accounts);
	let providerAccounts = structuredClone(config.providerAccounts);
	const identities = new Map<string, DiscoveredAccount[]>();
	for (const account of discovered) {
		const key = identityKey(account.provider, account.identity);
		if (key) identities.set(key, [...(identities.get(key) ?? []), account]);
	}
	const candidates = [...identities.entries()].sort(([a], [b]) => a.localeCompare(b));
	for (const [, registrations] of candidates) registrations.sort((a, b) =>
		Number(b.quota.current === true) - Number(a.quota.current === true) ||
		(b.quota.observedAt ? Date.parse(b.quota.observedAt) : 0) - (a.quota.observedAt ? Date.parse(a.quota.observedAt) : 0) ||
		a.registrationId.localeCompare(b.registrationId));
	function bind(account: PrivateAccount, registrations: DiscoveredAccount[]) {
		const observed = registrations[0];
		account.identity = observed.identity;
		account.registrations = [...new Set([...account.registrations, ...registrations.map(r => r.registrationId)])].sort();
		account.legacy = false;
		if (account.feeSource === 'inferred') Object.assign(account, discoveredPlan(observed));
		providerAccounts[account.provider] = [...new Set([...(providerAccounts[account.provider] ?? []), account.id])];
	}
	const unmatched = candidates.filter(([key, registrations]) => {
		const existing = accounts.find(account => identityKey(account.provider, account.identity) === key);
		if (!existing) return true;
		bind(existing, registrations);
		if (existing.pendingLegacyIds?.length) {
			existing.pendingLegacyIds = accounts.filter(account => account.provider === existing.provider && account.legacy && !account.identity).map(account => account.id);
			if (!existing.pendingLegacyIds.length) delete existing.pendingLegacyIds;
		}
		return Boolean(existing.pendingLegacyIds?.length);
	});
	for (const provider of ['claude', 'codex'] as const) {
		const legacy = accounts.filter(account => account.provider === provider && account.legacy && !account.identity);
		for (const tier of new Set(legacy.map(account => account.tier))) {
			const bills = legacy.filter(account => account.tier === tier).sort((a, b) => a.id.localeCompare(b.id));
			const matches = unmatched.filter(([, registrations]) => registrations[0].provider === provider && discoveredPlan(registrations[0]).tier === tier);
			if (!matches.length || new Set(bills.map(account => account.monthlyUsd)).size > 1) continue;
			for (const [index, bill] of bills.entries()) {
				const match = matches[index];
				if (!match) break;
				const candidate = accounts.find(account => identityKey(account.provider, account.identity) === match[0]);
				if (candidate?.pendingLegacyIds?.includes(bill.id)) {
					const merged = matchLegacyAccount({ ...config, accounts, providerAccounts }, candidate.id, bill.id);
					accounts = merged.accounts;
					providerAccounts = merged.providerAccounts;
				} else {
					const currentBill = accounts.find(account => account.id === bill.id);
					if (currentBill) bind(currentBill, match[1]);
				}
				unmatched.splice(unmatched.indexOf(match), 1);
			}
		}
	}
	for (const [key, registrations] of unmatched) {
		const observed = registrations[0];
		const existing = accounts.find(account => identityKey(account.provider, account.identity) === key);
		const pendingLegacyIds = accounts.filter(account => account.provider === observed.provider && account.legacy && !account.identity).map(account => account.id);
		if (existing) {
			if (pendingLegacyIds.length) existing.pendingLegacyIds = pendingLegacyIds;
			else delete existing.pendingLegacyIds;
			continue;
		}
		const account: PrivateAccount = {
			id: randomUUID(), provider: observed.provider,
			name: `${observed.provider === 'claude' ? 'Claude' : 'Codex'} ${accounts.filter(account => account.provider === observed.provider).length + 1}`,
			...discoveredPlan(observed), feeSource: 'inferred',
			identity: observed.identity, registrations: [], legacy: false,
			...(pendingLegacyIds.length ? { pendingLegacyIds } : {})
		};
		bind(account, registrations);
		accounts.push(account);
	}
	return { ...config, accounts, providerAccounts };
}

export function matchLegacyAccount(config: chachingConfig, discoveredId: string, legacyId: string | null): chachingConfig {
	const discovered = config.accounts.find(account => account.id === discoveredId);
	if (legacyId === null) {
		if (!discovered?.identity || !discovered.pendingLegacyIds?.length) throw new Error('That Account is not an unresolved match.');
		return { ...config, accounts: config.accounts.map(account => {
			if (account.id !== discoveredId) return account;
			const { pendingLegacyIds: _pending, ...separate } = account;
			return separate;
		}) };
	}
	const legacy = config.accounts.find(account => account.id === legacyId);
	if (!discovered?.identity || !discovered.pendingLegacyIds?.includes(legacyId) ||
		!legacy?.legacy || legacy.identity || legacy.provider !== discovered.provider) {
		throw new Error('That Account is not an unresolved match.');
	}
	return {
		...config,
		accounts: config.accounts.filter(account => account.id !== discoveredId).map(account => {
			const { pendingLegacyIds, ...rest } = account;
			const pending = pendingLegacyIds?.filter(id => id !== legacyId);
			return {
				...rest,
				...(pending?.length ? { pendingLegacyIds: pending } : {}),
				...(account.id === legacyId ? {
					identity: discovered.identity, registrations: [...new Set([...account.registrations, ...discovered.registrations])],
					legacy: false
				} : {})
			};
		}),
		providerAccounts: Object.fromEntries(Object.entries(config.providerAccounts).map(([provider, ids]) =>
			[provider, [...new Set(ids.map(id => id === discoveredId ? legacyId : id))]]))
	};
}

export function accountQuotaSnapshot(config: chachingConfig, discovered: DiscoveredAccount[]): TokenmaxxQuotaSnapshot | null {
	const seen = new Set<string>();
	const quota = (account: PrivateAccount, observation?: ProviderQuotaAccount): ProviderQuotaAccount => ({
		...observation,
		accountId: account.id,
		identityKey: account.identity && config.sync.poolId
			? accountIdentityKey(account.provider, account.identity, config.sync.poolId) : `account:${account.id}`,
		label: account.name, provider: account.provider, plan: account.tier,
		observedAt: observation?.observedAt ?? null,
		hardLimitReached: observation?.hardLimitReached ?? false,
		windows: observation?.windows ?? []
	});
	const accounts = discovered.map(observed => {
		const key = identityKey(observed.provider, observed.identity);
		const account = config.accounts.find(account => account.provider === observed.provider &&
			(key ? identityKey(account.provider, account.identity) === key : account.registrations.includes(observed.registrationId)));
		if (!account) return observed.quota;
		seen.add(account.id);
		return quota(account, observed.quota);
	});
	for (const account of config.accounts) {
		if (!seen.has(account.id) && config.providerAccounts[account.provider]?.includes(account.id)) accounts.push(quota(account));
	}
	if (!accounts.length) return null;
	return { accounts, observedAt: accounts.flatMap(account => account.observedAt ? [account.observedAt] : []).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null };
}

export async function refreshAccountDiscovery(): Promise<chachingConfig> {
	const config = await loadConfig();
	if (!config.tokenmaxx.enabled) return config;
	let discovered: DiscoveredAccount[];
	try { discovered = readTokenmaxxAccounts(expandPath(config.tokenmaxx.dbPath), config.sync.poolId ?? undefined); }
	catch { return config; }
	if (!discovered.length) return config;
	return updateConfig(current => current.tokenmaxx.enabled && current.tokenmaxx.dbPath === config.tokenmaxx.dbPath
		? reconcileAccounts(current, discovered) : current);
}
