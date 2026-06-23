// /api/receipt.png GET handler — param validation + redaction-default + stream.
//
// Mocks the heavy/native bits: the singleton engine service, the persisted config,
// and the satori/resvg render pipeline (lazy-imported in the handler). We assert the
// handler's CONTRACT — period default, redaction OPT-IN (off by default), the
// focused-day 400 guard, and the image/png response — not the raster itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RollupSnapshot } from '$lib/types';

const snapshot: RollupSnapshot = {
	generatedAt: Date.parse('2026-06-19T12:00:00Z'),
	earliestDay: '2026-06-01',
	latestDay: '2026-06-19',
	totals: { tokens: { input: 1000, output: 500, cacheCreation: 0, cacheRead: 200 }, requests: 5, cost: 12.5, costUnknownRequests: 0 },
	dayModel: [
		{ day: '2026-06-10', provider: 'claude', model: 'claude-opus-4-8', tokens: { input: 1000, output: 500, cacheCreation: 0, cacheRead: 200 }, requests: 5, cost: 12.5, costUnknownRequests: 0 }
	],
	sessions: [],
	blocks: [],
	models: ['claude-opus-4-8'],
	providers: ['claude'],
	unknownPriceModels: [],
	stats: { filesScanned: 1, recordsCounted: 5, linesSkipped: 0, duplicatesSkipped: 0 },
	workCutover: null
} as unknown as RollupSnapshot;

vi.mock('$lib/server/service', () => ({
	getService: () => ({
		ensureStarted: vi.fn().mockResolvedValue(undefined),
		snapshot: () => snapshot
	})
}));

vi.mock('$lib/core/config', () => ({
	loadConfig: vi.fn().mockResolvedValue({
		providers: {
			claude: { enabled: true, subscription: { tier: 'corporate', monthlyUsd: 99 } },
			codex: { enabled: false, subscription: { tier: 'corporate', monthlyUsd: 0 } }
		}
	})
}));

// Capture what the handler passes to the redactor so we can assert the default.
const redactCalls: Array<{ redact?: boolean }> = [];
vi.mock('../../../cli/receipt/redact', async (orig) => {
	const real = (await orig()) as typeof import('../../../cli/receipt/redact');
	return {
		...real,
		redactReceipt: (model: unknown, opts: { redact?: boolean } = {}) => {
			redactCalls.push(opts);
			return real.redactReceipt(model as never, opts);
		}
	};
});

// Stub the lazy-imported render pipeline so the test never touches satori/resvg.
vi.mock('../../../cli/receipt/render-png', () => ({
	renderReceiptPng: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
}));

import { GET } from './+server';

function call(query: string) {
	const url = new URL(`http://localhost/api/receipt.png${query}`);
	// Only `url` is read by the handler.
	return (GET as unknown as (e: { url: URL }) => Promise<Response>)({ url });
}

describe('/api/receipt.png', () => {
	beforeEach(() => {
		redactCalls.length = 0;
	});

	it('streams an image/png with no-store on the default (monthly) view', async () => {
		const res = await call('');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body[0]).toBe(0x89); // PNG magic (from the stub)
	});

	it('redaction is OPT-IN: default call does NOT redact', async () => {
		await call('');
		expect(redactCalls.at(-1)).toEqual({ redact: false });
	});

	it('?redact=1 turns redaction ON', async () => {
		await call('?redact=1');
		expect(redactCalls.at(-1)).toEqual({ redact: true });
	});

	it('a malformed ?day= is a 400 (never silently widens scope)', async () => {
		await expect(call('?day=not-a-date')).rejects.toMatchObject({ status: 400 });
	});

	it('a well-formed ?day= is accepted (200)', async () => {
		const res = await call('?day=2026-06-10');
		expect(res.status).toBe(200);
	});
});
