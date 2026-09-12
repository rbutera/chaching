import { describe, expect, it } from 'vitest';
import { attachAccounts, buildAccountIndex, mergePooledSnapshot } from './overlay';
import type { SyncMapping } from '@chaching/shared/sync-types';
import type { DayModelAgg, RollupSnapshot } from '@chaching/shared/types';

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
describe('buildAccountIndex cursor attribution (C11)', () => {
	it('does not assign machine history to an arbitrary account when several are linked', () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'own', provider: 'codex', accountId: 'one' },
			{ machineId: 'own', provider: 'codex', accountId: 'two' },
			{ machineId: 'own', provider: 'codex', accountId: 'one' }
		];
		const index = buildAccountIndex(mappings, 'own');
		const snapshot = emptySnap({ dayModel: [dm('2026-09-01', { machineId: 'own', cost: 42 })] });
		expect(attachAccounts(snapshot, index).dayModel[0]).toMatchObject({ cost: 42, accountId: null });
		expect(buildAccountIndex(mappings.toReversed(), 'own').byMachineProvider).toEqual(index.byMachineProvider);
	});

	it('an explicit own null cursor mapping does not suppress a peer mapping', () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'own', provider: 'cursor', accountId: null },
			{ machineId: 'peer', provider: 'cursor', accountId: 'sub-peer' }
		];
		expect(buildAccountIndex(mappings, 'own').cursor).toBe('sub-peer');
	});

	it("this machine's own non-null cursor mapping wins over a peer's", () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'own', provider: 'cursor', accountId: 'sub-own' },
			{ machineId: 'peer', provider: 'cursor', accountId: 'sub-peer' }
		];
		expect(buildAccountIndex(mappings, 'own').cursor).toBe('sub-own');
	});

	it('falls back to a peer mapping when this machine has none of its own', () => {
		const mappings: SyncMapping[] = [
			{ machineId: 'peer', provider: 'cursor', accountId: 'sub-peer' }
		];
		expect(buildAccountIndex(mappings, 'own').cursor).toBe('sub-peer');
	});

	it('resolves to null when there is no cursor mapping anywhere', () => {
		expect(buildAccountIndex([], 'own').cursor).toBeNull();
	});
});

describe('attachAccounts legacy local attribution', () => {
	it('attributes pre-pool non-cursor rows without a machine id to the current machine', () => {
		const snapshot = {
			generatedAt: 0,
			earliestDay: '2026-07-19',
			latestDay: '2026-07-19',
			totals: {
				tokens: { input: 1, output: 0, cacheCreation: 0, cacheRead: 0 },
				requests: 1,
				cost: 1,
				costUnknownRequests: 0
			},
			dayModel: [
				{
					day: '2026-07-19',
					provider: 'codex',
					model: 'gpt-5.6-sol',
					tokens: { input: 1, output: 0, cacheCreation: 0, cacheRead: 0 },
					requests: 1,
					cost: 1,
					costUnknownRequests: 0
				}
			],
			sessions: [],
			blocks: [],
			models: ['gpt-5.6-sol'],
			providers: ['codex'],
			unknownPriceModels: [],
			stats: { filesScanned: 1, recordsCounted: 1, linesSkipped: 0, duplicatesSkipped: 0 },
			cutoverTs: null,
			coverage: { '2026-07-19': 'partial' as const }
		};
		const index = buildAccountIndex(
			[{ machineId: 'kinto', provider: 'codex', accountId: 'shared-codex' }],
			'kinto'
		);

		expect(attachAccounts(snapshot, index).dayModel[0]).toMatchObject({
			machineId: 'kinto',
			accountId: 'shared-codex'
		});
	});

	it('keeps account-scoped Cursor rows machine-less', () => {
		const snapshot = emptySnap({
			dayModel: [dm('2026-07-19', { provider: 'cursor', model: 'cursor-auto' })]
		});
		const index = buildAccountIndex(
			[{ machineId: 'kinto', provider: 'cursor', accountId: 'shared-cursor' }],
			'kinto'
		);

		expect(attachAccounts(snapshot, index).dayModel[0]).toMatchObject({
			accountId: 'shared-cursor'
		});
		expect(attachAccounts(snapshot, index).dayModel[0]?.machineId).toBeUndefined();
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


it('preserves the local five-hour source separately from pooled blocks', () => {
	const block = { startTs: 0, endTs: 18_000_000, tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 }, requests: 1, cost: 10, isActive: true };
	const local = emptySnap({ blocks: [block] });
	const peer = emptySnap({ blocks: [{ ...block, cost: 30 }] });
	const merged = mergePooledSnapshot(local, peer, '2026-07-17');
	expect(merged.blocks.reduce((sum, block) => sum + block.cost, 0)).toBe(40);
	expect(merged.localBlocks?.[0].cost).toBe(10);
	expect(merged.localBlocks).toBe(local.blocks);
	expect(attachAccounts(merged, buildAccountIndex([], 'local')).localBlocks).toBe(local.blocks);
});
