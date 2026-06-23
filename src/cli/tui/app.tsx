// Ink root component for the live dashboard. Holds UI state (period + provider
// filter), subscribes to a data source for deltas, and derives every view via the
// shared view-model (so it can never drift from the web app).
//
// The root takes an injected `DashboardSource` (snapshot + subscribe + dispose)
// rather than reaching for the real engine directly — that makes it testable with
// a fake source under ink-testing-library, and keeps the React tree free of disk IO.

import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { Period, RollupDelta, RollupSnapshot } from '../../lib/types.js';
import {
	defaultViewState,
	heroTotals,
	models,
	periodWindow,
	providers,
	scopedTotals,
	trend,
	type ViewState
} from '../../lib/core/view-model.js';
import { filterDays } from '../../lib/core/aggregate.js';
import { applyDelta } from '../../lib/core/merge.js';
import { cacheCostBreakdown } from '../../lib/core/pricing/cache-breakdown.js';
import { ACCENT, DIM, PERIOD_LABEL, bannerLine, color, scanningLine, emptyLine } from './theme.js';
import {
	CapBlock,
	HelpFooter,
	ModelBreakdown,
	ProviderBreakdown,
	ProviderFilterRow,
	SummaryCards,
	TooSmall,
	TrendSparkline
} from './components.js';

const MIN_COLUMNS = 40;
const MIN_ROWS = 12;
const TOP_MODELS = 6;

/** What the root needs to render + stay live. The real engine satisfies this. */
export interface DashboardSource {
	snapshot(): RollupSnapshot;
	subscribe(fn: (delta: RollupDelta) => void): () => void;
	dispose?(): void;
	/**
	 * Optional cold-scan kickoff. When present, the app mounts a loading state
	 * (keypresses already live, so `q` quits during the scan) and re-reads the
	 * snapshot once it resolves. Omitted by tests, which inject ready data.
	 */
	start?(): Promise<void>;
}

export interface DashboardAppProps {
	source: DashboardSource;
	/** initial period (defaults to week, matching the web default) */
	period?: Period;
	/** show the banner slot (wave 5 art) unless suppressed */
	noArt?: boolean;
	/** injectable clock for the 5h block (tests pin this) */
	now?: () => number;
	/** test seam: override the measured terminal size */
	dimensions?: { columns: number; rows: number };
}

export function DashboardApp({ source, period = 'week', noArt = false, now, dimensions }: DashboardAppProps) {
	const { exit } = useApp();

	// The snapshot is the source of truth; deltas merge into it. Held in state so a
	// delta (or the post-cold-scan re-read) triggers exactly one re-render.
	const [snapshot, setSnapshot] = useState<RollupSnapshot>(() => source.snapshot());

	// UI selection state. Period + provider filter survive deltas (separate state).
	const [view, setView] = useState<ViewState>(() => ({ ...defaultViewState(period) }));

	// Loading state while the cold scan runs (only when source.start is provided).
	const [loading, setLoading] = useState(() => typeof source.start === 'function');

	// Subscribe once; unsubscribe + dispose on unmount (clean lifecycle).
	useEffect(() => {
		const unsub = source.subscribe((delta) => setSnapshot((prev) => applyDelta(prev, delta)));
		return () => {
			unsub();
			source.dispose?.();
		};
	}, [source]);

	// Kick off the cold scan AFTER mount so keypresses (q/Ctrl-C) stay live during it.
	useEffect(() => {
		if (typeof source.start !== 'function') return;
		let cancelled = false;
		source
			.start()
			.catch(() => undefined)
			.finally(() => {
				if (cancelled) return;
				setSnapshot(source.snapshot()); // replace the initial (empty) snapshot
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [source]);

	// Tick once a minute so the 5h-window elapsed/remaining + active flag advance
	// even when no usage deltas arrive (finding: static clock never updated).
	const [, forceTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => forceTick((n) => n + 1), 60_000);
		if (typeof t.unref === 'function') t.unref();
		return () => clearInterval(t);
	}, []);

	const providerList = useMemo(() => providers(snapshot, view), [snapshot, view]);

	useInput((input, key) => {
		if (input === 'q' || (key.ctrl && input === 'c')) {
			exit();
			return;
		}
		if (input === 'd') setView((v) => ({ ...v, period: 'day' }));
		else if (input === 'w') setView((v) => ({ ...v, period: 'week' }));
		else if (input === 'm') setView((v) => ({ ...v, period: 'month' }));
		else if (input === 'Q') setView((v) => ({ ...v, period: 'quarter' }));
		else if (input === 'a') setView((v) => ({ ...v, period: 'all' }));
		else if (key.rightArrow) setView((v) => ({ ...v, period: nextPeriod(v.period, 1) }));
		else if (key.leftArrow) setView((v) => ({ ...v, period: nextPeriod(v.period, -1) }));
		else if (input === '0') setView((v) => ({ ...v, providerFilter: new Set() }));
		else if (/^[1-9]$/.test(input)) {
			const idx = Number(input) - 1;
			const provider = providerList[idx]?.provider;
			if (provider) {
				setView((v) => {
					const next = new Set(v.providerFilter);
					if (next.has(provider)) next.delete(provider);
					else next.add(provider);
					return { ...v, providerFilter: next };
				});
			}
		}
	});

	// Derived views (all via the shared view-model — same math the web app runs).
	const totals = useMemo(() => scopedTotals(snapshot, view), [snapshot, view]);
	const hero = useMemo(() => heroTotals(snapshot, view), [snapshot, view]);
	const modelTotals = useMemo(() => models(snapshot, view), [snapshot, view]);
	const buckets = useMemo(() => trend(snapshot, view), [snapshot, view]);
	const activeBlock = useMemo(() => snapshot.blocks.find((b) => b.isActive) ?? null, [snapshot]);

	// `you saved` — read-only cache savings (saved-vs-uncached) over the SAME period
	// window + provider filter the totals use, derived via the shared cache-breakdown
	// (every rate from the price table; no recompute of burn). Rendered only when > 0;
	// never a fabricated $0 (content rule: honest numbers).
	const savings = useMemo(() => {
		const w = periodWindow(snapshot, view);
		let grain = filterDays(snapshot.dayModel, w.from, w.to);
		if (view.providerFilter.size > 0) grain = grain.filter((dm) => view.providerFilter.has(dm.provider));
		return cacheCostBreakdown(grain).combined.savedVsUncached;
	}, [snapshot, view]);

	// useWindowSize re-renders on terminal resize (SIGWINCH) → the layout reflows.
	// Tests inject `dimensions` for determinism. A real terminal reports
	// columns/rows; some PTYs report 0 until the first SIGWINCH, so treat 0 as
	// "unknown" and assume a usable default rather than flashing the fallback.
	const measured = useWindowSize();
	const cols = dimensions?.columns ?? (measured.columns || 80);
	const rows = dimensions?.rows ?? (measured.rows || 24);
	const clock = now ?? (() => Date.now());

	const banner = bannerLine(noArt, cols);

	if (cols < MIN_COLUMNS || rows < MIN_ROWS) {
		return <TooSmall columns={cols} rows={rows} />;
	}

	// Loading frame during the cold scan. useInput is already mounted above, so
	// q/Ctrl-C quit while the scan runs (keypresses are not blocked).
	if (loading && snapshot.dayModel.length === 0) {
		const scanMsg = noArt ? 'cold-scanning transcripts… (q to quit)' : `${scanningLine()} (q to quit)`;
		return (
			<Box flexDirection="column" paddingX={1}>
				{banner ? (
					<Text color={color(ACCENT)} bold>
						{banner}
					</Text>
				) : null}
				<Text color={color(DIM)}>{` · ${scanMsg}`}</Text>
			</Box>
		);
	}

	const empty = snapshot.dayModel.length === 0;
	const scopeLabel =
		view.providerFilter.size > 0 ? ` · ${[...view.providerFilter].join(', ')}` : '';

	return (
		<Box flexDirection="column" paddingX={1}>
			{banner ? (
				<Text color={color(ACCENT)} bold>
					{banner}
				</Text>
			) : null}

			{/* Register-tape header rule: brand line + active period (mockup .head). */}
			<Box justifyContent="space-between">
				<Text color={color(DIM)}>
					<Text color={color(ACCENT)}>{'◆ '}</Text>
					{`it counts the cache hits too${scopeLabel}`}
				</Text>
				<Text color={color(DIM)}>{`${hero.label} ▾`}</Text>
			</Box>

			{empty ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={color('yellow')}>{noArt ? 'No data found.' : emptyLine()}</Text>
					<Text color={color(DIM)}>Run `chaching init` to configure providers and start tracking spend.</Text>
				</Box>
			) : (
				<>
					<Box marginTop={1}>
						<SummaryCards totals={totals} topModel={modelTotals[0] ?? null} savings={savings} />
					</Box>

					<Box marginTop={1}>
						<TrendSparkline buckets={buckets} periodLabel={PERIOD_LABEL[view.period]} />
					</Box>

					<Box marginTop={1} gap={3} flexWrap="wrap">
						<ProviderBreakdown providers={providerList} filter={view.providerFilter} />
						<ModelBreakdown models={modelTotals} topN={TOP_MODELS} />
					</Box>

					<Box marginTop={1}>
						<CapBlock block={activeBlock} now={clock()} noArt={noArt} />
					</Box>

					<Box marginTop={1}>
						<ProviderFilterRow providers={providerList} active={view.providerFilter} />
					</Box>
				</>
			)}

			<Box marginTop={1}>
				<HelpFooter />
			</Box>
		</Box>
	);
}

function nextPeriod(p: Period, dir: 1 | -1): Period {
	const order: Period[] = ['day', 'week', 'month', 'quarter', 'all'];
	const i = order.indexOf(p);
	const next = (i + dir + order.length) % order.length;
	return order[next];
}
