import { expect, test } from 'vitest';
import { entries, selectUsage } from './prototype-data';

test('filter intersections preserve usage totals and count shared Accounts once', () => {
	for (const provider of ['all', 'Claude', 'Codex']) {
		for (const machine of ['all', 'MacBook', 'Mac mini']) {
			for (const accountId of ['all', 'c1', 'c2', 'o1']) {
				const result = selectUsage(provider, machine, accountId);
				expect(result.entries.every(entry =>
					(machine === 'all' || entry.machine === machine) &&
					(accountId === 'all' || entry.accountId === accountId) &&
					(provider === 'all' || (entry.accountId === 'o1' ? 'Codex' : 'Claude') === provider)
				)).toBe(true);
				for (const [key, days] of [['all', Infinity], ['today', 1], ['week', 7], ['month', 30]] satisfies Array<[keyof typeof result.totals, number]>) {
					expect(result.totals[key]).toBeCloseTo(result.entries.filter(entry => entry.day < days).reduce((total, entry) => total + entry.cost, 0));
				}
				expect(result.days30.reduce((total, day) => total + day, 0)).toBeCloseTo(result.totals.month);
				expect(result.days30[29]).toBe(result.totals.today);
			}
		}
	}
	expect(selectUsage('all', 'all', 'all').entries).toHaveLength(entries.length);
	const shared = selectUsage('Claude', 'all', 'c1');
	expect(new Set(shared.entries.map(entry => entry.machine)).size).toBe(2);
	expect(shared.accounts.reduce((fee, account) => fee + account.monthlyUsd, 0)).toBe(200);
	expect(selectUsage('Codex', 'Mac mini', 'all').entries).toEqual([]);
	expect(selectUsage('Codex', 'Mac mini', 'all').accounts).toEqual([]);
	expect(selectUsage('Claude', 'all', 'o1').totals.all).toBe(0);
	expect(selectUsage('all', 'all', 'missing').totals.all).toBe(0);
});
