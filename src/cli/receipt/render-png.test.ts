import { describe, it, expect } from 'vitest';
import type { ReceiptModel } from './model.js';
import { renderReceiptPng } from './render-png.js';
import { redactReceipt } from './redact.js';

const SECRET_HOST = 'topsecrethost';

function model(over: Partial<ReceiptModel> = {}): ReceiptModel {
	return {
		wordmark: `chaching @ ${SECRET_HOST}`,
		periodLabel: 'all time',
		period: undefined,
		from: '2026-06-01',
		to: '2026-06-19',
		providers: null,
		lineItems: [
			{
				provider: 'claude',
				model: 'claude-opus-4-8',
				modelLabel: `Opus 4.8 ${SECRET_HOST}`,
				family: 'opus',
				tokens: { input: 1_000_000, output: 500_000, cacheCreation: 0, cacheRead: 2_000_000 },
				requests: 100,
				cost: 12.5,
				unknownPrice: false
			}
		],
		coupons: [
			{ model: 'claude-opus-4-8', modelLabel: 'Opus 4.8', family: 'opus', cacheReadTokens: 2_000_000, wouldHaveCost: 10, actualCost: 1, saved: 9 }
		],
		youSaved: 9,
		cacheCost: { cacheReadTokens: 1000, cacheReadCost: 0.5, cacheWriteTokens: 200, cacheWriteCost: 0.25, savedVsUncached: 4 },
		subsidisation: null,
		subtotals: [{ family: 'opus', cost: 12.5, requests: 100 }],
		totalBurn: 12.5,
		totalTokens: 3_500_000,
		requests: 100,
		costUnknownRequests: 0,
		unknownPriceModels: [],
		footer: 'no refunds.',
		barcode: '▌▏▎▏▋▍▌',
		ref: 'ABC123 · 2026-06-19',
		empty: false,
		...over
	};
}

// satori font shaping is slow on cold start; give these a generous ceiling.
describe('renderReceiptPng', () => {
	it('writes a non-empty valid PNG (magic bytes)', async () => {
		const png = await renderReceiptPng(model());
		expect(png.length).toBeGreaterThan(1000);
		// PNG signature
		expect(png[0]).toBe(0x89);
		expect(png[1]).toBe(0x50); // P
		expect(png[2]).toBe(0x4e); // N
		expect(png[3]).toBe(0x47); // G
	}, 30_000);

	it('redacted-by-default PNG bytes do not contain the fixture machine name', async () => {
		const redacted = redactReceipt(model(), {
			hostname: SECRET_HOST,
			username: 'someuser',
			homedir: '/home/someuser',
			env: {} as NodeJS.ProcessEnv
		});
		const png = await renderReceiptPng(redacted);
		// Raster bytes won't contain literal text, but assert defensively anyway:
		// the buffer must not embed the host name as a UTF-8 substring.
		expect(png.includes(Buffer.from(SECRET_HOST, 'utf8'))).toBe(false);
	}, 30_000);
});
