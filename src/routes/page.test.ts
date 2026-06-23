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
			return new Response('{}', { status: 200 });
		})
	);
});
afterEach(() => {
	cleanup();
	snapshotToEmit = null;
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

	it('renders the design region order: hero → controls → stat row → value band → heatmap → model/5h → sessions → footer', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		const main = container.querySelector('main')!;
		const order = [...main.children].map((el) => el.className.split(/\s+/)[0]);
		const idx = (c: string) => order.findIndex((x) => x === c);
		expect(idx('hero')).toBeGreaterThanOrEqual(0);
		expect(idx('hero')).toBeLessThan(idx('controls'));
		expect(idx('controls')).toBeLessThan(idx('stat-grid'));
		expect(idx('stat-grid')).toBeLessThan(idx('value-grid'));
		expect(idx('value-grid')).toBeLessThan(idx('heatmap-sec'));
		expect(idx('heatmap-sec')).toBeLessThan(idx('grid2'));
		expect(idx('grid2')).toBeLessThan(idx('sessions-sec'));
		expect(idx('sessions-sec')).toBeLessThan(idx('honesty'));
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
	it('renders the hero figure immediately when prefers-reduced-motion is set (no count-up dependency)', async () => {
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
		// total spend for the "all" default scope = 84+12+60+8+40 = 204 → "$204"
		const hero = container.querySelector('.hero')!;
		expect(hero.textContent ?? '').toMatch(/\$20[0-9]/);
	});

	it('actually runs the count-up rAF loop when motion is allowed (guards the self-cancelling-effect bug)', async () => {
		// motion allowed by the default beforeEach matchMedia stub (matches:false).
		const rafCalls: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafCalls.push(cb);
			return rafCalls.length;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		// The count-up must have scheduled at least one frame (the self-cancelling
		// effect bug cancels the rAF before any frame, so this would be 0).
		expect(rafCalls.length).toBeGreaterThan(0);
		// Drive the eased frames to completion and confirm the final value lands.
		let t = 0;
		while (rafCalls.length) rafCalls.shift()!((t += 1000));
		await tick();
		expect((container.querySelector('.hero')?.textContent ?? '')).toMatch(/\$20[0-9]/);
	});
});
