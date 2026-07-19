import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../types';
import {
	coalesceSessionsForPublish,
	watermarkLowerBound,
	WATERMARK_LOOKBACK_MS
} from './store';

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: 'same-session',
		provider: 'claude',
		project: '/Users/rai/focused',
		firstTs: 100,
		lastTs: 200,
		tokens: { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 },
		requests: 5,
		cost: 6,
		costUnknownRequests: 7,
		models: ['opus'],
		...overrides
	};
}

describe('coalesceSessionsForPublish', () => {
	it('merges pre-pool and post-pool fragments before the bulk upsert', () => {
		const merged = coalesceSessionsForPublish(
			[
				session({ machineId: undefined }),
				session({
					machineId: 'kinto',
					firstTs: 50,
					lastTs: 300,
					tokens: { input: 10, output: 20, cacheCreation: 30, cacheRead: 40 },
					requests: 50,
					cost: 60,
					costUnknownRequests: 70,
					models: ['sonnet']
				})
			],
			'kinto'
		);

		expect(merged).toEqual([
			{
				...session(),
				machineId: 'kinto',
				firstTs: 50,
				lastTs: 300,
				tokens: { input: 11, output: 22, cacheCreation: 33, cacheRead: 44 },
				requests: 55,
				cost: 66,
				costUnknownRequests: 77,
				models: ['opus', 'sonnet']
			}
		]);
	});

	it('keeps different provider identities separate', () => {
		const merged = coalesceSessionsForPublish(
			[session(), session({ provider: 'codex' })],
			'kinto'
		);

		expect(merged).toHaveLength(2);
	});
});

// C6: incremental peer reads back the watermark off by a lookback margin so a peer publish
// whose updated_at (transaction-start) precedes its commit visibility is not skipped forever.
describe('watermarkLowerBound (C6)', () => {
	it('backs the watermark off by the given margin', () => {
		expect(watermarkLowerBound('2026-07-17T12:00:00.000Z', 60_000)).toBe(
			'2026-07-17T11:59:00.000Z'
		);
	});

	it('uses the default 60s lookback margin', () => {
		expect(WATERMARK_LOOKBACK_MS).toBe(60_000);
		expect(watermarkLowerBound('2026-07-17T12:00:00.000Z')).toBe('2026-07-17T11:59:00.000Z');
	});

	it('passes null through — the first read must read everything', () => {
		expect(watermarkLowerBound(null)).toBeNull();
	});

	it('returns an unparseable value unchanged rather than NaN', () => {
		expect(watermarkLowerBound('not-a-date')).toBe('not-a-date');
	});
});
