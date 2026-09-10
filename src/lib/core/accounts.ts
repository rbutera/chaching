import { sumFees, type SubsidisedProvider, type ProviderSubsidisationConfig } from './subsidisation';

export interface Account {
	id: string;
	provider: string;
	name: string;
	tier: string;
	monthlyUsd: number | null;
	feeSource: 'explicit' | 'inferred';
}

export interface PrivateAccount extends Account {
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
			enabled: config.providers[provider].enabled,
			tier: accounts.length === 1 ? accounts[0].tier : accounts.length ? `${accounts.length} accounts` : 'unknown',
			monthlyUsd: accounts.length && accounts.length === ids.size ? sumFees(accounts.map(account => account.monthlyUsd)) : null
		};
	}
	return { claude: forProvider('claude'), codex: forProvider('codex') };
}

export function accountConfigProblems(config: { accounts: PrivateAccount[]; providerAccounts: Record<string, string[]> }): string[] {
	const problems: string[] = [];
	const broken = Object.entries(config.providerAccounts).reduce((count, [provider, ids]) => count +
		ids.filter(id => !config.accounts.some(account => account.id === id && account.provider === provider)).length, 0);
	if (broken) problems.push(`${broken} broken Account link(s); repair providerAccounts in config.`);
	const unresolved = config.accounts.filter(account => account.legacy && !account.identity).length;
	if (unresolved) problems.push(`${unresolved} legacy Account(s) awaiting identity matching.`);
	const unknown = config.accounts.filter(account => account.monthlyUsd === null).length;
	if (unknown) problems.push(`${unknown} Account fee(s) unknown; enter monthly fees in Settings.`);
	return problems;
}
