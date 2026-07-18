// @vitest-environment jsdom
//
// SummaryRail — cost-honesty of the persistent money rail (hard rule: never
// fabricate a "$0.00"). A pinned day that is a gap (`missing`) or still landing
// (`partial`) must render a coverage MARK, not a dollar figure; a genuine `zero`
// day and a `frozen` day still show money. These pin each coverage class and
// assert the rail's headline slot renders honestly.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import SummaryRail from './SummaryRail.svelte';
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

// Range 2026-06-15 .. 2026-06-19 with a deliberate coverage of every class:
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
	return render(SummaryRail, { props: { feed, dash } });
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('SummaryRail coverage honesty', () => {
	it('pins a MISSING (gap) day to a "no data" mark, never $0.00', () => {
		const { getByTestId, container } = renderPinned('2026-06-17');
		const mark = getByTestId('rail-coverage-mark');
		expect(mark).toBeTruthy();
		expect(mark.getAttribute('data-coverage')).toBe('missing');
		expect(mark.textContent).toContain('no data');
		// The fabricated zero must appear nowhere in the rail (lifetime shows real $).
		expect(container.textContent).not.toContain('$0.00');
	});

	it('pins a PARTIAL (still-landing) day to a "partial" mark, not a headline figure', () => {
		const { getByTestId, container } = renderPinned('2026-06-19');
		const mark = getByTestId('rail-coverage-mark');
		expect(mark.getAttribute('data-coverage')).toBe('partial');
		expect(mark.textContent).toContain('partial');
		// It must not headline the incomplete day's dollar figure.
		expect(container.textContent).not.toContain('$12');
	});

	it('pins a genuine ZERO (real quiet) day to $0.00 with no coverage mark', () => {
		const { queryByTestId, container } = renderPinned('2026-06-16');
		expect(queryByTestId('rail-coverage-mark')).toBeNull();
		expect(container.textContent).toContain('$0.00');
	});

	it('pins a FROZEN day to its real total with no coverage mark', () => {
		const { queryByTestId, container } = renderPinned('2026-06-15');
		expect(queryByTestId('rail-coverage-mark')).toBeNull();
		expect(container.textContent).toContain('$40.00');
	});
});
