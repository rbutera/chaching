// Ink presentational components for the dashboard. Pure: they take already-derived
// data (from the shared view-model) and render. No engine/state access here.
//
// Styled to the canonical terminal mockup (ui_kits/terminal/): a register total
// with `you saved` in green, `●`-dotted by-provider/by-model columns, a token-
// accent sparkline with a peak readout, a 5h-block gauge carrying the spend-tier-
// colored escalation flourish, and a compact keybar. Every color routes through
// the shared token ANSI map via theme.ts; `color()` strips it under NO_COLOR.

import { Box, Text } from 'ink';
import type { BlockSummary } from '../../lib/types.js';
import type { ModelTotal, PeriodBucket, ProviderTotal, Totals } from '../../lib/core/aggregate.js';
import { totalTokens } from '../../lib/core/aggregate.js';
import type { ProjectTotal } from '../../lib/core/view-model.js';
import { compactTokens, int, money, modelLabel, providerLabel } from '../../lib/format.js';
import {
	ACCENT,
	DIM,
	GOOD,
	color,
	gaugeBar,
	modelColorName,
	providerColorName,
	sparkline,
	spendLadderColor,
	ladderColorFor,
	flourishFor,
	formatFlourishText,
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
} from './theme.js';

/**
 * The hero register total + `you saved`. The total is the biggest element on the
 * surface: `$` + the tabular money figure in accent-bold, with a `TOTAL BURN`
 * uppercase micro-label beneath. `you saved −$…` renders in the token `good`
 * (green) hue ONLY when a savings figure is present (savings > 0) — never a
 * fabricated `$0` (content rule: numbers are honest). The top model sits to the
 * right in its categorical hue.
 */
export function SummaryCards({
	totals,
	topModel,
	savings,
	lifetimeCost,
	displayCost,
	noArt = false
}: {
	totals: Totals;
	topModel: ModelTotal | null;
	/** read-only cache savings (saved-vs-uncached) for the scope, or 0/undefined when absent */
	savings?: number;
	/** all-time lifetime spend (snapshot.totals.cost) — drives the lifetime ladder */
	lifetimeCost?: number;
	/** the (possibly mid-roll-up) figure to SHOW for the register total; defaults to the real total */
	displayCost?: number;
	/** suppress the escalation flourishes (delight off) */
	noArt?: boolean;
}) {
	const toks = totalTokens(totals.tokens);
	const showSaved = typeof savings === 'number' && savings > 0;
	const shownCost = displayCost ?? totals.cost;
	// Escalation flourish on the register total (the affectionate daily ladder),
	// voiced from the shared module + colored along the spend ladder. Keyed to the
	// REAL total (tier is a function of the settled amount, not the mid-roll-up
	// frame). `--no-art` strips it; the zero tier renders nothing.
	const dailyTier = flourishFor(totals.cost, DAILY_FLOURISHES);
	const dailyFlourish = !noArt ? formatFlourishText(dailyTier) : '';
	// Lifetime ladder figure — only when there's a lifetime total worth a remark.
	const lifeTier = lifetimeCost != null ? flourishFor(lifetimeCost, LIFETIME_FLOURISHES) : null;
	const lifeFlourish = !noArt && lifeTier ? formatFlourishText(lifeTier) : '';
	return (
		<Box flexWrap="wrap" gap={4}>
			{/* register total */}
			<Box flexDirection="column">
				<Text>
					<Text color={color(DIM)}>$</Text>
					<Text color={color(ACCENT)} bold>
						{money(shownCost).replace(/^\$/, '')}
					</Text>
					{dailyFlourish ? (
						<Text color={ladderColorFor(totals.cost, DAILY_FLOURISHES)}>{`  ${dailyFlourish}`}</Text>
					) : null}
				</Text>
				<Text color={color(DIM)}>TOTAL BURN</Text>
			</Box>

			{/* lifetime — the long-haul ladder (only when present + non-zero tier) */}
			{lifetimeCost != null ? (
				<Box flexDirection="column">
					<Text>
						<Text color={color(DIM)}>$</Text>
						<Text bold>{money(lifetimeCost).replace(/^\$/, '')}</Text>
						{lifeFlourish ? (
							<Text color={ladderColorFor(lifetimeCost, LIFETIME_FLOURISHES)}>{`  ${lifeFlourish}`}</Text>
						) : null}
					</Text>
					<Text color={color(DIM)}>LIFETIME</Text>
				</Box>
			) : null}

			{/* tokens */}
			<Box flexDirection="column">
				<Text>{compactTokens(toks)}</Text>
				<Text color={color(DIM)}>TOKENS</Text>
			</Box>

			{/* you saved — only when present (no fabricated $0) */}
			{showSaved ? (
				<Box flexDirection="column">
					<Text color={color(GOOD)}>{`−${money(savings!)}`}</Text>
					<Text color={color(DIM)}>YOU SAVED</Text>
				</Box>
			) : null}

			{/* top model */}
			<Box flexDirection="column">
				<Text color={color(topModel ? modelColorName(topModel.model) : DIM)}>
					{topModel ? modelLabel(topModel.model) : '—'}
				</Text>
				<Text color={color(DIM)}>{topModel ? `TOP MODEL · ${money(topModel.cost)}` : 'TOP MODEL'}</Text>
			</Box>
		</Box>
	);
}

/** One `●`-led breakdown row: dot in the row's categorical hue, name, right-aligned money, dim tok/req. */
function BreakdownRow({
	colorHex,
	name,
	cost,
	tokens,
	requests,
	off = false
}: {
	colorHex: string;
	name: string;
	cost: number;
	tokens: number;
	requests: number;
	off?: boolean;
}) {
	return (
		<Text dimColor={off}>
			<Text color={color(colorHex)}>{'● '}</Text>
			<Text>{name.padEnd(16)}</Text>
			<Text bold>{money(cost).padStart(10)}</Text>
			<Text color={color(DIM)}>{`  ${compactTokens(tokens).padStart(7)} tok  ${int(requests).padStart(6)} req`}</Text>
		</Text>
	);
}

export function ProviderBreakdown({
	providers,
	filter
}: {
	providers: ProviderTotal[];
	/** active provider filter; a provider not in a non-empty set renders dimmed (mockup .line.off) */
	filter?: Set<string>;
}) {
	if (providers.length === 0) return null;
	const allActive = !filter || filter.size === 0;
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>BY PROVIDER</Text>
			{providers.map((p) => (
				<BreakdownRow
					key={p.provider}
					colorHex={providerColorName(p.provider)}
					name={providerLabel(p.provider)}
					cost={p.cost}
					tokens={totalTokens(p.tokens)}
					requests={p.requests}
					off={!(allActive || filter!.has(p.provider))}
				/>
			))}
		</Box>
	);
}

export function ModelBreakdown({ models, topN }: { models: ModelTotal[]; topN: number }) {
	const top = models.slice(0, topN);
	if (top.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>{`BY MODEL (top ${top.length})`}</Text>
			{top.map((m) => (
				<BreakdownRow
					key={m.model}
					colorHex={modelColorName(m.model)}
					name={modelLabel(m.model)}
					cost={m.cost}
					tokens={totalTokens(m.tokens)}
					requests={m.requests}
				/>
			))}
		</Box>
	);
}

/**
 * The `by project` breakdown — same `●`-led shape as ModelBreakdown, showing which
 * repo/client is eating the money (glow-up idea #1). Top N by cost; the dot takes the
 * project's top-provider hue. Session count sits where requests do in the sibling
 * sections, since "how many sessions" is the meaningful project figure.
 */
export function ProjectBreakdown({ projects, topN }: { projects: ProjectTotal[]; topN: number }) {
	const top = projects.slice(0, topN);
	if (top.length === 0) return null;
	const more = Math.max(0, projects.length - top.length);
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>{`BY PROJECT (top ${top.length})`}</Text>
			{top.map((p) => (
				<Text key={p.project === '' ? '(unknown)' : p.project} dimColor={p.isUnknown}>
					<Text color={color(p.isUnknown ? DIM : providerColorName(p.providers[0] ?? ''))}>{'● '}</Text>
					<Text>{p.display.padEnd(16)}</Text>
					<Text bold>{money(p.cost).padStart(10)}</Text>
					<Text color={color(DIM)}>{`  ${compactTokens(totalTokens(p.tokens)).padStart(7)} tok  ${int(p.sessionCount).padStart(4)} sess`}</Text>
				</Text>
			))}
			{more > 0 ? <Text color={color(DIM)}>{`  +${more} more`}</Text> : null}
		</Box>
	);
}

export function TrendSparkline({ buckets, periodLabel }: { buckets: PeriodBucket[]; periodLabel: string }) {
	const costs = buckets.map((b) => b.cost);
	const spark = sparkline(costs);
	const peak = costs.length > 0 ? Math.max(...costs) : 0;
	return (
		<Box>
			<Text color={color(DIM)}>{`trend  `}</Text>
			{spark ? (
				<Text color={color(ACCENT)}>{spark}</Text>
			) : (
				<Text color={color(DIM)}>no data in scope</Text>
			)}
			{peak > 0 ? <Text color={color(DIM)}>{`  peak ${money(peak)}`}</Text> : null}
			<Text color={color(DIM)}>{`  · ${periodLabel}`}</Text>
		</Box>
	);
}

/** Two-digit HH:MM in the user's LOCAL timezone for a block close time. */
function hhmm(ts: number): string {
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The rolling 5h cap-proximity block. Gauge (token-accent fill, dim track), the
 * block spend, and the escalation flourish colored along the spend ladder. The
 * meta line carries elapsed/remaining + the close time (mockup framing). `now` is
 * injectable for deterministic tests. `noArt` suppresses the flourish.
 */
export function CapBlock({ block, now, noArt = false }: { block: BlockSummary | null; now: number; noArt?: boolean }) {
	if (!block) {
		return (
			<Box flexDirection="column">
				<Text color={color(DIM)}>5h block</Text>
				<Text color={color(DIM)}>no active window</Text>
			</Box>
		);
	}
	const span = block.endTs - block.startTs;
	const elapsed = Math.max(0, Math.min(span, now - block.startTs));
	const remaining = Math.max(0, block.endTs - now);
	const mins = (ms: number) => Math.round(ms / 60000);
	const fmtDur = (ms: number) => {
		const m = mins(ms);
		return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
	};
	// Compose the flourish as PLAIN text (emoji + remark) so Ink owns the color —
	// the spend-ladder hue, not the flat dim that formatFlourish would bake in.
	// `--no-art` strips it entirely (the noArt guard), as does the zero tier.
	const tier = flourishFor(block.cost, BLOCK_FLOURISHES);
	const flourish = !noArt ? [tier.emoji, tier.remark].filter(Boolean).join(' ') : '';
	return (
		<Box flexDirection="column">
			<Text>
				<Text color={color(ACCENT)}>{gaugeBar(span > 0 ? elapsed / span : 0, 20)}</Text>
				<Text color={color(ACCENT)} bold>
					{`  ${money(block.cost)}`}
				</Text>
				{flourish ? <Text color={spendLadderColor(block.cost)}>{`  ${flourish}`}</Text> : null}
			</Text>
			<Text color={color(DIM)}>
				{`5h block · ${fmtDur(elapsed)} in · ${fmtDur(remaining)} left · closes ${hhmm(block.endTs)}`}
			</Text>
		</Box>
	);
}

/**
 * Provider filter row: shows every provider with active/inactive state. Empty
 * filter set = all active. Number keys 1..N toggle them (handled in the root).
 */
export function ProviderFilterRow({
	providers,
	active
}: {
	providers: ProviderTotal[];
	active: Set<string>;
}) {
	if (providers.length <= 1) return null;
	const allActive = active.size === 0;
	return (
		<Box flexWrap="wrap" gap={1}>
			<Text color={color(DIM)}>Filter:</Text>
			{providers.map((p, i) => {
				const on = allActive || active.has(p.provider);
				return (
					<Text key={p.provider}>
						<Text color={color(DIM)}>{`[${i + 1}]`}</Text>
						<Text color={on ? color(providerColorName(p.provider)) : color(DIM)} dimColor={!on} bold={on}>
							{` ${providerLabel(p.provider)}`}
						</Text>
						<Text color={color(on ? providerColorName(p.provider) : DIM)}>{on ? ' ●' : ' ○'}</Text>
					</Text>
				);
			})}
			{!allActive ? <Text color={color(DIM)}>(0 = clear)</Text> : null}
		</Box>
	);
}

/**
 * The compact keybar (mockup form): period keys `d w m Q a`, provider toggles
 * `1-9`, clear `0`, quit `q`. Key glyphs in the accent, labels in dim. Surfaces
 * `Q` (quarter) and `a` (all) which the old footer omitted (a real discoverability
 * fix — the keys already work in the root).
 */
export function HelpFooter() {
	const Key = ({ children }: { children: string }) => (
		<Text color={color(ACCENT)} bold>
			{children}
		</Text>
	);
	return (
		<Text color={color(DIM)}>
			<Key>d w m Q a</Key>
			<Text>{' period · '}</Text>
			<Key>1-9</Key>
			<Text>{' toggle provider · '}</Text>
			<Key>0</Key>
			<Text>{' clear · '}</Text>
			<Key>q</Key>
			<Text>{' quit'}</Text>
		</Text>
	);
}

/** Below-min-size fallback (Requirement: too-small terminal). */
export function TooSmall({ columns, rows }: { columns: number; rows: number }) {
	return (
		<Box flexDirection="column">
			<Text color={color('yellow')}>Terminal too small</Text>
			<Text color={color(DIM)}>{`${columns}×${rows} — need at least 40×12. Resize or run \`chaching stats\`.`}</Text>
		</Box>
	);
}
