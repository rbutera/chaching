import { describe, expect, it } from 'vitest';
import { watermarkLowerBound, WATERMARK_LOOKBACK_MS } from './store';

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
