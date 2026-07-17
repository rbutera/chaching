import { describe, expect, it } from 'vitest';
import { Rollup, type HourAgg } from './rollup';
import type { UsageRecord } from '../../types';

const DAY = '2026-07-16';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
	return {
		key: `k-${Math.random()}`,
		provider: 'codex',
		timestamp: Date.parse(`${DAY}T10:30:00Z`),
		day: DAY,
		model: 'gpt-5.6-sol',
		tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 },
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: 'session',
		project: 'project',
		isSidechain: false,
		cost: 0.5,
		machineId: 'machine-a',
		subscriptionId: null,
		...overrides
	};
}

describe('Rollup publish surface', () => {
	it('exports dirty day/hour/session aggregates and clears them idempotently', () => {
		const rollup = new Rollup();
		rollup.add(record());

		const days = rollup.dirtyDayAggregates();
		expect(days).toHaveLength(1);
		expect(days[0]).toMatchObject({ day: DAY, provider: 'codex', model: 'gpt-5.6-sol', requests: 1, cost: 0.5 });
		expect(rollup.dirtyHourAggregates(0)).toHaveLength(1);
		expect(rollup.dirtySessionSummaries()).toHaveLength(1);
		expect(rollup.hasPublishDirty()).toBe(true);

		rollup.clearPublishDirty();
		expect(rollup.hasPublishDirty()).toBe(false);
		expect(rollup.dirtyDayAggregates()).toHaveLength(0);
		expect(rollup.dirtyHourAggregates(0)).toHaveLength(0);

		// A later record for the same key reappears as dirty (full-replacement row) with the
		// accumulated total, and `all*` always reflects the whole rollup regardless of dirtiness.
		rollup.add(record());
		expect(rollup.dirtyDayAggregates()[0]?.requests).toBe(2);
		expect(rollup.allDayAggregates()[0]?.requests).toBe(2);
		expect(rollup.allSessionSummaries()).toHaveLength(1);
	});

	it('buckets hours and honours the retention window floor', () => {
		const rollup = new Rollup();
		const early = Date.parse('2026-07-16T10:15:00Z');
		const late = Date.parse('2026-07-16T13:45:00Z');
		rollup.add(record({ timestamp: early }));
		rollup.add(record({ timestamp: late }));

		const all = rollup.allHourAggregates(0).sort((a, b) => a.hourTs - b.hourTs);
		expect(all.map((h) => h.hourTs)).toEqual([
			Math.floor(early / 3_600_000) * 3_600_000,
			Math.floor(late / 3_600_000) * 3_600_000
		]);
		// A floor between the two buckets drops the earlier one.
		expect(rollup.allHourAggregates(Date.parse('2026-07-16T12:00:00Z'))).toHaveLength(1);
	});

	it('folds peer hour aggregates into the block accumulator', () => {
		const rollup = new Rollup();
		const hourTs = Date.parse('2026-07-16T10:00:00Z');
		const hour: HourAgg = {
			hourTs,
			provider: 'cursor',
			model: 'claude-opus-4-8',
			tokens: { input: 200, output: 40, cacheCreation: 0, cacheRead: 0 },
			requests: 3,
			cost: 1.25,
			costUnknownRequests: 0
		};
		rollup.loadHourAggregates([hour]);
		const blocks = rollup.computeBlocks(Date.parse('2026-07-16T11:00:00Z'));
		expect(blocks).toHaveLength(1);
		expect(blocks[0].requests).toBe(3);
		expect(blocks[0].cost).toBeCloseTo(1.25);
		expect(blocks[0].tokens.input).toBe(200);
		expect(blocks[0].isActive).toBe(true);
	});
});
