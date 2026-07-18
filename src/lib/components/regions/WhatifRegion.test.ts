// @vitest-environment jsdom
//
// WhatifRegion — the Counterfactual Lab web surface. Pins the cost-honesty +
// labelling contract the spec requires: the price-only-counterfactual framing is
// visible, deltas render against the real bill ("would have billed"), unknown-priced
// usage shows as an exclusion (spend known OR "spend unknown"), and a scenario with
// null totals renders "unavailable" — NEVER a fabricated $0. The region fetches its
// ledger from /api/whatif (pricing resolution is server-only), so fetch is stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import WhatifRegion from './WhatifRegion.svelte';
import { FeedStore } from '$lib/client/feed.svelte';
import { Dashboard } from '$lib/client/dashboard.svelte';
import { PRICE_ONLY_COUNTERFACTUAL } from '$lib/core/whatif/types';
import type { ScenarioResult } from '$lib/core/whatif/types';
import type { DayModelAgg, RollupSnapshot, TokenCounts } from '$lib/types';

function toks(input: number, output = 0): TokenCounts {
	return { input, output, cacheCreation: input / 2, cacheRead: input };
}
function dm(day: string, model: string, cost: number): DayModelAgg {
	return {
		day,
		provider: 'claude',
		model,
		tokens: toks(cost * 1000, cost * 200),
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

function snapshot(): RollupSnapshot {
	const grain = [
		dm('2026-06-18', 'claude-opus-4-8', 40),
		dm('2026-06-19', 'claude-sonnet-4-6', 20)
	];
	return {
		generatedAt: Date.parse('2026-06-19T12:00:00Z'),
		earliestDay: '2026-06-13',
		latestDay: '2026-06-19',
		totals: { tokens: toks(0), requests: grain.length, cost: 60, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: ['claude-opus-4-8', 'claude-sonnet-4-6'],
		providers: ['claude'],
		unknownPriceModels: [],
		stats: { filesScanned: 1, recordsCounted: 2, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: { '2026-06-18': 'frozen', '2026-06-19': 'partial' }
	};
}

// The canned ledger the stubbed endpoint returns: an alt-model reprice with a real
// (known-spend) exclusion, a no-cache upper bound, and an UNAVAILABLE plan-fit whose
// excluded spend is genuinely unknown.
const RESULTS: ScenarioResult[] = [
	{
		id: 'alt-model:claude-haiku-4-5',
		kind: 'alt-model',
		label: 'Everything at claude-haiku-4-5 prices',
		basis: 'observed tokens repriced at claude-haiku-4-5',
		totalUsd: 42,
		actualUsd: 60,
		deltaUsd: -18,
		exclusions: { modelCount: 1, models: ['claude/mystery-x'], spendUsd: 5 },
		notes: [
			PRICE_ONLY_COUNTERFACTUAL,
			'observed tokens repriced at claude-haiku-4-5',
			'$5.00 of usage across 1 model(s) could not be repriced and was excluded from both sides.'
		]
	},
	{
		id: 'no-cache',
		kind: 'no-cache',
		label: 'If nothing had been cached',
		basis: 'cache reads + writes rebilled at base input rate',
		totalUsd: 210,
		actualUsd: 60,
		deltaUsd: 150,
		exclusions: { modelCount: 0, models: [], spendUsd: 0 },
		notes: [PRICE_ONLY_COUNTERFACTUAL, 'Upper bound: every cached token rebilled at base input rate.']
	},
	{
		id: 'plan-fit:codex',
		kind: 'plan-fit',
		label: 'Plan-fit — codex',
		basis: 'no priceable usage to compare',
		totalUsd: null,
		actualUsd: null,
		deltaUsd: null,
		exclusions: { modelCount: 2, models: ['codex/a', 'codex/b'], spendUsd: null },
		notes: [PRICE_ONLY_COUNTERFACTUAL, 'No priceable codex usage in this window; plan-fit is unavailable.']
	}
];

function stubFetchOk() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			json: async () => ({
				window: { from: '2026-06-13', to: '2026-06-19' },
				targetModel: 'claude-haiku-4-5',
				actual: { costUsd: 72, costUnknownRequests: 0 },
				label: PRICE_ONLY_COUNTERFACTUAL,
				results: RESULTS
			})
		}))
	);
}

function renderRegion() {
	const feed = new FeedStore();
	feed.snapshot = snapshot();
	const dash = new Dashboard();
	return render(WhatifRegion, { props: { feed, dash, reducedMotion: true } });
}

beforeEach(() => {
	localStorage.clear();
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
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('WhatifRegion', () => {
	it('shows the mandatory price-only-counterfactual label with the results', async () => {
		stubFetchOk();
		const { container } = renderRegion();
		await waitFor(() =>
			expect(container.textContent).toContain('Everything at claude-haiku-4-5 prices')
		);
		expect(container.textContent).toContain('Price-only counterfactual');
	});

	it('renders the real bill anchor and the counterfactual comparison', async () => {
		stubFetchOk();
		const { container } = renderRegion();
		await waitFor(() => expect(container.textContent).toContain('would have billed'));
		// actual bill anchor
		expect(container.textContent).toContain('$72.00');
		// alt-model cheaper delta against the real bill
		expect(container.textContent).toContain('-$18.00');
		// no-cache upper-bound dearer delta
		expect(container.textContent).toContain('+$150.00');
	});

	it('surfaces a known-spend exclusion as a dollar figure', async () => {
		stubFetchOk();
		const { container } = renderRegion();
		await waitFor(() => expect(container.textContent).toContain('excluded'));
		expect(container.textContent).toContain('$5.00');
	});

	it('renders an unavailable scenario without fabricating $0, and shows "spend unknown"', async () => {
		stubFetchOk();
		const { container } = renderRegion();
		await waitFor(() => expect(container.textContent).toContain('Plan-fit — codex'));
		expect(container.textContent?.toLowerCase()).toContain('unavailable');
		expect(container.textContent).toContain('spend unknown');
		// cost-honesty hard rule: no fabricated $0.00 anywhere on the surface
		expect(container.textContent).not.toContain('$0.00');
	});

	it('offers alt-model targets derived from the window models plus canonical alternatives', async () => {
		stubFetchOk();
		const { container } = renderRegion();
		const select = await waitFor(() => {
			const el = container.querySelector('select');
			if (!el) throw new Error('no select yet');
			return el as HTMLSelectElement;
		});
		const values = Array.from(select.options).map((o) => o.value);
		// present models are offered…
		expect(values).toContain('claude-opus-4-8');
		expect(values).toContain('claude-sonnet-4-6');
		// …plus a canonical cheaper alternative not already present
		expect(values).toContain('claude-haiku-4-5');
	});

	it('derives targets from the UNFILTERED window even when a provider filter scopes the dashboard', async () => {
		stubFetchOk();
		const feed = new FeedStore();
		const base = snapshot();
		feed.snapshot = {
			...base,
			dayModel: [
				dm('2026-06-18', 'claude-opus-4-8', 40),
				{ ...dm('2026-06-19', 'gpt-5', 20), provider: 'codex' }
			],
			models: ['claude-opus-4-8', 'gpt-5'],
			providers: ['claude', 'codex']
		};
		const dash = new Dashboard();
		dash.toggleProvider('claude'); // scope the dashboard to claude-only
		const { container } = render(WhatifRegion, {
			props: { feed, dash, reducedMotion: true }
		});
		const select = await waitFor(() => {
			const el = container.querySelector('select');
			if (!el) throw new Error('no select yet');
			return el as HTMLSelectElement;
		});
		const values = Array.from(select.options).map((o) => o.value);
		// dash.models() would drop the codex model under the claude-only filter; the
		// whatif menu must still offer it because /api/whatif reprices the whole window.
		expect(values).toContain('gpt-5');
		expect(values).toContain('claude-opus-4-8');
	});
});
