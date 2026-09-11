import { afterEach, describe, expect, it, vi } from 'vitest';
import { statsSnapshot } from './stats';
import { Rollup } from '../../lib/core/rollup/rollup';
import { sumGrain } from '../../lib/core/aggregate';

afterEach(() => vi.useRealTimers());

describe('stats JSON scope', () => {
	it('keeps totals, sessions and dimensions in the selected provider and day', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
		const dayModel = [
			{ day: '2026-09-11', provider: 'claude', model: 'selected', cost: 3 },
			{ day: '2026-09-10', provider: 'claude', model: 'old', cost: 7 },
			{ day: '2026-09-11', provider: 'codex', model: 'other', cost: 11 }
		].map(row => ({ ...row, tokens: { input: row.cost, output: 0, cacheRead: 0, cacheCreation: 0 }, requests: 1, costUnknownRequests: 0 }));
		const snapshot = {
			...new Rollup().snapshot(Date.now()), dayModel, totals: sumGrain(dayModel),
			sessions: dayModel.map(row => ({ ...row, sessionId: row.model, project: row.model, firstTs: Date.parse(row.day), lastTs: Date.parse(row.day), models: [row.model] }))
		};
		const scoped = statsSnapshot(snapshot, { period: 'day', providers: ['claude'] });
		expect(scoped.totals.cost).toBe(3);
		expect(scoped.totals.tokens.input).toBe(3);
		expect(scoped.sessions.map(row => row.sessionId)).toEqual(['selected']);
		expect(scoped.models).toEqual(['selected']);
		expect(scoped.providers).toEqual(['claude']);
		expect(scoped.earliestDay).toBe('2026-09-11');
		expect(statsSnapshot(snapshot, { providers: ['missing'] })).toMatchObject({ totals: { cost: 0 }, sessions: [], models: [], providers: [], earliestDay: null, latestDay: null });
		expect(statsSnapshot(snapshot, {})).toBe(snapshot);
	});
});


it('intersects explicit dates, model, provider, machine and Account scopes without borrowing coverage', () => {
	const dayModel = [
		{ day: '2026-09-10', provider: 'claude', model: 'chosen', machineId: 'one', accountId: 'a', cost: 3 },
		{ day: '2026-09-10', provider: 'claude', model: 'other', machineId: 'one', accountId: 'a', cost: 5 },
		{ day: '2026-09-10', provider: 'claude', model: 'chosen', machineId: 'two', accountId: 'a', cost: 7 },
		{ day: '2026-09-10', provider: 'claude', model: 'chosen', machineId: 'one', accountId: 'b', cost: 11 },
		{ day: '2026-09-09', provider: 'claude', model: 'chosen', machineId: 'one', accountId: 'a', cost: 13 }
	].map(row => ({ ...row, tokens: { input: row.cost, output: 0, cacheRead: 0, cacheCreation: 0 }, requests: 1, costUnknownRequests: 0 }));
	const snapshot = { ...new Rollup().snapshot(Date.now()), dayModel, earliestDay: '2026-09-09', latestDay: '2026-09-10', totals: sumGrain(dayModel),
		coverage: { '2026-09-10': 'frozen' as const }, sessions: dayModel.map((row, index) => ({ ...row, sessionId: String(index), project: 'project', firstTs: Date.parse(row.day), lastTs: Date.parse(row.day), models: [row.model] })) };
	const filtered = statsSnapshot(snapshot, { range: { from: '2026-09-10', to: '2026-09-10' }, models: ['chosen'], providers: ['claude'], machines: ['one'], accountIds: ['a'] });
	expect(filtered.totals.cost).toBe(3);
	expect(filtered.sessions.map(row => row.sessionId)).toEqual(['0']);
	expect(filtered.coverage['2026-09-10']).toBe('partial');
	expect(statsSnapshot(snapshot, { period: 'day' }, Date.parse('2026-09-11T12:00:00Z')).totals.cost).toBe(0);
	expect(statsSnapshot(snapshot, { period: 'week' }, Date.parse('2026-09-16T12:00:00Z')).totals.cost).toBe(26);
});
