import { expect, test } from 'vitest';
import { entries, selectUsage, spendChange } from './prototype-data';

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

test('day and month navigation changes the window without moving headline totals', () => {
	const current = selectUsage('all', 'all', 'all');
	expect(new Set(current.windowEntries.map(entry => entry.project)).size).toBeGreaterThan(100);
	expect(new Set(current.windowEntries.map(entry => entry.model)).size).toBeGreaterThanOrEqual(10);
	for (const windowDays of [1, 30]) {
		for (const endDay of [0, 1, 30, 90, 119, 120]) {
			const result = selectUsage('all', 'all', 'all', endDay, windowDays);
			expect(result.totals).toEqual(current.totals);
			expect(result.entries).toEqual(current.entries);
			expect(result.endDay).toBe(endDay);
			expect(result.windowDays).toBe(windowDays);
			expect(result.windowEntries).toEqual(entries.filter(entry => entry.day >= endDay && entry.day < endDay + windowDays));
			expect(result.dailyCosts).toHaveLength(windowDays);
			expect(result.dailyCosts.reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(result.periodCost);
			expect(result.dailyCosts[0]).toBeCloseTo(result.windowEntries.filter(entry => entry.day === endDay + windowDays - 1).reduce((sum, entry) => sum + entry.cost, 0));
			expect(result.dailyCosts[windowDays - 1]).toBeCloseTo(result.windowEntries.filter(entry => entry.day === endDay).reduce((sum, entry) => sum + entry.cost, 0));
		}
	}
	const filtered = selectUsage('Claude', 'Mac mini', 'c2', 30, 30);
	expect(filtered.windowEntries).toHaveLength(30);
	expect(filtered.windowEntries.every(entry => entry.accountId === 'c2' && entry.machine === 'Mac mini')).toBe(true);
});


test('spend changes compare disjoint filtered periods and handle unavailable baselines', () => {
	const result = selectUsage('Claude', 'Mac mini', 'c2', 30, 30);
	const sum = (start: number, days: number) => result.entries.filter(e => e.day >= start && e.day < start + days).reduce((total, e) => total + e.cost, 0);
	expect(result.previousTotals.today).toBeCloseTo(sum(1, 1));
	expect(result.previousTotals.week).toBeCloseTo(sum(7, 7));
	expect(result.previousTotals.month).toBeCloseTo(sum(30, 30));
	expect(result.previousPeriodCost).toBeCloseTo(sum(60, 30));
	expect(selectUsage('all', 'all', 'all', 90, 30).previousPeriodCost).toBeNull();
	expect(spendChange(150, 100)).toBe('+50.0%');
	expect(spendChange(50, 100)).toBe('-50.0%');
	expect(spendChange(0, 0)).toBe('0%');
	expect(spendChange(10, 0)).toBe('No prior spend');
	expect(spendChange(10, null)).toBe('No earlier data');
});
