import type { ProviderQuotaAccount, ProviderQuotaStatus, SyncAccount, SyncMapping } from '@chaching/shared/sync-types';

export interface QuotaRow extends ProviderQuotaAccount {
	key: string;
	observedAt: string | null;
	machines: string[];
	currentMachines: string[];
}

export function quotaRows(statuses: ProviderQuotaStatus[], providers: ReadonlySet<string>, machines: ReadonlySet<string>,
	accounts: ReadonlySet<string> = new Set(), knownAccounts: readonly Pick<SyncAccount, 'id' | 'provider' | 'identityKey' | 'name'>[] = [],
	mappings: readonly SyncMapping[] = []): QuotaRow[] {
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
	for (const account of knownAccounts) {
		if ((providers.size && !providers.has(account.provider)) || (accounts.size && !accounts.has(account.id))) continue;
		const key = `${account.provider}:account:${account.id}`;
		if (rows.has(key)) continue;
		const linked = [...new Set(mappings.filter(mapping => mapping.accountId === account.id && mapping.provider === account.provider &&
			(!machines.size || machines.has(mapping.machineId))).map(mapping => mapping.machineId))];
		if (machines.size && !linked.length) continue;
		rows.set(key, { key, accountId: account.id, label: account.name, provider: account.provider,
			plan: null, observedAt: null, windows: [], hardLimitReached: false, machines: linked, currentMachines: [] });
	}
	return [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}
