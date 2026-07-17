import { describe, expect, it } from 'vitest';
import type { RollupDelta, RollupSnapshot } from '../types';
import { applyDelta } from './merge';

function snapshot(cost: number, subscriptionId: string | null): RollupSnapshot {
	return {
		generatedAt: cost,
		earliestDay: '2026-07-17',
		latestDay: '2026-07-17',
		totals: {
			tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
			requests: 1,
			cost,
			costUnknownRequests: 0
		},
		dayModel: [
			{
				day: '2026-07-17',
				provider: 'codex',
				model: 'gpt-5.6-sol',
				machineId: 'kinto',
				subscriptionId,
				tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
				requests: 1,
				cost,
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
		coverage: { '2026-07-17': 'partial' }
	};
}

describe('applyDelta pooled replacement', () => {
	it('drops stale attribution keys when the engine sends a full replacement', () => {
		const before = snapshot(1, 'old-subscription');
		const replacement = snapshot(1, 'new-subscription');
		const delta: RollupDelta = { ...replacement, replace: replacement };
		expect(applyDelta(before, delta)).toBe(replacement);
		expect(applyDelta(before, delta).dayModel[0]?.subscriptionId).toBe('new-subscription');
	});
});
