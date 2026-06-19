import { describe, expect, it } from 'vitest';
import { cursorEventToRecord, fetchCursorUsageRecords } from './api';

describe('Cursor Admin API provider', () => {
	it('maps filtered usage events using chargedCents as authoritative cost', () => {
		const rec = cursorEventToRecord({
			timestamp: '1750979225854',
			userEmail: 'developer@company.com',
			model: 'claude-4.5-sonnet',
			kind: 'Usage-based',
			maxMode: true,
			requestsCosts: 5,
			isTokenBasedCall: true,
			isChargeable: true,
			isHeadless: false,
			tokenUsage: {
				inputTokens: 126,
				outputTokens: 450,
				cacheWriteTokens: 6112,
				cacheReadTokens: 11964,
				totalCents: 20.18232
			},
			chargedCents: 21.36232,
			cursorTokenFee: 1.18
		});

		expect(rec.provider).toBe('cursor');
		expect(rec.model).toBe('claude-4.5-sonnet');
		expect(rec.project).toBe('developer@company.com');
		expect(rec.cost).toBeCloseTo(0.2136232);
		expect(rec.tokens).toEqual({ input: 126, output: 450, cacheCreation: 6112, cacheRead: 11964 });
	});

	it('posts to filtered usage events with Basic auth and maps paginated events', async () => {
		const requests: Request[] = [];
		const fetcher = async (request: Request): Promise<Response> => {
			requests.push(request);
			return Response.json({
				pagination: { hasNextPage: false },
				usageEvents: [
					{
						timestamp: '1750979225854',
						userEmail: 'developer@company.com',
						model: 'claude-4.5-sonnet',
						isTokenBasedCall: true,
						tokenUsage: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 3, cacheReadTokens: 4 },
						chargedCents: 50
					}
				]
			});
		};

		const records = await fetchCursorUsageRecords({
			adminApiToken: 'crsr_test',
			startDate: 1,
			endDate: 2,
			pageSize: 25,
			fetcher
		});

		expect(records).toHaveLength(1);
		expect(records[0].cost).toBe(0.5);
		expect(requests[0].url).toBe('https://api.cursor.com/teams/filtered-usage-events');
		expect(requests[0].headers.get('authorization')).toBe(`Basic ${btoa('crsr_test:')}`);
		expect(await requests[0].json()).toEqual({ startDate: 1, endDate: 2, page: 1, pageSize: 25 });
	});
});
