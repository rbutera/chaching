import { describe, expect, it } from 'vitest';
import { buildSubscriptionIndex, mergePooledSnapshot } from './overlay';
import type { SyncMapping } from './types';
import type { DayModelAgg, RollupSnapshot } from '../../types';

function emptySnap(over: Partial<RollupSnapshot> = {}): RollupSnapshot {
	return {
		generatedAt: 0,
		earliestDay: null,
		latestDay: null,
		totals: {
			tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
			requests: 0,
			cost: 0,
			costUnknownRequests: 0
		},
		dayModel: [],
		sessions: [],
		blocks: [],
		models: [],
		providers: [],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: {},
		...over
	};
}

function dm(day: string, over: Partial<DayModelAgg> = {}): DayModelAgg {
	return {
		day,
		provider: 'codex',
		model: 'gpt-5.6-sol',
		tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 1,
		costUnknownRequests: 0,
		...over
	};
}

// C11: an explicit OWN null cursor mapping must not suppress a peer's real attribution.
describe('buildSubscriptionIndex cursor attribution (C11)', () => {
	it('an explicit own null cursor mapping does not suppress a peer mapping', () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'own', provider: 'cursor', subscriptionId: null },
			{ machineId: 'peer', provider: 'cursor', subscriptionId: 'sub-peer' }
		];
		expect(buildSubscriptionIndex(mappings, 'own').cursor).toBe('sub-peer');
	});

	it("this machine's own non-null cursor mapping wins over a peer's", () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'own', provider: 'cursor', subscriptionId: 'sub-own' },
			{ machineId: 'peer', provider: 'cursor', subscriptionId: 'sub-peer' }
		];
		expect(buildSubscriptionIndex(mappings, 'own').cursor).toBe('sub-own');
	});

	it('falls back to a peer mapping when this machine has none of its own', () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'peer', provider: 'cursor', subscriptionId: 'sub-peer' }
		];
		expect(buildSubscriptionIndex(mappings, 'own').cursor).toBe('sub-peer');
	});

	it('resolves to null when there is no cursor mapping anywhere', () => {
		expect(buildSubscriptionIndex([], 'own').cursor).toBeNull();
	});
});

// C8: a peer day flagged partial must render `partial`, never `frozen`.
describe('mergePooledSnapshot partial-peer coverage (C8)', () => {
	it('a peer day flagged partial renders as partial coverage', () => {
		const merged = mergePooledSnapshot(
			emptySnap(),
			emptySnap({ dayModel: [dm('2026-07-15')] }),
			'2026-07-17',
			new Set(['2026-07-15'])
		);
		expect(merged.coverage['2026-07-15']).toBe('partial');
	});

	it('a peer day not flagged partial renders as frozen', () => {
		const merged = mergePooledSnapshot(
			emptySnap(),
			emptySnap({ dayModel: [dm('2026-07-15')] }),
			'2026-07-17',
			new Set()
		);
		expect(merged.coverage['2026-07-15']).toBe('frozen');
	});

	it('a partial peer day downgrades a local frozen opinion (pooled day is still incomplete)', () => {
		const merged = mergePooledSnapshot(
			emptySnap({ coverage: { '2026-07-15': 'frozen' } }),
			emptySnap({ dayModel: [dm('2026-07-15')] }),
			'2026-07-17',
			new Set(['2026-07-15'])
		);
		expect(merged.coverage['2026-07-15']).toBe('partial');
	});
});
