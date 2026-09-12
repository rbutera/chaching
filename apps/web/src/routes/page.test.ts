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
import { render, cleanup, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';
import type { DayModelAgg, RollupSnapshot, TokenCounts, SessionSummary } from '@chaching/shared/types';

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
	// jsdom has no layout observation; responsive geometry is checked in the browser.
	vi.stubGlobal('ResizeObserver', class {
		observe() {}
		unobserve() {}
		disconnect() {}
	});
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));
	localStorage.clear();
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
						accounts: [
							{ id: 'claude', provider: 'claude', name: 'Claude Code', tier: 'max20', monthlyUsd: 200, feeSource: 'explicit' },
							{ id: 'codex', provider: 'codex', name: 'Codex', tier: 'plus', monthlyUsd: 20, feeSource: 'explicit' }
						],
						providerAccounts: { claude: ['claude'], codex: ['codex'] },
						providers: { claude: { enabled: true }, codex: { enabled: true } }
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
	vi.useRealTimers();
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

	it('puts spend before charts and recent sessions without the what-if calculator', async () => {
		snapshotToEmit = richSnap();
		const { container, getByRole } = render(Page);
		await flush();
		const overview = getByRole('region', { name: 'Spend overview' });
		const sessions = getByRole('region', { name: 'Recent sessions' });
		const chart = getByRole('region', { name: /^Spend$/ });
		const quotas = getByRole('region', { name: 'Account quotas' });
		expect(chart.nextElementSibling).toBe(quotas);
		expect(quotas.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(overview.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(container.querySelector('.whatif')).toBeNull();
		expect(container.querySelector('.summary-rail')).toBeNull();
	});

	it('keeps exploration and real sync controls reachable from the shared navigation', async () => {
		snapshotToEmit = richSnap();
		const { getByRole, container } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(container.querySelector('[data-heatmap-grid]')).toBeTruthy();
		expect(container.querySelector('.sessions-sec')).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Settings' }));
		expect(getByRole('heading', { name: 'Settings' })).toBeTruthy();
		expect(container.querySelector('[data-heatmap-grid]')).toBeNull();
	});

});

describe('dashboard route — behavior contracts', () => {
	it('marks unpriced model and project totals as unknown rather than free', async () => {
		const snap = richSnap();
		snap.dayModel.push({ ...dm('2026-06-19', 'claude', 'unpriced-model', 0), costUnknownRequests: 1 });
		snap.sessions.push(session({ sessionId: 'unpriced', project: '/unpriced-project', models: ['unpriced-model'], cost: 0, requests: 1, costUnknownRequests: 1 }));
		snapshotToEmit = snap;
		const { getByRole } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		for (const label of ['Models', 'Projects']) {
			const table = getByRole('table', { name: label });
			expect(table).toHaveTextContent('Unknown');
			expect(table).toHaveTextContent('Partial');
		}
	});

	it('keeps Explore search and sorting across views while View all opens recent scoped sessions', async () => {
		const snap = richSnap();
		snap.sessions.push(session({ sessionId: 'old', project: '/old-project', firstTs: Date.parse('2026-05-01'), lastTs: Date.parse('2026-05-01'), cost: 999 }));
		snap.earliestDay = '2026-05-01';
		snapshotToEmit = snap;
		const { getByRole, getByLabelText, queryByLabelText, queryByText } = render(Page);
		await flush();
		expect(queryByLabelText('Search sessions by project')).toBeNull();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(queryByText('old-project')).toBeNull();
		await fireEvent.input(getByLabelText('Search sessions by project'), { target: { value: 'orca' } });
		await fireEvent.click(getByRole('button', { name: /^Sort by Cost/ }));
		await fireEvent.click(getByRole('button', { name: 'Dashboard' }));
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(getByLabelText('Search sessions by project')).toHaveValue('orca');
		expect(getByRole('button', { name: /^Sort by Cost, descending/ })).toHaveAttribute('aria-pressed', 'true');
		await fireEvent.click(getByRole('button', { name: 'Dashboard' }));
		await fireEvent.click(getByRole('button', { name: /^View all/ }));
		expect(getByLabelText('Search sessions by project')).toHaveValue('');
		expect(getByRole('button', { name: /^Sort by Last active, descending/ })).toHaveAttribute('aria-pressed', 'true');
		expect(queryByText('old-project')).toBeNull();
		await fireEvent.click(getByRole('tab', { name: 'All' }));
		expect(getByRole('button', { name: /^old-project,.*Open session detail/ })).toBeTruthy();
	});

	it('steps full windows and stops once the first recorded day is included', async () => {
		snapshotToEmit = { ...richSnap(), earliestDay: '2026-05-15' };
		const view = render(Page);
		await flush();
		expect(view.getByRole('button', { name: 'Previous window' })).not.toBeDisabled();
		await fireEvent.click(view.getByRole('button', { name: 'Previous window' }));
		expect(view.getByLabelText('Window ending date')).toHaveValue('2026-05-20');
		expect(view.getByRole('button', { name: 'Previous window' })).toBeDisabled();
		await fireEvent.click(view.getByRole('button', { name: 'Next window' }));
		expect(view.getByLabelText('Window ending date')).toHaveValue('2026-06-19');
	});

	it('navigates through quiet today and preserves day focus when choosing a date', async () => {
		vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
		snapshotToEmit = richSnap();
		const { getByRole, getByLabelText } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: /^20 Jun.*Open the day's detail/ }));
		expect(getByLabelText('Window ending date')).toHaveValue('2026-06-20');
		expect(getByRole('button', { name: 'Next window' })).toBeDisabled();
		await fireEvent.click(getByRole('button', { name: 'Previous window' }));
		expect(getByLabelText('Window ending date')).toHaveValue('2026-06-19');
		await fireEvent.change(getByLabelText('Window ending date'), { target: { value: '2026-06-18' } });
		const saved = JSON.parse(localStorage.getItem('chaching.ui.v1')!);
		expect(saved.focusedDay).toBe('2026-06-18');
		expect(saved.period).toBe('month');
		await fireEvent.click(getByRole('button', { name: 'Latest' }));
		expect(getByLabelText('Window ending date')).toHaveValue('2026-06-20');
		expect(JSON.parse(localStorage.getItem('chaching.ui.v1')!).focusedDay).toBeNull();
	});

	it('does not let a pending quota refresh restore a pool after leaving it', async () => {
		vi.useFakeTimers();
		snapshotToEmit = richSnap();
		const machine = { id: 'machine', name: 'Test machine', hostname: 'test', lastSeenAt: null };
		const joined = { enabled: true, databaseConfigured: true, pool: { id: 'pool', name: 'Old pool' }, machine, machines: [machine], accounts: [], mappings: [], providerQuotas: [] };
		const left = { ...joined, enabled: false, databaseConfigured: false, pool: null, machine: null, machines: [] };
		const originalFetch = fetch;
		let reads = 0;
		let resolveStale: (response: Response) => void = () => { throw new Error('Refresh did not start'); };
		vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => {
			if (String(url) !== '/api/sync') return originalFetch(url, init);
			if (init?.method === 'POST') return Promise.resolve(Response.json(left));
			if (++reads === 1) return Promise.resolve(Response.json(joined));
			return new Promise<Response>(resolve => { resolveStale = resolve; });
		});
		const { getByRole, queryByRole } = render(Page);
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		await fireEvent.click(getByRole('button', { name: 'Settings' }));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(reads).toBe(2);
		await fireEvent.click(getByRole('button', { name: 'leave pool' }));
		await fireEvent.click(getByRole('button', { name: 'confirm leave' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(queryByRole('button', { name: 'leave pool' })).toBeNull();
		resolveStale(Response.json(joined));
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		expect(queryByRole('button', { name: 'leave pool' })).toBeNull();
	});

	it('P1: shows all five period keys incl. Quarter + All', async () => {
		snapshotToEmit = richSnap();
		const { getByRole } = render(Page);
		await flush();
		// PeriodSwitcher is a tablist of D/W/M/Q/All
		for (const label of ['1d', '7d', '30d', '90d', 'All'])
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
		const { container, getByRole } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
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
		const { container, getByRole } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(container.querySelector('.by-model')).toBeTruthy();
		expect(getByRole('table', { name: 'Models' })).toBeTruthy();
	});

	it('P13: 5h API-cost panel + recent blocks render', async () => {
		snapshotToEmit = richSnap();
		const { container, getByRole } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(container.querySelector('.cap-panel')).toBeTruthy();
		expect((container.textContent ?? '').toLowerCase()).toContain('5h spend');
		expect(container.querySelectorAll('.recent-blocks li').length).toBeGreaterThan(0);
	});

	it('renders sanitized Tokenmaxx weekly quota for each pooled account', async () => {
		snapshotToEmit = richSnap();
		syncStatusToReturn = {
			enabled: true,
			databaseConfigured: true,
			pool: { id: 'pool', name: 'Test pool' },
			machine: null,
			machines: [],
			accounts: [],
			mappings: [],
			providerQuotas: [{
				machineId: 'nimbus',
				source: 'tokenmaxx',
				observedAt: '2026-08-13T23:00:00Z',
				accounts: [90, 91, 88].map((usedPercent, index) => ({
					label: `Claude account ${index + 1}`,
					provider: 'claude',
					plan: 'default_claude_max_20x',
					hardLimitReached: false,
					windows: [{ id: 'weekly_all', label: '7 day · all models', usedPercent, resetAt: '2026-08-15T04:00:00Z' }]
				}))
			}]
		};
		const { container, getByRole, getAllByRole } = render(Page);
		await flush();
		expect(container.textContent).toContain('Selection unavailable for some providers');
		expect(getAllByRole('meter')).toHaveLength(3);
		expect(getByRole('button', { name: 'Selected' }).getAttribute('title')).toContain('Selected in Tokenmaxx');
		await fireEvent.click(getByRole('button', { name: /^All accounts$/ }));
		const text = container.textContent ?? '';
		expect(text).toContain('Accounts');
		expect(text).toContain('Claude account 1');
		expect(getAllByRole('meter').map(meter => meter.getAttribute('aria-valuenow'))).toEqual(['10', '9', '12']);
		await fireEvent.click(getByRole('button', { name: /^By provider$/ }));
		expect(getAllByRole('meter')).toHaveLength(3);
		expect(JSON.parse(localStorage.getItem('chaching.ui.v1')!).quotaView).toBe('provider');
	});

	it('P7: cross-day session browser renders rows', async () => {
		snapshotToEmit = richSnap();
		const { container, getByRole } = render(Page);
		await flush();
		await fireEvent.click(getByRole('button', { name: 'Explore' }));
		expect(container.querySelector('.sessions-sec')).toBeTruthy();
		// session project names appear somewhere in the explorer
		expect(container.textContent ?? '').toMatch(/orca|chaching/);
	});

	it('P10: subsidisation card renders (fed off /api/config, month-basis)', async () => {
		snapshotToEmit = richSnap();
		const { container, getByRole, getAllByRole } = render(Page);
		await flush();
		expect(container.querySelector('.value-grid')).toBeTruthy();
		expect(container.querySelector('#subsidy-heading')).toBeTruthy();
		expect(container.querySelector('[aria-label="combined subsidy multiple"]')?.textContent).toContain('×');
		await fireEvent.click(getByRole('button', { name: 'Settings' }));
		expect(getAllByRole('combobox', { name: 'Plan' })).toHaveLength(2);
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
			accounts: [
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
				(row as DayModelAgg & { accountId?: string }).accountId = 'sub-codex';
		snapshotToEmit = snap;

		const { container } = render(Page);
		await flush();

		// The pooled card replaced the single-machine SubsidisationCard.
		expect(container.querySelector('#pool-subsidy-heading')).toBeTruthy();
		expect(container.querySelector('#subsidy-heading')).toBeNull();
		expect(container.textContent).toContain('Shared ChatGPT Pro');
	});

	it.each([false, true])('does not substitute local fees for an empty pool scope, unreachable=%s', async unreachable => {
		snapshotToEmit = richSnap();
		syncStatusToReturn = { enabled: true, databaseConfigured: true, unreachable, pool: null, machine: null, machines: [], accounts: [], mappings: [], providerQuotas: [] };
		const { container } = render(Page);
		await flush();
		expect(container.querySelector('#subsidy-heading')).toBeNull();
		expect(container.textContent).toContain(unreachable ? 'Pool unavailable.' : 'No Accounts in this scope.');
	});

	it('P2 + hero: renders the brass register total figure', async () => {
		snapshotToEmit = richSnap();
		const { container } = render(Page);
		await flush();
		// the hero MoneyFigure renders a $ figure
		const hero = container.querySelector('[aria-label="Spend overview"]')!;
		expect((hero.textContent ?? '')).toMatch(/\$/);
	});
});

describe('dashboard route — motion (reduced-motion contract)', () => {
	it('retains an unsaved sibling plan while another provider saves', async () => {
		snapshotToEmit = richSnap();
		const view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		const codex = within(view.getByRole('form', { name: 'Codex plan' }));
		await fireEvent.input(codex.getByRole('spinbutton'), { target: { value: '88' } });
		const claude = within(view.getByRole('form', { name: 'Claude Code plan' }));
		await fireEvent.click(claude.getByRole('button', { name: 'Save' }));
		await flush();
		expect(claude.getByRole('status').textContent).toBe('Saved');
		expect(codex.getByRole('spinbutton')).toHaveProperty('value', '88');
		expect(codex.getByRole('combobox')).toHaveProperty('value', 'custom');
	});

	it('includes the session detail sheet in application-level motion suppression', async () => {
		localStorage.setItem('chaching.reducedMotion', '1');
		snapshotToEmit = richSnap();
		const view = render(Page);
		await flush();
		await fireEvent.click(view.getAllByRole('button', { name: /Open session detail/ })[0]);
		expect(view.getByRole('dialog').closest('.still')).toBeTruthy();
	});

	it('saves plan settings through the endpoint, reports failures, and retains the saved fee on reload', async () => {
		const saved = { accounts: [{ id: 'claude', provider: 'claude', name: 'Claude', tier: 'corporate', monthlyUsd: 99, feeSource: 'explicit' }], providerAccounts: { claude: ['claude'] }, providers: { claude: { enabled: true }, codex: { enabled: false } } };
		let fail = true;
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input).startsWith('/api/config')) {
				if (init?.method === 'POST') {
					if (fail) return new Response('unavailable', { status: 503 });
					saved.accounts[0] = { ...saved.accounts[0], tier: 'custom', monthlyUsd: 275.50 };
				}
				return Response.json(saved);
			}
			return Response.json({});
		});
		snapshotToEmit = richSnap();
		let view = render(Page);
		await flush();
		expect(view.queryByRole('spinbutton')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		await fireEvent.change(view.getByRole('combobox', { name: 'Plan' }), { target: { value: 'max-5x' } });
		expect(view.getByRole('spinbutton')).toHaveProperty('value', '100');
		await fireEvent.input(view.getByRole('spinbutton'), { target: { value: '275.50' } });
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await flush();
		expect(view.getByRole('alert').textContent).toContain('503');
		expect(view.queryByRole('status')).toBeNull();
		expect(saved.accounts[0].monthlyUsd).toBe(99);
		expect(view.getByRole('spinbutton')).toHaveProperty('value', '275.50');
		fail = false;
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await flush();
		expect(view.getByRole('status').textContent).toBe('Saved');
		expect(fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ body: JSON.stringify({ account: { id: 'claude', name: 'Claude', tier: 'custom', monthlyUsd: 275.5 } }) }));
		view.unmount();
		view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		expect(view.getByRole('spinbutton')).toHaveProperty('value', '275.5');
	});

	it.each(['Personality', 'Animations'])('restores %s checkbox when storage rejects the change', async (name) => {
		snapshotToEmit = richSnap();
		const view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		const checkbox = view.getByRole('checkbox', { name: new RegExp(name) });
		const storageMethods = Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype;
		const write = vi.spyOn(storageMethods, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
		try {
			await fireEvent.click(checkbox);
			expect(write).toHaveBeenCalled();
			expect(view.getByRole('alert').textContent).toContain('Could not save');
			expect(checkbox).toHaveProperty('checked', true);
		} finally { write.mockRestore(); }
	});

	it('persists appearance controls across remounts and suppresses Explore motion and art', async () => {
		snapshotToEmit = richSnap();
		let view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		await fireEvent.click(view.getByRole('checkbox', { name: /Animations/ }));
		await fireEvent.click(view.getByRole('checkbox', { name: /Personality/ }));
		expect(localStorage.getItem('chaching.reducedMotion')).toBe('1');
		expect(localStorage.getItem('chaching.noArt')).toBe('1');
		view.unmount();
		view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Explore' }));
		expect(view.container.querySelectorAll('[data-animated="true"]')).toHaveLength(0);
		expect(view.container.textContent).not.toContain('🧾');
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		await fireEvent.click(view.getByRole('checkbox', { name: /Personality/ }));
		expect(view.getByRole('checkbox', { name: /Animations/ })).toHaveProperty('checked', false);
		await fireEvent.click(view.getByRole('checkbox', { name: /Animations/ }));
		await fireEvent.click(view.getByRole('button', { name: 'Dashboard' }));
		expect(view.container.querySelector('[data-animated="true"]')).toBeTruthy();
	});

	it('keeps system reduced motion authoritative over the saved animation preference', async () => {
		vi.mocked(window.matchMedia).mockReturnValue({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() });
		snapshotToEmit = richSnap();
		const view = render(Page);
		await flush();
		await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
		expect(view.getByRole('checkbox', { name: /Animations/ })).toHaveProperty('disabled', true);
		expect(view.getByRole('checkbox', { name: /Animations/ })).toHaveProperty('checked', false);
	});

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
		const hero = container.querySelector('[aria-label="Spend overview"]')!;
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
		expect((container.querySelector('[aria-label="Spend overview"]')?.textContent ?? '')).toMatch(/\$20[0-9]/);
	});
});


it('retains local Account fees and quotas without Account spend filters', async () => {
	snapshotToEmit = richSnap();
	snapshotToEmit.dayModel = snapshotToEmit.dayModel.map(row => ({ ...row, accountId: row.provider }));
	syncStatusToReturn = { enabled: false, machines: [], accounts: ['claude', 'codex'].map(id => ({
		id, provider: id, name: `Local ${id}`, account: '', tier: 'custom', monthlyUsd: 20
	})), mappings: [], providerQuotas: [] };
	const { getByRole, container } = render(Page);
	await flush();
	expect(container.querySelector('[aria-label="Account filter"]')).toBeNull();
	expect(getByRole('link', { name: /shareable receipt/ }).getAttribute('href')).not.toContain('account=');
	expect(getByRole('region', { name: 'Account quotas' }).textContent).toContain('Local codex');
	expect(getByRole('region', { name: 'Cache cost and subscription subsidy' }).textContent).toContain('Local codex');
});


it('keeps Codex quotas visible when only Claude has a selected Account', async () => {
	snapshotToEmit = richSnap();
	syncStatusToReturn = { enabled: false, machines: [], accounts: [], mappings: [], providerQuotas: [{
		machineId: 'one', source: 'tokenmaxx', observedAt: '2026-08-13T23:00:00Z',
		accounts: ['claude', 'codex'].map(provider => ({ provider, label: provider + ' quota',
			current: provider === 'claude', plan: null, hardLimitReached: false,
			windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetAt: null }]
		}))
	}] };
	const { getByRole, getAllByRole } = render(Page);
	await flush();
	const quotas = getByRole('region', { name: 'Account quotas' });
	expect(quotas.textContent).toContain('claude quota');
	expect(quotas.textContent).toContain('codex quota');
	expect(getAllByRole('meter').map(row => row.getAttribute('aria-valuenow'))).toEqual(['75', '75']);
});
