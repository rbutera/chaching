export const accounts = [
	{ id: 'c1', name: 'Claude 01', provider: 'Claude', plan: 'Max 20×', short: 18, week: 42, reset: '1h 24m', weeklyReset: 'Mon, 09:00', monthlyUsd: 200, machines: ['MacBook', 'Mac mini'], activeMachines: ['MacBook'] },
	{ id: 'c2', name: 'Claude 02', provider: 'Claude', plan: 'Max 20×', short: 86, week: 71, reset: '3h 12m', weeklyReset: 'Wed, 14:00', monthlyUsd: 200, machines: ['MacBook', 'Mac mini'], activeMachines: ['Mac mini'] },
	{ id: 'o1', name: 'Codex 01', provider: 'Codex', plan: 'Pro', short: 64, week: 38, reset: '2h 08m', weeklyReset: 'Tue, 11:00', monthlyUsd: 200, machines: ['MacBook'], activeMachines: ['MacBook'] }
] satisfies Array<{ id: string; name: string; provider: 'Claude' | 'Codex'; plan: string; short: number; week: number; reset: string; weeklyReset: string; monthlyUsd: number; machines: string[]; activeMachines: string[] }>;

const sessionNames = ['Untangle the auth flow', 'Account reconciliation', 'Make the diff readable', 'Trace the sync worker', 'The one-line fix'];
const models = {
	Claude: ['Fable 5.1', 'Fable 5', 'Fable 4.8', 'Sonnet 4.6', 'Sonnet 4.5', 'Haiku 4.5'],
	Codex: ['GPT-6 Astra', 'GPT-6 Sol', 'GPT-6 Terra', 'GPT-5.6', 'GPT-5.5', 'GPT-5.4 Mini']
};
const projects = ['rennet', 'chaching', ...Array.from({ length: 138 }, (_, index) => `project-${String(index + 3).padStart(3, '0')}`)];

export const entries = Array.from({ length: 120 }, (_, day) =>
	accounts.flatMap((account, accountIndex) => account.machines.map((machine, machineIndex) => {
		const cost = (1800 + ((day * day * 137 + day * 173 + accountIndex * 947 + machineIndex * 563) % 9500)) / 100;
		return {
			accountId: account.id,
			machine,
			day,
			cost,
			name: sessionNames[(day + accountIndex + machineIndex) % sessionNames.length],
			project: projects[(day * 5 + accountIndex * 2 + machineIndex) % projects.length],
			model: models[account.provider][(day + accountIndex + machineIndex) % models[account.provider].length],
			tokens: `${(cost / 50).toFixed(2)}M`,
			time: `${day === 0 ? 'Today' : day === 1 ? 'Yesterday' : `${day} days ago`} · ${machineIndex ? '10:41' : '14:32'}`
		};
	}))
).flat();

export function spendChange(current: number, previous: number | null) {
	if (previous === null) return 'No earlier data';
	if (previous === 0) return current === 0 ? '0%' : 'No prior spend';
	const change = (current - previous) / previous * 100;
	return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

export function selectUsage(provider: string, machine: string, accountId: string, endDay = 0, windowDays = 30) {
	const selectedAccounts = accounts.filter(account =>
		(provider === 'all' || account.provider === provider) &&
		(machine === 'all' || account.machines.includes(machine)) &&
		(accountId === 'all' || account.id === accountId)
	);
	const accountIds = new Set(selectedAccounts.map(account => account.id));
	const selectedEntries = entries.filter(entry => accountIds.has(entry.accountId) && (machine === 'all' || entry.machine === machine));
	const sum = (days: number) => selectedEntries.reduce((total, entry) => total + (entry.day < days ? Math.round(entry.cost * 100) : 0), 0) / 100;
	const previous = (start: number, days: number) => start + days > 120 ? null : selectedEntries.reduce((total, entry) => total + (entry.day >= start && entry.day < start + days ? Math.round(entry.cost * 100) : 0), 0) / 100;
	const windowEntries = selectedEntries.filter(entry => entry.day >= endDay && entry.day < endDay + windowDays);
	const dailyCosts = Array.from({ length: windowDays }, (_, index) => windowEntries.reduce((total, entry) => total + (entry.day === endDay + windowDays - 1 - index ? Math.round(entry.cost * 100) : 0), 0) / 100);
	return {
		accounts: selectedAccounts,
		entries: selectedEntries,
		windowEntries,
		dailyCosts,
		periodCost: windowEntries.reduce((total, entry) => total + Math.round(entry.cost * 100), 0) / 100,
		endDay,
		windowDays,
		previousTotals: { today: previous(1, 1), week: previous(7, 7), month: previous(30, 30) },
		previousPeriodCost: previous(endDay + windowDays, windowDays),
		totals: { all: sum(Infinity), today: sum(1), week: sum(7), month: sum(30) },
		days30: Array.from({ length: 30 }, (_, index) => selectedEntries.reduce((total, entry) => total + (entry.day === 29 - index ? Math.round(entry.cost * 100) : 0), 0) / 100)
	};
}
