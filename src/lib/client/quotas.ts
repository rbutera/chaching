import type { ProviderQuotaAccount, ProviderQuotaStatus } from '$lib/core/sync/types';

export interface QuotaRow extends ProviderQuotaAccount {
	key: string;
	observedAt: string | null;
	machines: string[];
	currentMachines: string[];
}

export function quotaRows(statuses: ProviderQuotaStatus[], providers: ReadonlySet<string>, machines: ReadonlySet<string>): QuotaRow[] {
	const rows = new Map<string, QuotaRow>();
	for (const status of statuses) {
		if (machines.size && !machines.has(status.machineId)) continue;
		for (const [index, account] of status.accounts.entries()) {
			if (providers.size && !providers.has(account.provider)) continue;
			const key = account.identityKey
				? `${account.provider}:${account.identityKey}`
				: `${status.machineId}:${status.source}:${index}`;
			const observedAt = account.observedAt === undefined ? status.observedAt : account.observedAt;
			const prior = rows.get(key);
			const newer = !prior || (observedAt === null ? -Infinity : Date.parse(observedAt)) > (prior.observedAt === null ? -Infinity : Date.parse(prior.observedAt));
			rows.set(key, {
				...(newer ? account : prior), key,
				observedAt: newer ? observedAt : prior.observedAt,
				machines: [...new Set([...(prior?.machines ?? []), status.machineId])],
				currentMachines: [...new Set([...(prior?.currentMachines ?? []), ...(account.current ? [status.machineId] : [])])]
			});
		}
	}
	return [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}
