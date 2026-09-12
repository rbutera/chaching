// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/svelte';
import DetailSheet from './DetailSheet.svelte';
import type { DrillTarget } from '$lib/client/dashboard.svelte';
import type { RollupSnapshot, SessionSummary } from '$lib/types';

function emptySnap(): RollupSnapshot {
	return {
		generatedAt: 0,
		earliestDay: null,
		latestDay: null,
		totals: { tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, requests: 0, cost: 0, costUnknownRequests: 0 },
		dayModel: [],
		sessions: [],
		blocks: [],
		models: [],
		providers: [],
		unknownPriceModels: [],
		stats: { filesScanned: 0, recordsCounted: 0, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: {}
	};
}

function session(p: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: p.sessionId ?? 'sess-abcdef12',
		provider: p.provider ?? 'codex',
		project: p.project ?? '/home/u/dev/myproject',
		firstTs: p.firstTs ?? new Date('2026-06-18T08:00:00Z').getTime(),
		lastTs: p.lastTs ?? new Date('2026-06-18T11:30:00Z').getTime(),
		tokens: p.tokens ?? { input: 1000, output: 500, cacheCreation: 200, cacheRead: 8000 },
		requests: p.requests ?? 42,
		cost: p.cost ?? 3.14,
		costUnknownRequests: p.costUnknownRequests ?? 0,
		models: p.models ?? ['claude-opus-4-8', 'claude-sonnet-4-5']
	};
}

describe('DetailSheet — enriched session branch', () => {
	it('shows the per-session model mix as labelled swatches', () => {
		const drill: DrillTarget = { kind: 'session', session: session(), label: 'sess' };
		render(DetailSheet, { drill, snapshot: emptySnap(), onClose: () => {} });
		const mix = screen.getByText('Model mix').closest('section')!;
		// both models in the mix are labelled
		expect(within(mix).getByText('Opus 4.8')).toBeInTheDocument();
		expect(within(mix).getByText('Sonnet 4.5')).toBeInTheDocument();
	});

	it('renders the four token-class split from s.tokens (input/output/cache write/cache read)', () => {
		const drill: DrillTarget = { kind: 'session', session: session(), label: 'sess' };
		render(DetailSheet, { drill, snapshot: emptySnap(), onClose: () => {} });
		const comp = screen.getByText('Token composition').closest('section')!;
		// TokenSplitBar renders all four class labels
		expect(within(comp).getByText('Input (fresh)')).toBeInTheDocument();
		expect(within(comp).getByText('Output')).toBeInTheDocument();
		expect(within(comp).getByText('Cache write')).toBeInTheDocument();
		expect(within(comp).getByText('Cache read')).toBeInTheDocument();
	});

	it('notes cost-unknown requests honestly when costUnknownRequests > 0', () => {
		const drill: DrillTarget = {
			kind: 'session',
			session: session({ costUnknownRequests: 5, requests: 42 }),
			label: 'sess'
		};
		render(DetailSheet, { drill, snapshot: emptySnap(), onClose: () => {} });
		expect(screen.getByText(/no known price/i)).toBeInTheDocument();
	});

	it('does not show the cost-unknown note when all requests are priced', () => {
		const drill: DrillTarget = { kind: 'session', session: session({ costUnknownRequests: 0 }), label: 'sess' };
		render(DetailSheet, { drill, snapshot: emptySnap(), onClose: () => {} });
		expect(screen.queryByText(/no known price/i)).not.toBeInTheDocument();
	});
});


it('opens a native modal and forwards cancellation to its owner', async () => {
	const onClose = vi.fn();
	render(DetailSheet, { drill: { kind: 'session', session: session(), label: 'sess' }, snapshot: emptySnap(), onClose });
	const dialog = screen.getByRole('dialog');
	expect(dialog.tagName).toBe('DIALOG');
	expect(dialog).toHaveAttribute('open');
	await fireEvent(dialog, new Event('cancel'));
	expect(onClose).toHaveBeenCalledOnce();
});


it('applies the same four filters to period detail and its prior comparison', () => {
	const snapshot = emptySnap();
	const row = { day: '2026-06-18', provider: 'claude', model: 'claude-sonnet-4-5', machineId: 'one', accountId: 'a', cost: 10, requests: 1, costUnknownRequests: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 } };
	snapshot.dayModel = [row, { ...row, day: '2026-06-17', cost: 5 },
		...['2026-06-18', '2026-06-17'].flatMap(day => [
			{ ...row, day, cost: 1000, provider: 'codex' },
			{ ...row, day, cost: 1000, model: 'other' },
			{ ...row, day, cost: 1000, machineId: 'two' },
			{ ...row, day, cost: 1000, accountId: 'b' }
		])];
	const view = render(DetailSheet, { snapshot,
		drill: { kind: 'period', from: row.day, to: row.day, periodKey: row.day, label: 'day' },
		scope: { providerFilter: new Set(['claude']), modelFilter: new Set([row.model]), machineFilter: new Set(['one']), accountFilter: new Set(['a']) }, onClose: () => {} });
	expect(view.container.querySelector('.hval')).toHaveTextContent('$10.00');
	expect(view.getByLabelText('+100% compared with previous window, $5.00')).toBeInTheDocument();
});

it('renders retained monetary components without applying current model rates', () => {
	const priced = {...session({models:['claude-opus-4-8']}), monetary:{input:1.23,output:2.34,cacheCreation:3.45,cacheRead:4.56,tools:5.67}};
	render(DetailSheet, {drill:{kind:'session',session:priced,label:'session'}, snapshot:emptySnap(),onClose:()=>{}});
	expect(screen.getByText('$4.5600')).toBeInTheDocument();
	expect(screen.getByText('$5.6700')).toBeInTheDocument();
	expect(screen.queryByText(/\/M/)).not.toBeInTheDocument();
});
