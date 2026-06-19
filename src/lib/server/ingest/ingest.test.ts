import { describe, it, expect } from 'vitest';
import { parseLine } from './parse';
import { DedupSet, makeKey } from './dedup';
import { computeCost, resolvePrice } from '$lib/server/pricing/cost';
import { Rollup } from '$lib/server/rollup/rollup';
import { aggregateByPeriod, aggregateByProvider, periodKey, sumGrain } from '$lib/aggregate';
import type { DayModelAgg } from '$lib/types';

const ctx = { project: '/test', fileIsSidechain: false };

function assistantLine(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: '2026-06-01T12:00:00.000Z',
		requestId: 'req_A',
		sessionId: 's1',
		isSidechain: false,
		message: {
			id: 'msg_A',
			model: 'claude-opus-4-8',
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 200,
				cache_read_input_tokens: 1000,
				cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 },
				service_tier: 'standard'
			}
		},
		...over
	});
}

describe('parseLine', () => {
	it('parses a valid assistant usage line', () => {
		const rec = parseLine(assistantLine(), ctx);
		expect(rec).not.toBeNull();
		expect(rec!.provider).toBe('claude');
		expect(rec!.model).toBe('claude-opus-4-8');
		expect(rec!.tokens).toEqual({ input: 100, output: 50, cacheCreation: 200, cacheRead: 1000 });
		expect(rec!.day).toBe('2026-06-01');
		expect(rec!.key).toBe('msg_A:req_A');
	});

	it('skips <synthetic> model', () => {
		const line = assistantLine({ message: { id: 'm', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } });
		expect(parseLine(line, ctx)).toBeNull();
	});

	it('skips non-assistant lines', () => {
		expect(parseLine(JSON.stringify({ type: 'user', message: {} }), ctx)).toBeNull();
		expect(parseLine(JSON.stringify({ type: 'system' }), ctx)).toBeNull();
	});

	it('skips partial / corrupt lines without throwing', () => {
		expect(parseLine('{"type":"assistant","message":{"id":"x"', ctx)).toBeNull();
		expect(parseLine('not json at all', ctx)).toBeNull();
		expect(parseLine('', ctx)).toBeNull();
	});

	it('skips zero-usage assistant lines', () => {
		const line = assistantLine({
			message: { id: 'm', model: 'claude-opus-4-8', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
		});
		expect(parseLine(line, ctx)).toBeNull();
	});
});

describe('dedup', () => {
	it('counts a streamed-repeated message exactly once', () => {
		const set = new DedupSet();
		const a = parseLine(assistantLine(), ctx)!;
		const b = parseLine(assistantLine(), ctx)!; // same msg_A:req_A
		expect(set.add(a.key)).toBe(true);
		expect(set.add(b.key)).toBe(false); // dup
	});

	it('counts null-id lines as-is (never dedups them)', () => {
		const set = new DedupSet();
		const k1 = makeKey(null, 'req_X');
		const k2 = makeKey(null, 'req_X');
		expect(k1).not.toBe(k2); // unique synthetic keys
		expect(set.add(k1)).toBe(true);
		expect(set.add(k2)).toBe(true);
	});
});

describe('cost', () => {
	it('has a price for every model on this machine', () => {
		for (const m of ['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
			expect(resolvePrice(m)).not.toBeNull();
		}
	});

	it('computes cost = Σ tokens × per-token price (opus, 1h cache split)', () => {
		// opus: in 5e-6, out 2.5e-5, cache-create-5m 6.25e-6, cache-create-1h 1e-5, read 5e-7
		const cost = computeCost('claude-opus-4-8', { input: 100, output: 50, cacheCreation: 200, cacheRead: 1000 }, 200, 0);
		// 100*5e-6 + 50*2.5e-5 + 200*1e-5 (all 1h) + 1000*5e-7
		const expected = 100 * 5e-6 + 50 * 2.5e-5 + 200 * 1e-5 + 1000 * 5e-7;
		expect(cost).toBeCloseTo(expected, 12);
	});

	it('falls back to base cache rate when no 1h/5m split is given', () => {
		const cost = computeCost('claude-opus-4-8', { input: 0, output: 0, cacheCreation: 1000, cacheRead: 0 }, 0, 0);
		expect(cost).toBeCloseTo(1000 * 6.25e-6, 12);
	});

	it('returns null for a totally unknown non-claude model', () => {
		expect(computeCost('gpt-imaginary-9', { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 })).toBeNull();
	});
});

describe('rollup', () => {
	it('aggregates per-day-per-model and totals after dedup', () => {
		const rollup = new Rollup();
		const dedup = new DedupSet();
		for (const line of [assistantLine(), assistantLine() /* dup */]) {
			const rec = parseLine(line, ctx)!;
			if (dedup.add(rec.key)) rollup.add(rec);
			else rollup.addDuplicate();
		}
		const snap = rollup.snapshot();
		expect(snap.totals.requests).toBe(1); // dedup left one
		expect(snap.dayModel).toHaveLength(1);
		expect(snap.dayModel[0].day).toBe('2026-06-01');
		expect(snap.dayModel[0].model).toBe('claude-opus-4-8');
		expect(snap.stats.duplicatesSkipped).toBe(1);
		expect(snap.sessions).toHaveLength(1);
		expect(snap.totals.cost).toBeGreaterThan(0);
	});

	it('keeps providers separate when day and model match', () => {
		const rollup = new Rollup();
		const claude = parseLine(assistantLine(), ctx)!;
		const codex = {
			...claude,
			key: 'codex-msg:req_B',
			provider: 'codex',
			sessionId: 'codex-session'
		};

		rollup.add(claude);
		rollup.add(codex);

		const snap = rollup.snapshot();
		expect(snap.dayModel).toHaveLength(2);
		expect(snap.dayModel.map((d) => `${d.day}:${d.provider}:${d.model}`).sort()).toEqual([
			'2026-06-01:claude:claude-opus-4-8',
			'2026-06-01:codex:claude-opus-4-8'
		]);
		expect(snap.providers).toEqual(['claude', 'codex']);
	});

	it('keeps provider sessions separate when native session ids collide', () => {
		const rollup = new Rollup();
		const claude = parseLine(assistantLine({ sessionId: 'shared-session' }), ctx)!;
		const codex = {
			...claude,
			key: 'codex-msg:req_B',
			provider: 'codex',
			sessionId: 'shared-session'
		};

		rollup.add(claude);
		rollup.add(codex);

		const snap = rollup.snapshot();
		expect(snap.sessions).toHaveLength(2);
		expect(snap.sessions.map((s) => `${s.provider}:${s.sessionId}:${s.requests}`).sort()).toEqual([
			'claude:shared-session:1',
			'codex:shared-session:1'
		]);
	});
});

describe('period aggregation', () => {
	const dm: DayModelAgg[] = [
		{ day: '2026-06-01', provider: 'claude', model: 'claude-opus-4-8', tokens: { input: 10, output: 10, cacheCreation: 0, cacheRead: 0 }, requests: 1, cost: 1, costUnknownRequests: 0 },
		{ day: '2026-06-02', provider: 'claude', model: 'claude-opus-4-8', tokens: { input: 10, output: 10, cacheCreation: 0, cacheRead: 0 }, requests: 1, cost: 1, costUnknownRequests: 0 },
		{ day: '2026-06-02', provider: 'claude', model: 'claude-sonnet-4-6', tokens: { input: 5, output: 5, cacheCreation: 0, cacheRead: 0 }, requests: 1, cost: 0.5, costUnknownRequests: 0 }
	];

	it('day periods are per-day', () => {
		const buckets = aggregateByPeriod(dm, 'day');
		expect(buckets).toHaveLength(2);
		expect(buckets[1].cost).toBeCloseTo(1.5);
	});

	it('week periods collapse into ISO weeks', () => {
		expect(periodKey('2026-06-01', 'week')).toBe(periodKey('2026-06-02', 'week'));
		const buckets = aggregateByPeriod(dm, 'week');
		expect(buckets).toHaveLength(1);
		expect(buckets[0].cost).toBeCloseTo(2.5);
	});

	it('month periods collapse into YYYY-MM', () => {
		expect(periodKey('2026-06-02', 'month')).toBe('2026-06');
		const buckets = aggregateByPeriod(dm, 'month');
		expect(buckets).toHaveLength(1);
		expect(buckets[0].cost).toBeCloseTo(2.5);
	});

	it('provider filters scope totals without changing model filtering semantics', () => {
		const mixed: DayModelAgg[] = [
			...dm,
			{ day: '2026-06-02', provider: 'codex', model: 'claude-opus-4-8', tokens: { input: 100, output: 0, cacheCreation: 0, cacheRead: 0 }, requests: 1, cost: 10, costUnknownRequests: 0 }
		];

		expect(aggregateByProvider(mixed).map((p) => `${p.provider}:${p.cost}`)).toEqual(['codex:10', 'claude:2.5']);
		expect(sumGrain(mixed, { providers: new Set(['claude']) }).cost).toBeCloseTo(2.5);
		expect(sumGrain(mixed, { models: new Set(['claude-opus-4-8']) }).cost).toBeCloseTo(12);
		expect(sumGrain(mixed, { models: new Set(['claude-opus-4-8']), providers: new Set(['claude']) }).cost).toBeCloseTo(2);
	});
});
