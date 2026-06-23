// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SessionExplorer from './SessionExplorer.svelte';
import type { SessionSummary } from '$lib/types';

const NOW = new Date('2026-06-19T12:00:00Z').getTime();

function toks(input = 0, output = 0, cacheCreation = 0, cacheRead = 0) {
	return { input, output, cacheCreation, cacheRead };
}

function sess(p: Partial<SessionSummary> & { sessionId: string }): SessionSummary {
	return {
		sessionId: p.sessionId,
		provider: p.provider ?? 'codex',
		project: p.project ?? 'proj-' + p.sessionId,
		firstTs: p.firstTs ?? new Date('2026-06-18T08:00:00Z').getTime(),
		lastTs: p.lastTs ?? new Date('2026-06-18T20:00:00Z').getTime(),
		tokens: p.tokens ?? toks(1000, 500, 0, 0),
		requests: p.requests ?? 3,
		cost: p.cost ?? 1,
		costUnknownRequests: p.costUnknownRequests ?? 0,
		models: p.models ?? ['claude-opus-4-8']
	};
}

describe('SessionExplorer — render, union labels', () => {
	it('renders the frozen ∪ live union, labelling live rows only', () => {
		const sessions = [
			// frozen: last activity 06-18 (yesterday relative to NOW=06-19)
			sess({ sessionId: 'frozen1', project: 'alpha', lastTs: new Date('2026-06-18T20:00:00Z').getTime() }),
			// live: last activity today (06-19)
			sess({
				sessionId: 'live1',
				project: 'beta',
				firstTs: new Date('2026-06-19T08:00:00Z').getTime(),
				lastTs: new Date('2026-06-19T11:00:00Z').getTime()
			})
		];
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		expect(screen.getByText('alpha')).toBeInTheDocument();
		expect(screen.getByText('beta')).toBeInTheDocument();
		const badges = screen.getAllByText('live');
		expect(badges.length).toBe(1); // only the live row
	});

	it('shows the cost-unknown flag when costUnknownRequests > 0, cost still rendered', () => {
		const sessions = [sess({ sessionId: 'u', project: 'partialcost', cost: 2.5, costUnknownRequests: 1 })];
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		expect(screen.getByText('cost partial')).toBeInTheDocument();
		expect(screen.getByText('$2.50')).toBeInTheDocument(); // honest, not $0
	});

	it('shows a friendly empty state with no sessions', () => {
		render(SessionExplorer, { sessions: [], onOpen: () => {}, now: NOW });
		expect(screen.getByText('No sessions in scope.')).toBeInTheDocument();
	});
});

describe('SessionExplorer — sort headers (aria-sort + reorder)', () => {
	const sessions = [
		sess({ sessionId: 'cheap', project: 'cheap', cost: 1, tokens: toks(100), lastTs: new Date('2026-06-10T20:00:00Z').getTime() }),
		sess({ sessionId: 'pricey', project: 'pricey', cost: 99, tokens: toks(50), lastTs: new Date('2026-06-12T20:00:00Z').getTime() }),
		sess({ sessionId: 'tokens', project: 'tokens', cost: 5, tokens: toks(1_000_000), lastTs: new Date('2026-06-11T20:00:00Z').getTime() })
	];

	function projectOrder(): string[] {
		// rows render in sorted order; read the visible project names top-to-bottom by aria-rowindex
		const rows = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-index'));
		return rows
			.sort((a, b) => Number(a.dataset.rowIndex) - Number(b.dataset.rowIndex))
			.map((r) => within(r).getByText(/cheap|pricey|tokens/).textContent ?? '');
	}

	it('default sort is recency (newest lastTs first) and reflects aria-sort', () => {
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		const recencyHeader = screen.getByText('Last active').closest('[role="columnheader"]')!;
		expect(recencyHeader).toHaveAttribute('aria-sort', 'descending');
		// newest lastTs is 'pricey' (06-12), then 'tokens' (06-11), then 'cheap' (06-10)
		expect(projectOrder()).toEqual(['pricey', 'tokens', 'cheap']);
	});

	it('sorting by cost reorders rows and sets aria-sort on the cost header', async () => {
		const user = userEvent.setup();
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		await user.click(screen.getByText('Cost'));
		const costHeader = screen.getByText('Cost').closest('[role="columnheader"]')!;
		expect(costHeader).toHaveAttribute('aria-sort', 'descending'); // cost sortDescFirst
		// recency header is no longer the active sort
		const recencyHeader = screen.getByText('Last active').closest('[role="columnheader"]')!;
		expect(recencyHeader).toHaveAttribute('aria-sort', 'none');
		expect(projectOrder()).toEqual(['pricey', 'tokens', 'cheap']); // 99, 5, 1
	});

	it('sorting by tokens reorders rows by total token count', async () => {
		const user = userEvent.setup();
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		await user.click(screen.getByText('Tokens'));
		expect(projectOrder()[0]).toBe('tokens'); // 1M tokens leads
	});
});

describe('SessionExplorer — project search', () => {
	const sessions = [
		sess({ sessionId: 'a', project: 'foo-service' }),
		sess({ sessionId: 'b', project: 'bar-app' }),
		sess({ sessionId: 'c', project: 'foo-web' })
	];

	it('filters by project and restores on clear', async () => {
		const user = userEvent.setup();
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		const search = screen.getByLabelText('Search sessions by project');
		await user.type(search, 'foo');
		expect(screen.getByText('foo-service')).toBeInTheDocument();
		expect(screen.getByText('foo-web')).toBeInTheDocument();
		expect(screen.queryByText('bar-app')).not.toBeInTheDocument();
		await user.clear(search);
		expect(screen.getByText('bar-app')).toBeInTheDocument();
	});

	it('shows the filtered empty state when nothing matches', async () => {
		const user = userEvent.setup();
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		await user.type(screen.getByLabelText('Search sessions by project'), 'zzz-nomatch');
		expect(screen.getByText('No sessions match that project.')).toBeInTheDocument();
	});
});

describe('SessionExplorer — row click drills the clicked session', () => {
	it('fires onOpen with the clicked session (filtered + sorted, not an unfiltered index)', async () => {
		const user = userEvent.setup();
		const onOpen = vi.fn();
		const sessions = [
			sess({ sessionId: 'a', project: 'keep-me', cost: 1 }),
			sess({ sessionId: 'b', project: 'other', cost: 50 })
		];
		render(SessionExplorer, { sessions, onOpen, now: NOW });
		// filter to the one we want, then click it
		await user.type(screen.getByLabelText('Search sessions by project'), 'keep');
		await user.click(screen.getByText('keep-me'));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0][0].sessionId).toBe('a');
	});
});

describe('SessionExplorer — delta preserves sort + search state', () => {
	it('re-deriving rows from a new sessions prop keeps sort key + search string', async () => {
		const user = userEvent.setup();
		const base = [
			sess({ sessionId: 'a', project: 'foo-1', cost: 1 }),
			sess({ sessionId: 'b', project: 'bar-1', cost: 9 })
		];
		const { rerender } = render(SessionExplorer, { sessions: base, onOpen: () => {}, now: NOW });
		await user.click(screen.getByText('Cost'));
		await user.type(screen.getByLabelText('Search sessions by project'), 'foo');
		// a "delta" arrives: a new live session for the foo project, plus b grows
		const next = [
			sess({ sessionId: 'a', project: 'foo-1', cost: 1 }),
			sess({ sessionId: 'b', project: 'bar-1', cost: 20 }),
			sess({ sessionId: 'c', project: 'foo-2', cost: 3 })
		];
		await rerender({ sessions: next, onOpen: () => {}, now: NOW });
		// search string survived → only foo-* rows visible (bar-1 still filtered out)
		expect(screen.getByText('foo-1')).toBeInTheDocument();
		expect(screen.getByText('foo-2')).toBeInTheDocument();
		expect(screen.queryByText('bar-1')).not.toBeInTheDocument();
		// sort key survived → cost header still active
		const costHeader = screen.getByText('Cost').closest('[role="columnheader"]')!;
		expect(costHeader).toHaveAttribute('aria-sort', 'descending');
	});
});

describe('SessionExplorer — virtualization', () => {
	it('mounts only a subset of rows for a large list (not all N)', () => {
		const sessions = Array.from({ length: 500 }, (_, i) =>
			sess({ sessionId: 's' + i, project: 'p' + i, lastTs: new Date('2026-06-10T00:00:00Z').getTime() + i * 1000 })
		);
		const { container } = render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		const rendered = container.querySelectorAll('[data-row-index]');
		// virtualization: far fewer DOM rows than the 500 in scope
		expect(rendered.length).toBeGreaterThan(0);
		expect(rendered.length).toBeLessThan(500);
		// the sizer reserves the full virtual height (500 × 56px row estimate)
		const sizer = container.querySelector('.sizer') as HTMLElement;
		expect(sizer.style.height).toBe(`${500 * 56}px`);
	});

	it('reports the right session count in the footer', () => {
		const sessions = Array.from({ length: 12 }, (_, i) => sess({ sessionId: 's' + i, project: 'p' + i }));
		render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		expect(screen.getByText('12 sessions')).toBeInTheDocument();
	});
});

describe('SessionExplorer — keyboard nav + roving tabindex', () => {
	const sessions = [
		sess({ sessionId: 'a', project: 'row-a', lastTs: new Date('2026-06-12T20:00:00Z').getTime() }),
		sess({ sessionId: 'b', project: 'row-b', lastTs: new Date('2026-06-11T20:00:00Z').getTime() }),
		sess({ sessionId: 'c', project: 'row-c', lastTs: new Date('2026-06-10T20:00:00Z').getTime() })
	];

	function rowByIndex(container: HTMLElement, i: number) {
		return container.querySelector<HTMLElement>(`[data-row-index="${i}"]`)!;
	}

	it('first row is the only one in the tab order (roving tabindex)', () => {
		const { container } = render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		expect(rowByIndex(container, 0)).toHaveAttribute('tabindex', '0');
		expect(rowByIndex(container, 1)).toHaveAttribute('tabindex', '-1');
	});

	it('ArrowDown moves the active row + roving tabindex follows focus', async () => {
		const user = userEvent.setup();
		const { container } = render(SessionExplorer, { sessions, onOpen: () => {}, now: NOW });
		const first = rowByIndex(container, 0);
		first.focus();
		await user.keyboard('{ArrowDown}');
		// roving tabindex moved to row 1
		expect(rowByIndex(container, 1)).toHaveAttribute('tabindex', '0');
		expect(rowByIndex(container, 0)).toHaveAttribute('tabindex', '-1');
	});

	it('Enter on a focused row drills it', async () => {
		const user = userEvent.setup();
		const onOpen = vi.fn();
		const { container } = render(SessionExplorer, { sessions, onOpen, now: NOW });
		rowByIndex(container, 0).focus();
		await user.keyboard('{Enter}');
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0][0].sessionId).toBe('a'); // recency-sorted first
	});
});
