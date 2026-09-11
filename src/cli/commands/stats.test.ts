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
