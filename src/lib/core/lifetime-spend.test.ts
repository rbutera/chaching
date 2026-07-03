import { describe, expect, it } from 'vitest';
import { lifetimeSpend } from './aggregate';
import type { DayModelAgg } from '../types';

function agg(day: string, cost: number): DayModelAgg {
	return {
		day,
		provider: 'claude',
		model: 'claude-opus-4-8',
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

describe('lifetimeSpend', () => {
	it('empty history: $0 total, empty series, null projection', () => {
		const l = lifetimeSpend([]);
		expect(l.totalCost).toBe(0);
		expect(l.dailySeries).toEqual([]);
		expect(l.projectedYearlyCost).toBeNull();
		expect(l.runRateSampleDays).toBe(0);
	});

	it('totalCost sums the FULL history, not just the run-rate window', () => {
		const dayModel = [agg('2026-01-01', 500), agg('2026-06-01', 10), agg('2026-06-30', 10)];
		const l = lifetimeSpend(dayModel, '2026-06-30');
		expect(l.totalCost).toBe(520);
	});

	it('projects the trailing run-rate to a year', () => {
		// 10 banked days at $2/day inside the trailing 30-day window.
		const dayModel: DayModelAgg[] = [];
		for (let i = 0; i < 10; i++) {
			const day = `2026-06-${String(21 + i).padStart(2, '0')}`;
			dayModel.push(agg(day, 2));
		}
		const l = lifetimeSpend(dayModel, '2026-06-30', 30);
		expect(l.runRateSampleDays).toBe(10);
		// avg $2/day over the 10 days that have data * 365
		expect(l.projectedYearlyCost).toBeCloseTo((20 / 10) * 365, 6);
	});

	it('suppresses the projection below the minimum sample-size guard (cost-honesty)', () => {
		const dayModel = [agg('2026-06-29', 5), agg('2026-06-30', 5)];
		const l = lifetimeSpend(dayModel, '2026-06-30');
		expect(l.runRateSampleDays).toBe(2);
		expect(l.projectedYearlyCost).toBeNull();
	});

	it('dailySeries is zero-filled and spans exactly sparklineDays ending at `today`', () => {
		const dayModel = [agg('2026-06-30', 7)];
		const l = lifetimeSpend(dayModel, '2026-06-30', 30, 5);
		expect(l.dailySeries.map((d) => d.day)).toEqual([
			'2026-06-26',
			'2026-06-27',
			'2026-06-28',
			'2026-06-29',
			'2026-06-30'
		]);
		expect(l.dailySeries.map((d) => d.cost)).toEqual([0, 0, 0, 0, 7]);
	});

	it('defaults `today` to the latest day present in dayModel when omitted', () => {
		const dayModel = [agg('2026-05-01', 3), agg('2026-06-15', 4)];
		const l = lifetimeSpend(dayModel, undefined, 30, 3);
		expect(l.dailySeries[l.dailySeries.length - 1].day).toBe('2026-06-15');
	});
});
