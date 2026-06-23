import { describe, expect, it } from 'vitest';
import { Rollup, type CoverageInput, type FrozenAgg } from './rollup';
import type { TokenCounts, UsageRecord } from '../../types';

function toks(input = 0, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}

/** A live usage record (un-frozen) for `day`, with real activity (1 request). */
function rec(day: string, cost = 1, model = 'claude-opus-4-8'): UsageRecord {
	return {
		key: `${day}:${Math.random()}`,
		provider: 'claude',
		timestamp: Date.parse(`${day}T12:00:00Z`),
		day,
		model,
		tokens: toks(cost * 1000),
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0,
		sessionId: `s-${day}`,
		project: 'proj',
		isSidechain: false,
		cost
	};
}

/** A frozen pre-aggregated row (seeded via loadAggregates) for `day`. */
function frozenAgg(day: string, cost: number, requests: number, model = 'claude-opus-4-8'): FrozenAgg {
	return {
		day,
		provider: 'claude',
		model,
		tokens: toks(cost * 1000),
		requests,
		cost,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0
	};
}

const TODAY = '2026-06-23';
function input(over: Partial<CoverageInput> = {}): CoverageInput {
	return { today: TODAY, scanPartial: false, historyEnabled: true, ...over };
}

describe('Rollup coverage classification', () => {
	it('classifies a frozen past day with spend as frozen', () => {
		const r = new Rollup();
		r.setFrozenDays(['2026-06-20']);
		r.loadAggregates([frozenAgg('2026-06-20', 5, 3)], []);
		const snap = r.snapshot(0, input());
		expect(snap.coverage['2026-06-20']).toBe('frozen');
	});

	it('classifies a frozen past day with genuine $0 (in frozen set, no rows) as zero', () => {
		const r = new Rollup();
		// frozen day marked but NO aggregate rows -> genuine zero.
		r.setFrozenDays(['2026-06-19']);
		const snap = r.snapshot(0, input());
		expect(snap.coverage['2026-06-19']).toBe('zero');
	});

	it('classifies a frozen past day whose only rows are zero-activity as zero', () => {
		const r = new Rollup();
		r.setFrozenDays(['2026-06-19']);
		// requests=0 -> no real activity -> genuine $0 day, not "has spend".
		r.loadAggregates([frozenAgg('2026-06-19', 0, 0)], []);
		const snap = r.snapshot(0, input());
		expect(snap.coverage['2026-06-19']).toBe('zero');
	});

	it('classifies today (scanned this run) as partial', () => {
		const r = new Rollup();
		r.add(rec(TODAY, 2));
		const snap = r.snapshot(0, input());
		expect(snap.coverage[TODAY]).toBe('partial');
	});

	it('does NOT emit missing as a snapshot key', () => {
		const r = new Rollup();
		r.setFrozenDays(['2026-06-20']);
		r.loadAggregates([frozenAgg('2026-06-20', 5, 3)], []);
		r.add(rec(TODAY, 2));
		const snap = r.snapshot(0, input());
		// only the days the layer has an opinion about; no manufactured gaps.
		expect(Object.values(snap.coverage)).not.toContain('missing');
		expect(Object.keys(snap.coverage).sort()).toEqual(['2026-06-20', TODAY]);
	});

	it('marks an errored-scan past day partial, then frozen on a clean re-run', () => {
		// scanPartial=true: a past scanned day that could not freeze reads partial.
		const r1 = new Rollup();
		r1.add(rec('2026-06-21', 4));
		const partial = r1.snapshot(0, input({ scanPartial: true }));
		expect(partial.coverage['2026-06-21']).toBe('partial');

		// clean re-run: the day is now frozen (history finalized it) -> frozen.
		const r2 = new Rollup();
		r2.setFrozenDays(['2026-06-21']);
		r2.loadAggregates([frozenAgg('2026-06-21', 4, 2)], []);
		const clean = r2.snapshot(0, input({ scanPartial: false }));
		expect(clean.coverage['2026-06-21']).toBe('frozen');
	});

	it('a clean past scanned day with history enabled is NOT manufactured (left for missing)', () => {
		// history on, clean scan, but the day is somehow still un-frozen: the layer has no
		// authoritative opinion, so it is NOT a coverage key (view-model treats it missing).
		const r = new Rollup();
		r.add(rec('2026-06-21', 4));
		const snap = r.snapshot(0, input({ scanPartial: false, historyEnabled: true }));
		expect(snap.coverage['2026-06-21']).toBeUndefined();
	});

	it('history-disabled does not manufacture gaps: scanned past day with spend reads partial', () => {
		// With history off nothing freezes; a scanned past day with spend must be an opinion
		// (partial, authoritative-equivalent) so it never reads `missing` downstream.
		const r = new Rollup();
		r.add(rec('2026-06-21', 4));
		const snap = r.snapshot(0, input({ historyEnabled: false }));
		expect(snap.coverage['2026-06-21']).toBe('partial');
	});

	it('today always wins over any frozen entry for the same key (never frozen today)', () => {
		const r = new Rollup();
		// pathological: today erroneously in the frozen set; today must still read partial.
		r.setFrozenDays([TODAY]);
		r.add(rec(TODAY, 2));
		const snap = r.snapshot(0, input());
		expect(snap.coverage[TODAY]).toBe('partial');
	});
});
