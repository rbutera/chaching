import { FEE_PRORATA_DAYS, inclusiveDays, sumFees, type SubsidisedProvider, type ProviderSubsidisationConfig } from './subsidisation';
import type { DayModelAgg } from '../types';
import type { SyncMapping, SyncAccount, SyncStatus } from './sync/types';

export interface AccountValueRow {
	id: string;
	name: string;
	provider: string;
	account: string;
	valueUsd: number | null;
	feeUsd: number | null;
}

export function accountWindowValues({ grain, accounts, mappings, from, to, providers, machines, selected, models }: {
	grain: readonly DayModelAgg[]; accounts: readonly SyncAccount[]; mappings: readonly SyncMapping[];
	from: string; to: string; providers: ReadonlySet<string>; machines: ReadonlySet<string>;
	selected: ReadonlySet<string>; models: ReadonlySet<string>;
}) {
	const machineAccounts = new Set(mappings.filter(row => machines.has(row.machineId)).map(row => row.accountId));
	const days = inclusiveDays(from, to);
	const rows: AccountValueRow[] = [...new Map(accounts.map(account => [account.id, account])).values()]
		.filter(account => (!providers.size || providers.has(account.provider)) &&
			(!machines.size || machineAccounts.has(account.id)) && (!selected.size || selected.has(account.id)))
		.map(account => ({ id: account.id, provider: account.provider, name: account.name, account: account.account,
			valueUsd: 0, feeUsd: account.monthlyUsd === null ? null : account.monthlyUsd * days / FEE_PRORATA_DAYS }));
	const byId = new Map(rows.map(row => [row.id, row]));
	let valueUsd: number | null = 0;
	for (const usage of grain) {
		if (usage.day < from || usage.day > to || (providers.size && !providers.has(usage.provider)) ||
			(models.size && !models.has(usage.model)) || (machines.size && (!usage.machineId || !machines.has(usage.machineId)))) continue;
		const candidates = usage.accountId ? new Set([usage.accountId]) : new Set(mappings
			.filter(mapping => mapping.machineId === usage.machineId && mapping.provider === usage.provider)
			.flatMap(mapping => mapping.accountId ? [mapping.accountId] : []));
		const relevant = rows.filter(row => row.provider === usage.provider && (!candidates.size || candidates.has(row.id)));
		if (!relevant.length) {
			if ([...candidates].some(id => (!selected.size || selected.has(id)) &&
				!accounts.some(account => account.id === id && account.provider === usage.provider))) valueUsd = null;
			continue;
		}
		if (candidates.size === 1) {
			const row = byId.get([...candidates][0]);
			if (row && row.valueUsd !== null) row.valueUsd += usage.cost;
		} else {
			for (const row of relevant) row.valueUsd = null;
		}
		if (!candidates.size || relevant.length !== candidates.size) valueUsd = null;
		else if (valueUsd !== null) valueUsd += usage.cost;
	}
	return { rows, valueUsd, feeUsd: sumFees(rows.map(row => row.feeUsd)), from, to, days };
}

export interface Account {
	id: string;
	provider: string;
	name: string;
	tier: string;
	monthlyUsd: number | null;
	feeSource: 'explicit' | 'inferred';
	pendingLegacyIds?: string[];
}

export interface PrivateAccount extends Account {
	privateLabel?: string;
	pendingPoolId?: string;
	identity: { accountId: string; userId: string | null } | null;
	registrations: string[];
	legacy: boolean;
}

export function accountFeesByProvider(config: {
	accounts: Account[];
	providerAccounts: Record<string, string[]>;
	providers: Record<'claude' | 'codex', { enabled: boolean }>;
}): Record<SubsidisedProvider, ProviderSubsidisationConfig> {
	function forProvider(provider: SubsidisedProvider): ProviderSubsidisationConfig {
		const ids = new Set(config.providerAccounts[provider] ?? []);
		const accounts = config.accounts.filter(account => account.provider === provider && ids.has(account.id));
		return {
			enabled: config.providers[provider].enabled || ids.size > 0,
			tier: accounts.length === 1 ? accounts[0].tier : accounts.length ? `${accounts.length} accounts` : 'unknown',
			monthlyUsd: accounts.length && accounts.length === ids.size && !accounts.some(account => account.pendingLegacyIds?.length) ? sumFees(accounts.map(account => account.monthlyUsd)) : null
		};
	}
	return { claude: forProvider('claude'), codex: forProvider('codex') };
}

export function reportAccountFees(config: Parameters<typeof accountFeesByProvider>[0], status: Pick<SyncStatus, 'enabled' | 'accounts' | 'unreachable'> & Partial<Pick<SyncStatus, 'mappings'>>, scope: { machines?: string[]; accountIds?: string[] } = {}) {
	if (!status.enabled && !scope.accountIds?.length && !scope.machines?.length) return accountFeesByProvider(config);
	const machines = new Set(scope.machines);
	const selected = new Set(scope.accountIds);
	const mapped = new Set(status.mappings?.filter(row => machines.has(row.machineId)).map(row => row.accountId));
	const scoped = machines.size > 0 || selected.size > 0;
	const source = status.enabled ? status.accounts : config.accounts.filter(account => config.providerAccounts[account.provider]?.includes(account.id));
	const accounts = [...new Map(source.map(account => [account.id, account])).values()]
		.filter(account => (!machines.size || mapped.has(account.id)) && (!selected.size || selected.has(account.id)))
		.map(account => ({ ...account, feeSource: account.feeSource ?? 'explicit' as const }));
	const providerAccounts = Object.fromEntries(['claude', 'codex'].map(provider => [provider, accounts.filter(account => account.provider === provider).map(account => account.id)]));
	const fees = accountFeesByProvider({ ...config, accounts, providerAccounts, providers: {
		claude: { enabled: (!scoped && config.providers.claude.enabled) || providerAccounts.claude.length > 0 },
		codex: { enabled: (!scoped && config.providers.codex.enabled) || providerAccounts.codex.length > 0 }
	} });
	for (const provider of ['claude', 'codex'] as const) {
		if (status.unreachable || config.accounts.some(account => account.provider === provider && account.pendingLegacyIds?.length && (!scoped || accounts.some(row => row.provider === provider)))) {
			fees[provider].enabled = true;
			fees[provider].monthlyUsd = null;
		}
	}
	return fees;
}

export function accountConfigProblems(config: { accounts: PrivateAccount[]; providerAccounts: Record<string, string[]>; }): string[] {
	const problems: string[] = [];
	const broken = Object.entries(config.providerAccounts).reduce((count, [provider, ids]) => count +
		ids.filter(id => !config.accounts.some(account => account.id === id && account.provider === provider)).length, 0);
	if (broken) problems.push(`${broken} broken Account link(s); repair providerAccounts in config.`);
	const unresolved = config.accounts.filter(account => account.legacy && !account.identity).length;
	if (unresolved) problems.push(`${unresolved} legacy Account(s) awaiting identity matching.`);
	const pending = config.accounts.filter(account => account.pendingLegacyIds?.length).length;
	if (pending) problems.push(`${pending} Account match(es) unresolved; use Settings to match an existing bill or keep separate.`);
	const unknown = config.accounts.filter(account => account.monthlyUsd === null).length;
	if (unknown) problems.push(`${unknown} Account fee(s) unknown; enter monthly fees in Settings.`);
	return problems;
}
