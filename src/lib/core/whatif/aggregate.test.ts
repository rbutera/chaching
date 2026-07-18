import { describe, expect, it } from 'vitest';
import type { DayModelAgg } from '../../types';
import { aggregateSlices, buildWhatifInput } from './aggregate';

function agg(day: string, provider: string, model: string, input: number, cost: number): DayModelAgg {
	return {
		day,
		provider,
		model,
		tokens: { input, output: 0, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

describe('aggregateSlices (task 1.1)', () => {
	it('sums token classes + cost per (provider, model) across days', () => {
		const grain = [
			agg('2026-07-01', 'claude', 'opus', 100, 1),
			agg('2026-07-02', 'claude', 'opus', 200, 2),
			agg('2026-07-02', 'codex', 'gpt', 50, 5)
		];
		const slices = aggregateSlices(grain);
		const opus = slices.find((s) => s.provider === 'claude' && s.model === 'opus');
		expect(opus?.tokens.input).toBe(300);
		expect(opus?.actualCost).toBe(3);
		expect(opus?.requests).toBe(2);
		expect(slices).toHaveLength(2);
	});

	it('honours an inclusive [from, to] window', () => {
		const grain = [
			agg('2026-06-30', 'claude', 'opus', 100, 1),
			agg('2026-07-01', 'claude', 'opus', 200, 2),
			agg('2026-07-31', 'claude', 'opus', 400, 4),
			agg('2026-08-01', 'claude', 'opus', 800, 8)
		];
		const slices = aggregateSlices(grain, { from: '2026-07-01', to: '2026-07-31' });
		expect(slices).toHaveLength(1);
		expect(slices[0].tokens.input).toBe(600); // only the two July rows
		expect(slices[0].actualCost).toBe(6);
	});

	it('buildWhatifInput carries the window through', () => {
		const wi = buildWhatifInput([agg('2026-07-01', 'claude', 'opus', 100, 1)], {
			from: '2026-07-01',
			to: '2026-07-01'
		});
		expect(wi.window).toEqual({ from: '2026-07-01', to: '2026-07-01' });
		expect(wi.slices).toHaveLength(1);
	});
});
