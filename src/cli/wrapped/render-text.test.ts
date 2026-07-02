import { describe, it, expect } from 'vitest';
import type { WrappedModel } from './model.js';
import { renderWrappedText } from './render-text.js';
import { RECEIPT_WIDTH } from '../receipt/render-text.js';

function fixtureModel(over: Partial<WrappedModel> = {}): WrappedModel {
	return {
		wordmark: '💰 chaching — AI token spend register',
		month: '2026-07',
		monthLabel: 'July 2026',
		monthToDate: true,
		from: '2026-07-01',
		to: '2026-07-15',
		account: 'someone@host',
		headline: { cost: 22.0, tokens: 3_400_000, requests: 160, costUnknownRequests: 0 },
		topModel: {
			model: 'claude-opus-4-8',
			modelLabel: 'Opus 4.8',
			family: 'opus',
			cost: 20.5,
			share: 20.5 / 22.0,
			tokens: 2_900_000,
			requests: 140
		},
		topProject: { display: 'web-app', cost: 15, sessionCount: 3, isUnknown: false, exceedsHeadline: false },
		cache: {
			cacheReadTokens: 2_800_000,
			cacheReadCost: 0.8,
			cacheWriteTokens: 200_000,
			cacheWriteCost: 0.5,
			savedVsUncached: 9.4
		},
		biggestDay: { day: '2026-07-03', cost: 12.5 },
		momDelta: { priorMonth: '2026-06', likeForLike: true, priorTo: '2026-06-15', priorCost: 10, deltaUsd: 12, deltaPct: 1.2 },
		subsidy: { monthlyUsd: 100, apiEquivalentUsd: 20.5, netSubsidyUsd: -79.5, multiple: 0.205 },
		footer: 'no refunds. the tokens are gone.',
		barcode: '▌▏▎▏▋▍▌',
		ref: 'ABC123 · 2026-07',
		empty: false,
		...over
	};
}

describe('renderWrappedText', () => {
	it("'you saved' shows a POSITIVE figure — never a leading minus (W3 review regression)", () => {
		const out = renderWrappedText(fixtureModel(), { noColor: true });
		expect(out).toContain('you saved');
		expect(out).toMatch(/you saved\s+\$9\.40/);
		expect(out).not.toContain('-$9.40');
		expect(out).not.toContain('\u2212$9.40');
	});

	it('omits the top-project dollar when whole-session cost exceeds the headline', () => {
		const out = renderWrappedText(
			fixtureModel({
				topProject: { display: 'marathon', cost: 999, sessionCount: 2, isUnknown: false, exceedsHeadline: true }
			}),
			{ noColor: true }
		);
		expect(out).toContain('marathon');
		expect(out).not.toContain('$999.00');
		expect(out).toContain('sessions span beyond this month');
	});

	it('labels a like-for-like month-to-date delta as "same point"', () => {
		const out = renderWrappedText(fixtureModel(), { noColor: true });
		expect(out).toContain('vs same point in 2026-06');
	});

	it('renders the header + all section heads in the recap voice', () => {
		const out = renderWrappedText(fixtureModel(), { noColor: true });
		expect(out).toContain('chaching wrapped');
		expect(out).toContain('your month in tokens');
		expect(out).toContain('THE HEADLINE');
		expect(out).toContain('YOUR TOP MODEL');
		expect(out).toContain('YOUR TOP PROJECT');
		expect(out).toContain('BIGGEST DAY');
		expect(out).toContain('CACHE SAVINGS');
		expect(out).toContain('VS LAST MONTH');
		expect(out).toContain('SUBSCRIPTION SUBSIDY');
		expect(out).toContain('Opus 4.8');
		expect(out).toContain('web-app');
		expect(out).toContain('$22.00');
		expect(out).toContain('REF');
	});

	it('shows the month-to-date qualifier for the current month', () => {
		const out = renderWrappedText(fixtureModel(), { noColor: true });
		expect(out).toContain('July 2026 (so far)');
	});

	it('NO_COLOR / noColor strips ANSI escapes', () => {
		const out = renderWrappedText(fixtureModel(), { noColor: true });
		// eslint-disable-next-line no-control-regex
		expect(out).not.toMatch(/\x1b\[/);
	});

	it('--no-art uses ASCII rules and drops decorative footer/emoji', () => {
		const out = renderWrappedText(fixtureModel(), { noArt: true, noColor: true });
		expect(out).not.toContain('💰');
		expect(out).not.toContain('no refunds'); // footer flourish suppressed under no-art
		// numbers + section heads intact
		expect(out).toContain('THE HEADLINE');
		expect(out).toContain('$22.00');
	});

	it('keeps a fixed thermal width (rules span RECEIPT_WIDTH)', () => {
		const out = renderWrappedText(fixtureModel(), { noArt: true, noColor: true });
		const ruleLine = out.split('\n').find((l) => l.startsWith('-'.repeat(10)));
		expect(ruleLine?.length).toBe(RECEIPT_WIDTH);
	});

	it('omits the vs-last-month section when there is no baseline (momDelta null)', () => {
		const out = renderWrappedText(fixtureModel({ momDelta: null }), { noColor: true });
		expect(out).not.toContain('VS LAST MONTH');
	});

	it('empty-state recap renders a friendly no-spend message', () => {
		const out = renderWrappedText(fixtureModel({ empty: true }), { noColor: true });
		expect(out).toContain('no spend this month');
		expect(out).not.toContain('THE HEADLINE');
	});
});
