import type { ProviderQuotaAccount, ProviderQuotaStatus, SyncSubscription } from '$lib/core/sync/types';

export interface QuotaRow extends ProviderQuotaAccount {
	key: string;
	observedAt: string | null;
	machines: string[];
	currentMachines: string[];
}

export function quotaRows(statuses: ProviderQuotaStatus[], providers: ReadonlySet<string>, machines: ReadonlySet<string>,
	accounts: ReadonlySet<string> = new Set(), knownAccounts: readonly Pick<SyncSubscription, 'id' | 'provider' | 'identityKey' | 'name'>[] = []): QuotaRow[] {
	const rows = new Map<string, QuotaRow>();
	for (const status of statuses) {
		if (machines.size && !machines.has(status.machineId)) continue;
		for (const [index, account] of status.accounts.entries()) {
			if (providers.size && !providers.has(account.provider)) continue;
			const canonical = knownAccounts.find(row => row.provider === account.provider &&
				(row.identityKey && account.identityKey ? row.identityKey === account.identityKey : row.id === account.accountId));
			const accountId = canonical?.id ?? (knownAccounts.length ? undefined : account.accountId);
			if (accounts.size && (!accountId || !accounts.has(accountId))) continue;
			const key = accountId ? `${account.provider}:account:${accountId}` : account.identityKey
				? `${account.provider}:${account.identityKey}`
				: `${status.machineId}:${status.source}:${index}`;
			const observedAt = account.observedAt === undefined ? status.observedAt : account.observedAt;
			const prior = rows.get(key);
			const newer = !prior || (observedAt === null ? -Infinity : Date.parse(observedAt)) > (prior.observedAt === null ? -Infinity : Date.parse(prior.observedAt));
			rows.set(key, {
				...(newer ? account : prior), key,
				accountId,
				label: canonical?.name ?? (newer ? account.label : prior.label),
				observedAt: newer ? observedAt : prior.observedAt,
				machines: [...new Set([...(prior?.machines ?? []), status.machineId])],
				currentMachines: [...new Set([...(prior?.currentMachines ?? []), ...(account.current ? [status.machineId] : [])])]
			});
		}
	}
	return [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}
