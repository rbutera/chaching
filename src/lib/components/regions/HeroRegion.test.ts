// @vitest-environment jsdom
//
// HeroRegion — cost-honesty of the hero headline figure (hard rule: never fabricate
// a "$0.00"). A pinned day that is a gap (`missing`) or still landing (`partial`)
// must render the coverage vocabulary in the figure slot, NOT a dollar headline; a
// genuine `zero` day and a `frozen` day still headline money.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import HeroRegion from './HeroRegion.svelte';
import CommandBar from '../CommandBar.svelte';
import { FeedStore } from '$lib/client/feed.svelte';
import { Dashboard } from '$lib/client/dashboard.svelte';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '$lib/types';

function toks(input: number, output = 0): TokenCounts {
	return { input, output, cacheCreation: 0, cacheRead: 0 };
}
function dm(day: string, cost: number): DayModelAgg {
	return {
		day,
		provider: 'claude',
		model: 'claude-opus-4-8',
		tokens: toks(cost * 1000, cost * 200),
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

// Range 2026-06-15 .. 2026-06-19 with one of every coverage class:
//   06-15 frozen ($40)  06-16 zero ($0, real quiet day)  06-17 gap → missing
//   06-18 frozen ($20)  06-19 partial ($12, still landing)
function snapshot(): RollupSnapshot {
	const grain = [dm('2026-06-15', 40), dm('2026-06-18', 20), dm('2026-06-19', 12)];
	return {
		generatedAt: Date.parse('2026-06-19T12:00:00Z'),
		earliestDay: '2026-06-15',
		latestDay: '2026-06-19',
		totals: { tokens: toks(0), requests: grain.length, cost: 72, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: ['claude-opus-4-8'],
		providers: ['claude'],
		unknownPriceModels: [],
		stats: { filesScanned: 1, recordsCounted: 3, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: {
			'2026-06-15': 'frozen',
			'2026-06-16': 'zero',
			'2026-06-18': 'frozen',
			'2026-06-19': 'partial'
		}
	};
}

function renderPinned(day: string) {
	const feed = new FeedStore();
	feed.snapshot = snapshot();
	const dash = new Dashboard();
	dash.focusedDay = day;
	return render(HeroRegion, {
		props: { feed, dash, reducedMotion: true, suppressArt: false }
	});
}

beforeEach(() => {
	localStorage.clear();
	// NumberFlow feature-detects motion via matchMedia; jsdom has none.
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
});
afterEach(() => cleanup());

describe('HeroRegion coverage honesty', () => {
	it('pins a MISSING (gap) day to a "no data" mark, never a $0.00 headline', () => {
		const { getByTestId, container } = renderPinned('2026-06-17');
		const mark = getByTestId('hero-coverage-mark');
		expect(mark.getAttribute('data-coverage')).toBe('missing');
		expect(mark.textContent).toContain('no data');
		// No fabricated headline dollar figure, and no odometer at all for a gap day.
		expect(container.textContent).not.toContain('$0.00');
		expect(container.querySelector('[data-testid="money-odometer"]')).toBeNull();
	});

	it('pins a PARTIAL (still-landing) day to a "partial" mark, not a headline figure', () => {
		const { getByTestId, container } = renderPinned('2026-06-19');
		const mark = getByTestId('hero-coverage-mark');
		expect(mark.getAttribute('data-coverage')).toBe('partial');
		expect(mark.textContent).toContain('partial');
		// It must not headline the incomplete day's dollar figure.
		expect(container.textContent).not.toContain('$12');
	});

	it('pins a genuine ZERO (real quiet) day to a $0.00 headline with no coverage mark', () => {
		const { queryByTestId, container } = renderPinned('2026-06-16');
		expect(queryByTestId('hero-coverage-mark')).toBeNull();
		expect(container.querySelector('[data-testid="money-odometer"]')).toBeTruthy();
		expect(container.textContent).toContain('$0.00');
	});

	it('pins a FROZEN day to its real total headline with no coverage mark', () => {
		const { queryByTestId, container } = renderPinned('2026-06-15');
		expect(queryByTestId('hero-coverage-mark')).toBeNull();
		expect(container.textContent).toContain('$40.00');
	});
});


it('forwards the selected models and date to the receipt', async () => {
	const feed = new FeedStore();
	feed.snapshot = snapshot();
	const dash = new Dashboard();
	dash.focusedDay = '2026-06-15';
	dash.modelFilter = new Set(['claude-opus-4-8']);
	dash.machineFilter = new Set(['one']);
	const view = render(CommandBar, { props: { feed, dash, syncStatus: null } });
	const link = view.getByRole('link', { name: 'Open a shareable receipt of the current view in a new tab' });
	const url = new URL(link.getAttribute('href')!, 'http://localhost');
	expect(url.searchParams.getAll('model')).toEqual(['claude-opus-4-8']);
	expect(url.searchParams.getAll('machine')).toEqual(['one']);
	expect(url.searchParams.getAll('account')).toEqual([]);
	expect(url.searchParams.get('day')).toBe('2026-06-15');
});


it.each(['accounts', 'subscriptions'])('discards saved %s spend scope while retaining supported filters', (key) => {
	localStorage.setItem('chaching.ui.v1', JSON.stringify({
		period: 'month', models: ['claude-opus-4-8'], providers: ['claude'],
		machines: ['one'], focusedDay: '2026-06-15', quotaView: 'all', [key]: ['unmatched']
	}));
	const dash = new Dashboard();
	const snap = snapshot();
	snap.dayModel = snap.dayModel.map(row => ({ ...row, machineId: 'one', accountCandidates: ['a', 'b'] }));
	expect(dash.focusedTotals(snap, dash.focusedDay!).cost).toBe(40);
	expect([...dash.modelFilter]).toEqual(['claude-opus-4-8']);
	expect([...dash.providerFilter]).toEqual(['claude']);
	expect([...dash.machineFilter]).toEqual(['one']);
	expect(dash.quotaView).toBe('all');
	dash.setQuotaView('provider');
	const saved = JSON.parse(localStorage.getItem('chaching.ui.v1')!);
	expect(saved.accounts).toBeUndefined();
	expect(saved.subscriptions).toBeUndefined();
});
