// Pure snapshot+delta merge. The engine emits a snapshot then incremental deltas;
// this folds a delta into a snapshot to produce the next snapshot, keyed by
// (day,provider,model) for the grain and (provider,sessionId) for sessions.
//
// The web feed store keeps stateful Maps for the same merge (idle-CPU tuned for a
// long-lived browser tab); the TUI uses this pure function via useReducer. Both
// produce the same merged shape — this is the framework-free reference.

import type { DayModelAgg, RollupDelta, RollupSnapshot, SessionSummary } from '../types';

const KEY_SEP = '';

function dayModelKey(dm: DayModelAgg): string {
	return `${dm.machineId ?? ''}${KEY_SEP}${dm.subscriptionId ?? ''}${KEY_SEP}${dm.day}${KEY_SEP}${dm.provider}${KEY_SEP}${dm.model}`;
}

function sessionKey(s: SessionSummary): string {
	return `${s.machineId ?? ''}${KEY_SEP}${s.subscriptionId ?? ''}${KEY_SEP}${s.provider}${KEY_SEP}${s.sessionId}`;
}

/** Fold a delta into a snapshot, returning a new snapshot (inputs untouched). */
export function applyDelta(prev: RollupSnapshot, delta: RollupDelta): RollupSnapshot {
	if (delta.replace) return delta.replace;
	const dayModel = new Map<string, DayModelAgg>();
	for (const dm of prev.dayModel) dayModel.set(dayModelKey(dm), dm);
	for (const dm of delta.dayModel) dayModel.set(dayModelKey(dm), dm);

	const sessions = new Map<string, SessionSummary>();
	for (const s of prev.sessions) sessions.set(sessionKey(s), s);
	for (const s of delta.sessions) sessions.set(sessionKey(s), s);

	return {
		...prev,
		generatedAt: delta.generatedAt,
		totals: delta.totals,
		earliestDay: delta.earliestDay,
		latestDay: delta.latestDay,
		models: delta.models,
		providers: delta.providers,
		unknownPriceModels: delta.unknownPriceModels,
		stats: delta.stats,
		dayModel: [...dayModel.values()],
		sessions: [...sessions.values()].sort((a, b) => b.lastTs - a.lastTs),
		blocks: delta.blocks,
		// Full replace: coverage is recomputed by the engine each delta (range-relative, not
		// mergeable), so the freshly-shipped map supersedes the prior snapshot's wholesale —
		// today flips missing->partial on its first row, a frozen-mid-run day flips to frozen.
		coverage: delta.coverage
	};
}
