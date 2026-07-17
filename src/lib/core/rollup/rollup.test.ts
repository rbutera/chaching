import { describe, expect, it } from 'vitest';
import { Rollup, type FrozenAgg } from './rollup';
import type { UsageRecord } from '../../types';

const DAY = '2026-07-16';

function cursorAgg(): FrozenAgg {
	return {
		day: DAY,
		provider: 'cursor',
		model: 'claude-opus-4-8',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 0.5,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0
	};
}

function cursorLiveRecord(): UsageRecord {
	return {
		key: 'cursor:cloud-event-1',
		provider: 'cursor',
		timestamp: Date.parse(`${DAY}T10:00:00Z`),
		day: DAY,
		model: 'claude-opus-4-8',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 },
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: 'cursor-session',
		project: 'shared@example.com',
		isSidechain: false,
		cost: 0.5,
		machineId: undefined,
		subscriptionId: null
	};
}

describe('Rollup imported-cursor-day guard (B3)', () => {
	it('counts a cursor (day, model) once when an import already covers it', () => {
		const rollup = new Rollup();
		// import seeded before live records, exactly as loadSync/reloadSyncRollup do
		rollup.loadAggregates([cursorAgg()], []);
		rollup.setImportedCursorDays([{ provider: 'cursor', day: DAY }]);
		// a live pool-global cursor record (machineId undefined) for the same day arrives
		rollup.add(cursorLiveRecord());
		// Without the guard in add(), this would be 1.0 (imported 0.5 + live 0.5).
		expect(rollup.snapshot().totals.cost).toBeCloseTo(0.5);
		expect(rollup.snapshot().totals.requests).toBe(1);
	});

	it('still counts cursor days that were NOT imported', () => {
		const rollup = new Rollup();
		rollup.setImportedCursorDays([{ provider: 'cursor', day: '2026-07-01' }]);
		rollup.add(cursorLiveRecord()); // different day -> not suppressed
		expect(rollup.snapshot().totals.cost).toBeCloseTo(0.5);
	});
});
