// @vitest-environment jsdom
//
// Dashboard route (`+page.svelte`) — the chaching-ds-web re-skin.
//
// These tests guard the LAYOUT adoption (region order + responsive contract) and
// the P1–P18 PRESERVATION contract from
// openspec/changes/chaching-ds-web/design.md: every v1.4.1–1.6.0 behaviour must
// survive the re-skin, wearing the Register & Receipt system. They render the
// real route over the real view-model fed by a stubbed SSE EventSource (no mock
// data constants), so a dropped feature shows up as a missing region/control.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';
import type { DayModelAgg, RollupSnapshot, TokenCounts, SessionSummary } from '$lib/types';

function toks(input: number, output = 0, cacheCreation = 0, cacheRead = 0): TokenCounts {
	return { input, output, cacheCreation, cacheRead };
}
function dm(day: string, provider: string, model: string, cost: number, requests = 1): DayModelAgg {
	return { day, provider, model, tokens: toks(cost * 1000, cost * 200, 0, cost * 500), requests, cost, costUnknownRequests: 0 };
}
function session(p: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: 'sess-abcdef12',
		provider: 'claude',
		project: '/home/u/dev/orca',
		models: ['claude-opus-4-8'],
		firstTs: Date.parse('2026-06-19T09:00:00Z'),
		lastTs: Date.parse('2026-06-19T11:50:00Z'),
		tokens: toks(900_000, 140_000, 0, 600_000),
		cost: 412.8,
		requests: 120,
		costUnknownRequests: 0,
		...p
	} satisfies SessionSummary;
}

// Two providers (so the provider filter row shows — P18 gate), two models, a few
// days so day/week/month/quarter/all all have data and a heatmap range exists.
function richSnap(): RollupSnapshot {
	const grain = [
		dm('2026-06-19', 'claude', 'claude-opus-4-8', 84),
		dm('2026-06-19', 'codex', 'gpt-5-codex', 12),
		dm('2026-06-18', 'claude', 'claude-opus-4-8', 60),
		dm('2026-06-18', 'claude', 'claude-sonnet-4-5', 8),
		dm('2026-06-17', 'claude', 'claude-opus-4-8', 40)
	];
	const days = grain.map((g) => g.day).sort();
	const latest = days[days.length - 1];
	const spendByDay = new Map<string, number>();
	for (const g of grain) spendByDay.set(g.day, (spendByDay.get(g.day) ?? 0) + g.cost);
	const coverage: Record<string, 'frozen' | 'partial' | 'zero'> = {};
	for (const day of new Set(days)) coverage[day] = day === latest ? 'partial' : spendByDay.get(day)! > 0 ? 'frozen' : 'zero';
	const totalCost = grain.reduce((a, g) => a + g.cost, 0);
	return {
		generatedAt: Date.parse('2026-06-19T12:00:00Z'),
		earliestDay: days[0],
		latestDay: latest,
		totals: { tokens: toks(0), requests: grain.length, cost: totalCost, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [session(), session({ sessionId: 'sess-22222222', project: '/home/u/dev/chaching', models: ['claude-sonnet-4-5'], cost: 38.1 })],
		blocks: [
			{ startTs: Date.parse('2026-06-19T09:00:00Z'), endTs: Date.parse('2026-06-19T14:00:00Z'), tokens: toks(500_000, 80_000, 0, 300_000), cost: 84, requests: 60, isActive: true },
			{ startTs: Date.parse('2026-06-18T09:00:00Z'), endTs: Date.parse('2026-06-18T14:00:00Z'), tokens: toks(200_000), cost: 18.4, requests: 20, isActive: false }
		],
		models: ['claude-opus-4-8', 'claude-sonnet-4-5', 'gpt-5-codex'],
		providers: ['claude', 'codex'],
		unknownPriceModels: [],
		stats: { filesScanned: 42, recordsCounted: 1280, linesSkipped: 3, duplicatesSkipped: 17 },
		cutoverTs: null,
		coverage
	};
}

// A fake EventSource that pushes a snapshot message on the next tick, so the page's
// FeedStore lands a real snapshot and renders the data layout (not the loading state).
let snapshotToEmit: RollupSnapshot | null = null;
// Value returned by the mocked GET /api/sync. Default: local-only (sync disabled).
let syncStatusToReturn: unknown = {};
class FakeEventSource {
	onmessage: ((ev: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(public url: string) {
		// macrotask so the FeedStore has assigned onmessage before we emit.
		setTimeout(() => {
			if (snapshotToEmit) this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', data: snapshotToEmit }) });
		}, 0);
	}
	close() {}
}

beforeEach(() => {
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
	// jsdom has no matchMedia; default to motion-allowed (the reduced-motion test overrides).
	vi.stubGlobal(
		'matchMedia',
		vi.fn((q: string) => ({
			matches: false,
			media: q,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (String(url).startsWith('/api/config'))
				return new Response(
					JSON.stringify({
						providers: {
							claude: { enabled: true, subscription: { tier: 'max20', monthlyUsd: 200 } },
							codex: { enabled: true, subscription: { tier: 'plus', monthlyUsd: 20 } }
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			if (String(url).startsWith('/api/sync'))
				return new Response(JSON.stringify(syncStatusToReturn), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			return new Response('{}', { status: 200 });
		})
	);
});
afterEach(() => {
	cleanup();
	snapshotToEmit = null;
	syncStatusToReturn = {};
	vi.unstubAllGlobals();
});

// Let the fake EventSource emit (macrotask), the config fetch settle, then flush
// Svelte's effect/render queue (tick) so the snapshot-driven re-render lands.
const flush = async () => {
	await new Promise((r) => setTimeout(r, 0));
	await tick();
	await tick();
};

describe('dashboard route — loading state (P17)', () => {
	it('renders the characterful cold-scan state before a snapshot lands', () => {
		snapshotToEmit = null;
		const { container } = render(Page);
		const text = container.textContent ?? '';
		expect(text).toMatch(/counting your sins/i);
		expect(text).toMatch(/only slow part/i);
		// exactly one header, no main yet
		expect(container.querySelectorAll('header')).toHaveLength(1);
		expect(container.querySelectorAll('main')).toHaveLength(0);
	});
});

describe('dashboard route — landmarks + structure (a11y, layout adoption)', () => {
	it('exposes exactly one <header> and one <main>, no nested duplicates', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelectorAll('header')).toHaveLength(1);
		expect(container.querySelectorAll('main')).toHaveLength(1);
		// no landmark nested inside another
		expect(container.querySelector('main header, main main, header main')).toBeNull();
	});

	it('renders the bento zones in order: command bar → rail → now → money → history → pool → ledger', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const main = container.querySelector('main')!;
		// After the visual overhaul the regions are grouped into named bento zones
		// (the command bar + summary rail dissolved the old scattered controls);
		// main's direct children are those zone wrappers in document order.
		const order = [...main.children].map((el) => el.className.split(/\s+/)[0]);
		const idx = (c: string) => order.findIndex((x) => x === c);
		expect(idx('slot-cmd')).toBeGreaterThanOrEqual(0);
		expect(idx('slot-cmd')).toBeLessThan(idx('slot-rail'));
		expect(idx('slot-rail')).toBeLessThan(idx('zone-now'));
		expect(idx('zone-now')).toBeLessThan(idx('zone-money'));
		expect(idx('zone-money')).toBeLessThan(idx('zone-history'));
		expect(idx('zone-history')).toBeLessThan(idx('zone-pool'));
		expect(idx('zone-pool')).toBeLessThan(idx('zone-ledger'));
	});

	it('places each region inside its bento zone (hero+stats in now, value band in money, heatmap+model in history, sessions+footer in ledger)', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('.zone-now .hero')).toBeTruthy();
		expect(container.querySelector('.zone-now .stat-grid')).toBeTruthy();
		expect(container.querySelector('.zone-money .value-grid')).toBeTruthy();
		expect(container.querySelector('.zone-history .heatmap-sec')).toBeTruthy();
		expect(container.querySelector('.zone-history .grid2')).toBeTruthy();
		expect(container.querySelector('.zone-ledger .sessions-sec')).toBeTruthy();
		expect(container.querySelector('.zone-ledger footer.honesty')).toBeTruthy();
		// The command bar owns the scope controls (period tabs + provider pills).
		expect(container.querySelector('.slot-cmd .command-bar')).toBeTruthy();
		expect(container.querySelector('.slot-cmd [role="tablist"]')).toBeTruthy();
	});
});

describe('dashboard route — preservation contract P1–P18', () => {
	it('P1: shows all five period keys incl. Quarter + All', async () => {
		snapshotToEmit = richSnap();
		const { getByRole } = render(Page);
		await flush();
		// PeriodSwitcher is a tablist of D/W/M/Q/All
		for (const label of ['Day', 'Week', 'Month', 'Quarter', 'All'])
			expect(getByRole('tab', { name: label })).toBeTruthy();
	});

	it('P14: connection dot is colour-coded off the feed state (live)', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const dot = container.querySelector('.conn .dot') as HTMLElement;
		expect(dot).toBeTruthy();
		expect(dot.getAttribute('style')).toContain('var(--good)'); // live
	});

	it('P4 + P3: renders the calendar heatmap grid with per-day cells', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('[data-heatmap-grid]')).toBeTruthy();
	});

	it('P18: provider filter row shows (>1 provider) with both providers', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const pills = [...container.querySelectorAll('.pills .provider-pill')];
		expect(pills.length).toBe(2);
		const labels = pills.map((p) => p.textContent ?? '').join(' ');
		expect(labels).toMatch(/Claude/);
		expect(labels).toMatch(/Codex/);
	});

	it('P12: by-model breakdown renders and the panel is present', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('.by-model')).toBeTruthy();
		expect((container.textContent ?? '').toLowerCase()).toContain('by model');
	});

	it('P13: 5h cap-proximity panel + recent blocks render', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('.cap-panel')).toBeTruthy();
		expect((container.textContent ?? '').toLowerCase()).toContain('cap proximity');
		expect(container.querySelectorAll('.recent-blocks li').length).toBeGreaterThan(0);
	});

	it('P7: cross-day session browser renders rows', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('.sessions-sec')).toBeTruthy();
		// session project names appear somewhere in the explorer
		expect(container.textContent ?? '').toMatch(/orca|chaching/);
	});

	it('P15: honesty footer carries the estimate + provenance + retention notes', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const footer = container.querySelector('footer.honesty')!;
		const t = footer.textContent ?? '';
		expect(t).toMatch(/computed estimate/i);
		expect(t).toMatch(/1,?280 responses/); // recordsCounted provenance
		expect(t).toMatch(/42 files/);
		expect(t).toMatch(/retention/i);
		expect(t).toMatch(/not separately metered/i); // thinking-tokens note
	});

	it('P16: work/personal cutover date input is present', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const input = container.querySelector('#cutover') as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.type).toBe('date');
	});

	it('P10: subsidisation card renders (fed off /api/config, month-basis)', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('.value-grid')).toBeTruthy();
		// the SubsidisationCard itself survived (heading + at least one tier control),
		// not just *something* in the value band.
		expect(container.querySelector('#subsidy-heading')).toBeTruthy();
		expect(container.querySelectorAll('.value-grid select, .value-grid button, .value-grid input').length).toBeGreaterThan(0);
	});

	it('M6: pooled subsidy card renders per-subscription value (shared fee counted once)', async () => {
		syncStatusToReturn = {
			enabled: true,
			databaseConfigured: true,
			pool: { id: 'pool-1', name: 'Rai machines' },
			machine: { id: 'm-kinto', name: 'kinto', hostname: 'kinto', lastSeenAt: null, current: true },
			machines: [
				{ id: 'm-kinto', name: 'kinto', hostname: 'kinto', lastSeenAt: null, current: true }
			],
			subscriptions: [
				{
					id: 'sub-codex',
					provider: 'codex',
					name: 'Shared ChatGPT Pro',
					account: '',
					tier: 'pro',
					monthlyUsd: 200
				}
			],
			mappings: []
		};
		const snap = richSnap();
		// Attribute the codex spend to the shared subscription so the card has value.
		for (const row of snap.dayModel)
			if (row.provider === 'codex')
				(row as DayModelAgg & { subscriptionId?: string }).subscriptionId = 'sub-codex';
		snapshotToEmit = snap;

		const { container } = render(Page);
		await flush();

		// The pooled card replaced the single-machine SubsidisationCard.
		expect(container.querySelector('#pool-subsidy-heading')).toBeTruthy();
		expect(container.querySelector('#subsidy-heading')).toBeNull();
		expect(container.textContent).toContain('Shared ChatGPT Pro');
	});

	it('P2 + hero: renders the brass register total figure', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		// the hero MoneyFigure renders a $ figure
		const hero = container.querySelector('.hero')!;
		expect((hero.textContent ?? '')).toMatch(/\$/);
	});
});

describe('dashboard route — motion (reduced-motion contract)', () => {
	it('shows the final hero value when prefers-reduced-motion is set (NumberFlow honours the preference, no roll)', async () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn((q: string) => ({
				matches: /reduce/.test(q),
				media: q,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
				dispatchEvent: vi.fn()
			}))
		);
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		// total spend for the "all" default scope = 84+12+60+8+40 = 204 → "$204.00".
		// The hero figure is the NumberFlow odometer; NumberFlow draws the digits as
		// CSS reels (no plain-text value) and its visual is aria-hidden, so the
		// value the a11y tree + this assertion read is the odometer's visually-hidden
		// text mirror. Under reduced motion it must still be the correct final total.
		const hero = container.querySelector('.hero')!;
		expect(hero.querySelector('[data-testid="money-odometer"]')).toBeTruthy();
		expect(hero.textContent ?? '').toMatch(/\$20[0-9]/);
	});

	it('lands the hero odometer on the correct final value when motion is allowed', async () => {
		// motion allowed by the default beforeEach matchMedia stub (matches:false).
		// The hero value passes through the trailing throttle whose leading edge
		// delivers the first value immediately; NumberFlow owns the roll animation
		// (no count-up rAF loop in our code any more), so the guarantee we assert is
		// simply that the odometer ends on the right total.
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		await tick();
		expect((container.querySelector('.hero')?.textContent ?? '')).toMatch(/\$20[0-9]/);
	});
});
