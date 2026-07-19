// Pooled read path. The engine keeps its LOCAL rollup exactly as in solo mode (local-first:
// local history + live scan + local freezing). Peer machines' spend arrives as pre-aggregated
// ledger rows, held here as an overlay and merged onto the local snapshot at read time. Local
// and peer rows never share a key — own `machine:<id>` rows are excluded from the peer read and
// cursor-admin spend is rendered ONLY from the (account-scoped) overlay — so the merge is a
// disjoint concatenation with no double-count. Subscription attribution is a final read-time
// join, so a remap is just a mapping change (no re-scan).

import type {
	BlockSummary,
	CoverageMap,
	DayModelAgg,
	RollupSnapshot,
	SessionSummary,
	TokenCounts
} from '../../types';
import { Rollup } from '../rollup/rollup';
import type { PeerDayAgg, PeerHourAgg, PeerSession } from './store';
import type { SyncMapping } from './types';

const KEY_SEP = '';

function mappingKey(machineId: string, provider: string): string {
	return `${machineId}${KEY_SEP}${provider}`;
}

/** Resolve subscription attribution at read time from the pool's mapping rows. */
export interface SubscriptionIndex {
	byMachineProvider: Map<string, string | null>;
	ownMachineId: string;
	/** Pool-level cursor attribution for account-scoped (machineId-less) cursor rows. */
	cursor: string | null;
}

/**
 * Build the read-time attribution index. Machine rows resolve by (machineId, provider);
 * account-scoped cursor rows resolve via a pool-level cursor mapping — the current machine's
 * cursor mapping when it has one, else the lexicographically-first machine's cursor mapping so
 * every machine renders the same value (all machines share one Cursor account).
 */
export function buildSubscriptionIndex(mappings: readonly SyncMapping[], ownMachineId: string): SubscriptionIndex {
	const byMachineProvider = new Map<string, string | null>();
	let ownCursor: string | null | undefined;
	let peerCursor: string | null = null;
	for (const mapping of mappings) {
		byMachineProvider.set(mappingKey(mapping.machineId, mapping.provider), mapping.subscriptionId);
		if (mapping.provider === 'cursor') {
			if (mapping.machineId === ownMachineId) ownCursor = mapping.subscriptionId;
			// First peer (mappings arrive machine-id ordered) with a REAL mapping. An own
			// explicit-null mapping must not suppress this, so peer attribution is the fallback
			// whenever this machine has no non-null cursor mapping of its own (C11).
			else if (mapping.subscriptionId != null && peerCursor == null) peerCursor = mapping.subscriptionId;
		}
	}
	// Prefer this machine's own non-null cursor mapping; else any peer's non-null mapping; else
	// null. `ownCursor != null` covers both "no own mapping" (undefined) and "own explicit null".
	return {
		byMachineProvider,
		ownMachineId,
		cursor: ownCursor != null ? ownCursor : peerCursor
	};
}

/**
 * Build the peer contribution snapshot from the current overlay maps. Reuses the tested
 * Rollup: day aggregates + sessions merge normally, hour aggregates feed the block
 * accumulator so pooled 5h-cap windows include peers. Coverage is derived by the caller.
 */
export function peerContribution(
	dayAggregates: Iterable<PeerDayAgg>,
	hourAggregates: readonly PeerHourAgg[],
	sessions: Iterable<PeerSession>,
	now: number
): RollupSnapshot {
	const rollup = new Rollup();
	rollup.loadAggregates([...dayAggregates], [...sessions]);
	rollup.loadHourAggregates(hourAggregates);
	return rollup.snapshot(now);
}

function zeroTokens(): TokenCounts {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function addInto(into: TokenCounts, from: TokenCounts): void {
	into.input += from.input;
	into.output += from.output;
	into.cacheCreation += from.cacheCreation;
	into.cacheRead += from.cacheRead;
}

function minDay(a: string | null, b: string | null): string | null {
	if (a == null) return b;
	if (b == null) return a;
	return a < b ? a : b;
}

function maxDay(a: string | null, b: string | null): string | null {
	if (a == null) return b;
	if (b == null) return a;
	return a > b ? a : b;
}

function mergeBlocks(local: BlockSummary[], peer: BlockSummary[], now: number): BlockSummary[] {
	const byStart = new Map<number, BlockSummary>();
	for (const block of [...local, ...peer]) {
		const existing = byStart.get(block.startTs);
		if (!existing) {
			byStart.set(block.startTs, {
				startTs: block.startTs,
				endTs: block.endTs,
				tokens: { ...block.tokens },
				requests: block.requests,
				cost: block.cost,
				isActive: now < block.endTs
			});
			continue;
		}
		addInto(existing.tokens, block.tokens);
		existing.requests += block.requests;
		existing.cost += block.cost;
	}
	return [...byStart.values()].sort((a, b) => b.startTs - a.startTs);
}

/**
 * Merge the LOCAL snapshot with the PEER contribution. Day-model and session keys are
 * disjoint across the two (own rows excluded from the peer read; cursor rendered only from
 * the overlay), so their rows concatenate; totals/blocks/stats sum; coverage folds peer
 * authoritative days in as `frozen` (or `partial` for today).
 */
export function mergePooledSnapshot(
	local: RollupSnapshot,
	peer: RollupSnapshot,
	today: string,
	peerPartialDays: ReadonlySet<string> = new Set()
): RollupSnapshot {
	const dayModel = [...local.dayModel, ...peer.dayModel];
	const sessions = [...local.sessions, ...peer.sessions].sort((a, b) => b.lastTs - a.lastTs);

	const totals = {
		tokens: (() => {
			const t = zeroTokens();
			addInto(t, local.totals.tokens);
			addInto(t, peer.totals.tokens);
			return t;
		})(),
		requests: local.totals.requests + peer.totals.requests,
		cost: local.totals.cost + peer.totals.cost,
		costUnknownRequests: local.totals.costUnknownRequests + peer.totals.costUnknownRequests
	};

	const modelCost = new Map<string, number>();
	const providerCost = new Map<string, number>();
	for (const dm of dayModel) {
		modelCost.set(dm.model, (modelCost.get(dm.model) ?? 0) + dm.cost);
		providerCost.set(dm.provider, (providerCost.get(dm.provider) ?? 0) + dm.cost);
	}
	const models = [...modelCost.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
	const providers = [...providerCost.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);

	// Peer days are authoritative for their machine UNLESS that machine flagged the day partial
	// (its own local scan was incomplete): an incomplete peer day must render `partial`, never
	// `frozen`, so the pool doesn't present an undercount as authoritative (C8). A partial peer
	// day even downgrades a local `frozen` opinion, because the pooled total for that day is
	// still incomplete.
	const coverage: CoverageMap = { ...local.coverage };
	for (const dm of peer.dayModel) {
		if (dm.day === today) {
			coverage[dm.day] = 'partial';
		} else if (dm.requests > 0) {
			if (peerPartialDays.has(dm.day)) coverage[dm.day] = 'partial';
			else if (coverage[dm.day] !== 'partial') coverage[dm.day] = 'frozen';
		} else if (!coverage[dm.day]) {
			coverage[dm.day] = 'zero';
		}
	}

	return {
		generatedAt: local.generatedAt,
		earliestDay: minDay(local.earliestDay, peer.earliestDay),
		latestDay: maxDay(local.latestDay, peer.latestDay),
		totals,
		dayModel,
		sessions,
		blocks: mergeBlocks(local.blocks, peer.blocks, local.generatedAt),
		models,
		providers,
		unknownPriceModels: [...new Set([...local.unknownPriceModels, ...peer.unknownPriceModels])],
		stats: {
			filesScanned: local.stats.filesScanned + peer.stats.filesScanned,
			recordsCounted: local.stats.recordsCounted + peer.stats.recordsCounted,
			linesSkipped: local.stats.linesSkipped + peer.stats.linesSkipped,
			duplicatesSkipped: local.stats.duplicatesSkipped + peer.stats.duplicatesSkipped
		},
		cutoverTs: local.cutoverTs,
		coverage
	};
}

function resolve(index: SubscriptionIndex, machineId: string | undefined, provider: string): string | null {
	if (machineId == null) {
		if (provider === 'cursor') return index.cursor; // account-scoped cursor row
		// Frozen/local history written before this machine joined a pool has no machine id.
		// It is still this machine's local contribution, so attribute it through the own mapping.
		return index.byMachineProvider.get(mappingKey(index.ownMachineId, provider)) ?? null;
	}
	return index.byMachineProvider.get(mappingKey(machineId, provider)) ?? null;
}

/**
 * Read-time subscription join over the merged snapshot: stamp `subscriptionId` onto every
 * day-model and session row from the mapping index. Runs last so a remap needs only a fresh
 * index, never a re-scan or re-load.
 */
export function attachSubscriptions(snap: RollupSnapshot, index: SubscriptionIndex): RollupSnapshot {
	const dayModel: DayModelAgg[] = snap.dayModel.map((dm) => ({
		...dm,
		subscriptionId: resolve(index, dm.machineId, dm.provider)
	}));
	const sessions: SessionSummary[] = snap.sessions.map((s) => ({
		...s,
		subscriptionId: resolve(index, s.machineId, s.provider)
	}));
	return { ...snap, dayModel, sessions };
}
