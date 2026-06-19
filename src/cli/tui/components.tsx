// Ink presentational components for the dashboard. Pure: they take already-derived
// data (from the shared view-model) and render. No engine/state access here.

import { Box, Text } from 'ink';
import type { BlockSummary } from '../../lib/types.js';
import type { ModelTotal, PeriodBucket, ProviderTotal, Totals } from '../../lib/core/aggregate.js';
import { totalTokens } from '../../lib/core/aggregate.js';
import { compactTokens, int, money, modelLabel, providerLabel } from '../../lib/format.js';
import {
	ACCENT,
	DIM,
	color,
	gaugeBar,
	modelColorName,
	providerColorName,
	sparkline
} from './theme.js';

/** A single labelled summary card. */
function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
	return (
		<Box flexDirection="column" borderStyle="round" borderColor={color(DIM)} paddingX={1} minWidth={18}>
			<Text color={color(DIM)}>{label}</Text>
			<Text color={color(accent)} bold>
				{value}
			</Text>
			{sub ? <Text color={color(DIM)}>{sub}</Text> : null}
		</Box>
	);
}

export function SummaryCards({ totals, topModel }: { totals: Totals; topModel: ModelTotal | null }) {
	const toks = totalTokens(totals.tokens);
	return (
		<Box gap={1} flexWrap="wrap">
			<Card label="Total spend" value={money(totals.cost)} sub={`${int(totals.requests)} requests`} accent={ACCENT} />
			<Card label="Total tokens" value={compactTokens(toks)} sub={`${compactTokens(totals.tokens.output)} output`} accent="cyan" />
			<Card
				label="Top model"
				value={topModel ? modelLabel(topModel.model) : '—'}
				sub={topModel ? `${money(topModel.cost)} · ${compactTokens(totalTokens(topModel.tokens))}` : ''}
				accent={topModel ? modelColorName(topModel.model) : DIM}
			/>
		</Box>
	);
}

export function ProviderBreakdown({ providers }: { providers: ProviderTotal[] }) {
	if (providers.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>By provider</Text>
			{providers.map((p) => {
				const toks = totalTokens(p.tokens);
				return (
					<Text key={p.provider}>
						<Text color={color(providerColorName(p.provider))}>{providerLabel(p.provider).padEnd(14)}</Text>
						<Text bold>{money(p.cost).padStart(10)}</Text>
						<Text color={color(DIM)}>{`  ${compactTokens(toks).padStart(7)} tok  ${int(p.requests).padStart(6)} req`}</Text>
					</Text>
				);
			})}
		</Box>
	);
}

export function ModelBreakdown({ models, topN }: { models: ModelTotal[]; topN: number }) {
	const top = models.slice(0, topN);
	if (top.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>{`By model (top ${top.length})`}</Text>
			{top.map((m) => {
				const toks = totalTokens(m.tokens);
				return (
					<Text key={m.model}>
						<Text color={color(modelColorName(m.model))}>{modelLabel(m.model).padEnd(16)}</Text>
						<Text bold>{money(m.cost).padStart(10)}</Text>
						<Text color={color(DIM)}>{`  ${compactTokens(toks).padStart(7)} tok  ${int(m.requests).padStart(6)} req`}</Text>
					</Text>
				);
			})}
		</Box>
	);
}

export function TrendSparkline({ buckets, periodLabel }: { buckets: PeriodBucket[]; periodLabel: string }) {
	const costs = buckets.map((b) => b.cost);
	const spark = sparkline(costs);
	const peak = costs.length > 0 ? Math.max(...costs) : 0;
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>{`Trend · ${periodLabel} (${buckets.length} buckets)`}</Text>
			{spark ? (
				<Text color={color(ACCENT)}>{spark}</Text>
			) : (
				<Text color={color(DIM)}>no data in scope</Text>
			)}
			{peak > 0 ? <Text color={color(DIM)}>{`peak ${money(peak)}`}</Text> : null}
		</Box>
	);
}

/**
 * The rolling 5h cap-proximity block. Shows elapsed/remaining within the window
 * plus the spend in that window. `now` is injectable for deterministic tests.
 */
export function CapBlock({ block, now }: { block: BlockSummary | null; now: number }) {
	if (!block) {
		return (
			<Box flexDirection="column">
				<Text color={color(DIM)}>5h window</Text>
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
	return (
		<Box flexDirection="column">
			<Text color={color(DIM)}>5h window (cap proximity)</Text>
			<Text color={color(ACCENT)} bold>
				{money(block.cost)}
			</Text>
			<Text color={color(DIM)}>{`${compactTokens(totalTokens(block.tokens))} tok · ${int(block.requests)} req`}</Text>
			<Text>
				<Text color={color(ACCENT)}>{gaugeBar(span > 0 ? elapsed / span : 0, 20)}</Text>
				<Text color={color(DIM)}>{`  ${fmtDur(elapsed)} in · ${fmtDur(remaining)} left`}</Text>
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

/** The keybindings hint footer. */
export function HelpFooter() {
	return (
		<Text color={color(DIM)}>
			{'d/w/m or ←/→ period · 1-9 toggle provider · 0 clear · q quit'}
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
