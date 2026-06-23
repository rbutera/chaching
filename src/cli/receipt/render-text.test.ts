import { describe, it, expect } from 'vitest';
import type { ReceiptModel } from './model.js';
import { renderReceiptText, RECEIPT_WIDTH } from './render-text.js';

function fixtureModel(over: Partial<ReceiptModel> = {}): ReceiptModel {
	return {
		wordmark: '💰 chaching — AI token spend register',
		periodLabel: 'all time',
		period: undefined,
		from: '2026-06-01',
		to: '2026-06-19',
		providers: null,
		lineItems: [
			{
				provider: 'claude',
				model: 'claude-opus-4-8',
				modelLabel: 'Opus 4.8',
				family: 'opus',
				tokens: { input: 1_000_000, output: 500_000, cacheCreation: 0, cacheRead: 2_000_000 },
				requests: 100,
				cost: 12.5,
				unknownPrice: false
			}
		],
		coupons: [
			{
				model: 'claude-opus-4-8',
				modelLabel: 'Opus 4.8',
				family: 'opus',
				cacheReadTokens: 2_000_000,
				wouldHaveCost: 10,
				actualCost: 1,
				saved: 9
			}
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
		footer: 'no refunds. the tokens are gone.',
		barcode: '▌▏▎▏▋▍▌',
		ref: 'ABC123 · 2026-06-19',
		empty: false,
		...over
	};
}

describe('renderReceiptText', () => {
	it('renders all sections in the design wording', () => {
		const out = renderReceiptText(fixtureModel(), { noColor: true });
		expect(out).toContain('chaching — token spend register');
		expect(out).toContain('Opus 4.8');
		expect(out).toContain('TOTAL BURN');
		expect(out).toContain('you saved');
		expect(out).toContain('coupons / cache discounts');
		expect(out).toContain('cache — billed, not free');
		expect(out).toContain('subtotal Opus');
		expect(out).toContain('REF');
	});

	it('NO_COLOR / noColor strips ANSI escapes', () => {
		const out = renderReceiptText(fixtureModel(), { noColor: true });
		// eslint-disable-next-line no-control-regex
		expect(out).not.toMatch(/\x1b\[/);
	});

	it('--no-art uses ASCII rules and drops decorative footer/emoji', () => {
		const out = renderReceiptText(fixtureModel(), { noArt: true, noColor: true });
		expect(out).not.toContain('💰');
		// footer flourish suppressed under no-art
		expect(out).not.toContain('no refunds');
		// numbers + structure intact
		expect(out).toContain('TOTAL BURN');
		expect(out).toContain('$12.50');
		// section wording present even under no-art
		expect(out).toContain('coupons / cache discounts');
	});

	it('empty-state receipt renders the init hint', () => {
		const out = renderReceiptText(fixtureModel({ empty: true, lineItems: [], coupons: [], subtotals: [] }), {
			noColor: true
		});
		expect(out).toContain('chaching init');
	});

	it('no-cache-reads case shows a zero discount line, not a coupon block', () => {
		const out = renderReceiptText(fixtureModel({ coupons: [], youSaved: 0 }), { noColor: true });
		expect(out).toContain('cache discounts');
		expect(out).not.toContain('you saved');
	});

	it('keeps a fixed thermal width (rules span RECEIPT_WIDTH)', () => {
		const out = renderReceiptText(fixtureModel(), { noArt: true, noColor: true });
		const ruleLine = out.split('\n').find((l) => l.startsWith('-'.repeat(10)));
		expect(ruleLine?.length).toBe(RECEIPT_WIDTH);
	});
});
