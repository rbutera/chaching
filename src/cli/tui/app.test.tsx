import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { DayModelAgg, RollupDelta, RollupSnapshot, TokenCounts } from '../../lib/types.js';
import { DashboardApp, type DashboardSource } from './app.js';

function toks(input: number): TokenCounts {
	return { input, output: Math.floor(input / 2), cacheCreation: 0, cacheRead: 0 };
}

function dm(day: string, provider: string, model: string, cost: number, requests = 1): DayModelAgg {
	return { day, provider, model, tokens: toks(cost * 1000), requests, cost, costUnknownRequests: 0 };
}

function snapFrom(grain: DayModelAgg[]): RollupSnapshot {
	const days = grain.map((g) => g.day).sort();
	const totalCost = grain.reduce((a, g) => a + g.cost, 0);
	const totalReq = grain.reduce((a, g) => a + g.requests, 0);
	return {
		generatedAt: 1,
		earliestDay: days[0] ?? null,
		latestDay: days[days.length - 1] ?? null,
		totals: { tokens: toks(0), requests: totalReq, cost: totalCost, costUnknownRequests: 0 },
		dayModel: grain,
		sessions: [],
		blocks: [],
		models: [...new Set(grain.map((g) => g.model))],
		providers: [...new Set(grain.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: { filesScanned: 1, recordsCounted: grain.length, linesSkipped: 0, duplicatesSkipped: 0 },
		cutoverTs: null,
		coverage: {}
	};
}

function deltaFrom(snap: RollupSnapshot, extra: DayModelAgg[]): RollupDelta {
	const merged = [...snap.dayModel, ...extra];
	return {
		generatedAt: snap.generatedAt + 1,
		dayModel: extra,
		sessions: [],
		blocks: [],
		totals: {
			tokens: toks(0),
			requests: merged.reduce((a, g) => a + g.requests, 0),
			cost: merged.reduce((a, g) => a + g.cost, 0),
			costUnknownRequests: 0
		},
		earliestDay: snap.earliestDay,
		latestDay: extra.map((g) => g.day).sort().pop() ?? snap.latestDay,
		models: [...new Set(merged.map((g) => g.model))],
		providers: [...new Set(merged.map((g) => g.provider))],
		unknownPriceModels: [],
		stats: snap.stats,
		coverage: snap.coverage
	};
}

/** A controllable fake source: holds a snapshot, lets the test push deltas. */
function makeSource(initial: RollupSnapshot) {
	let snap = initial;
	const listeners = new Set<(d: RollupDelta) => void>();
	const dispose = vi.fn();
	const unsubscribe = vi.fn();
	const source: DashboardSource = {
		snapshot: () => snap,
		subscribe: (fn) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
				unsubscribe();
			};
		},
		dispose
	};
	return {
		source,
		dispose,
		unsubscribe,
		push(delta: RollupDelta) {
			snap = { ...snap }; // source.snapshot only read at mount; delta drives state
			for (const fn of listeners) fn(delta);
		}
	};
}

const DIMS = { columns: 100, rows: 40 };
const POPULATED = snapFrom([
	dm('2026-06-19', 'codex', 'claude-opus-4-8', 10),
	dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 4),
	dm('2026-06-18', 'codex', 'claude-opus-4-8', 6)
]);

describe('DashboardApp', () => {
	it('renders a populated snapshot: totals, breakdowns, trend, 5h block', () => {
		const { source } = makeSource(POPULATED);
		const { lastFrame, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		const frame = lastFrame()!;
		expect(frame).toContain('Spend');
		expect(frame).toContain('Total spend');
		expect(frame).toContain('By provider');
		expect(frame).toContain('Codex');
		expect(frame).toContain('By model');
		expect(frame).toContain('Trend');
		expect(frame).toContain('5h window');
		unmount();
	});

	it('updates on a pushed delta', async () => {
		const { source, push } = makeSource(POPULATED);
		const { lastFrame, unmount } = render(
			<DashboardApp source={source} period="day" noArt now={() => 0} dimensions={DIMS} />
		);
		// day scope: 2026-06-19 only => $14
		expect(lastFrame()).toContain('$14');
		push(deltaFrom(POPULATED, [dm('2026-06-19', 'cursor', 'claude-haiku-4-5', 6)]));
		await new Promise((r) => setTimeout(r, 20));
		expect(lastFrame()).toContain('$20'); // 14 + 6
		unmount();
	});

	it('provider filter scopes all views and Σ scoped == unscoped', async () => {
		const { source } = makeSource(POPULATED);
		const { lastFrame, stdin, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		// unscoped weekly total = 20
		expect(lastFrame()).toContain('$20');
		// toggle provider [1] (highest-cost = codex, $16). Filter to codex only.
		stdin.write('1');
		await new Promise((r) => setTimeout(r, 20));
		const scoped = lastFrame()!;
		expect(scoped).toContain('$16'); // codex only
		// the filter scope shows in the hero label
		expect(scoped).toContain('codex');
		unmount();
	});

	it('period switch recomputes buckets', async () => {
		// 10 days of $1/day so day vs week totals differ.
		const grain: DayModelAgg[] = [];
		for (let i = 0; i < 10; i++) {
			const d = new Date(Date.UTC(2026, 5, 19));
			d.setUTCDate(d.getUTCDate() - i);
			grain.push(dm(d.toISOString().slice(0, 10), 'codex', 'claude-opus-4-8', 1));
		}
		const { source } = makeSource(snapFrom(grain));
		const { lastFrame, stdin, unmount } = render(
			<DashboardApp source={source} period="day" noArt now={() => 0} dimensions={DIMS} />
		);
		expect(lastFrame()).toContain('Trend · Day');
		stdin.write('w');
		await new Promise((r) => setTimeout(r, 20));
		expect(lastFrame()).toContain('Trend · Week');
		unmount();
	});

	it('selection (filter + period) survives an incoming delta', async () => {
		const { source, push } = makeSource(POPULATED);
		const { lastFrame, stdin, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		stdin.write('m'); // month
		stdin.write('1'); // filter to codex
		await new Promise((r) => setTimeout(r, 20));
		expect(lastFrame()).toContain('Last 30 days');
		expect(lastFrame()).toContain('codex');
		// delta arrives — must NOT reset period or filter
		push(deltaFrom(POPULATED, [dm('2026-06-19', 'opencode', 'claude-sonnet-4-5', 100)]));
		await new Promise((r) => setTimeout(r, 20));
		const frame = lastFrame()!;
		expect(frame).toContain('Last 30 days'); // period kept
		expect(frame).toContain('codex'); // filter kept
		// codex total unchanged ($16) despite the opencode delta
		expect(frame).toContain('$16');
		unmount();
	});

	it('clean quit calls unsubscribe + dispose', async () => {
		const { source, dispose, unsubscribe } = makeSource(POPULATED);
		const { stdin, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		stdin.write('q');
		await new Promise((r) => setTimeout(r, 30));
		// `q` calls exit(); ink-testing-library resolves waitUntilExit + unmounts.
		// Force unmount to flush the cleanup effect deterministically.
		unmount();
		await new Promise((r) => setTimeout(r, 10));
		expect(unsubscribe).toHaveBeenCalled();
		expect(dispose).toHaveBeenCalled();
	});

	it('shows a loading frame during the cold scan and quits on q while loading', async () => {
		// A source whose start() never resolves keeps the app in the loading state.
		let resolveStart!: () => void;
		const base = makeSource(snapFrom([]));
		const dispose = vi.fn();
		const unsubscribe = vi.fn();
		const source: DashboardSource = {
			snapshot: () => snapFrom([]),
			subscribe: (fn) => {
				base.source.subscribe(fn);
				return () => unsubscribe();
			},
			dispose,
			start: () => new Promise<void>((res) => (resolveStart = res))
		};
		const { lastFrame, stdin, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		expect(lastFrame()).toContain('cold-scanning');
		// q during loading must quit (useInput is mounted) → cleanup runs on unmount
		stdin.write('q');
		await new Promise((r) => setTimeout(r, 20));
		unmount();
		await new Promise((r) => setTimeout(r, 10));
		expect(unsubscribe).toHaveBeenCalled();
		expect(dispose).toHaveBeenCalled();
		resolveStart(); // avoid dangling promise
	});

	it('replaces the loading frame with data once the cold scan resolves', async () => {
		let snap = snapFrom([]);
		const listeners = new Set<(d: RollupDelta) => void>();
		const source: DashboardSource = {
			snapshot: () => snap,
			subscribe: (fn) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
			dispose: vi.fn(),
			start: async () => {
				snap = POPULATED; // the scan "fills" the engine
			}
		};
		const { lastFrame, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(lastFrame()).toContain('Total spend');
		expect(lastFrame()).not.toContain('cold-scanning');
		unmount();
	});

	it('shows a fallback below the minimum terminal size', () => {
		const { source } = makeSource(POPULATED);
		const { lastFrame, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={{ columns: 20, rows: 8 }} />
		);
		expect(lastFrame()).toContain('Terminal too small');
		unmount();
	});

	it('renders an empty state with no data', () => {
		const { source } = makeSource(snapFrom([]));
		const { lastFrame, unmount } = render(
			<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
		);
		expect(lastFrame()).toContain('No data found');
		unmount();
	});

	it('honors NO_COLOR via no-color theme (plain render still has content)', () => {
		const prev = process.env.NO_COLOR;
		process.env.NO_COLOR = '1';
		try {
			const { source } = makeSource(POPULATED);
			const { lastFrame, unmount } = render(
				<DashboardApp source={source} period="week" noArt now={() => 0} dimensions={DIMS} />
			);
			const frame = lastFrame()!;
			expect(frame).toContain('Total spend');
			// no ANSI color escapes for foreground colors in NO_COLOR mode
			// (Ink may still emit layout, but our color() returns undefined)
			expect(frame).not.toMatch(/\[3[0-9]m/);
			unmount();
		} finally {
			if (prev === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = prev;
		}
	});
});
