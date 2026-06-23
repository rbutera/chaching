// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
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
