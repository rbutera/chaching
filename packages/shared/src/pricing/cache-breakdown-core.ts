// Cache economics use retained monetary components; present-day rates cannot explain history.

import type { DayModelAgg } from '../types';

/** Billed cache economics for one slice (a provider, or the combined roll-up). */
export interface CacheCostBreakdown {
	cacheReadTokens: number;
	cacheReadCost: number | null;
	cacheWriteTokens: number;
	cacheWriteCost: number | null;
	savedVsUncached: number | null;
	unknownTokens: number;
}

export interface CacheCostBreakdownResult {
	combined: CacheCostBreakdown;
	byProvider: Map<string, CacheCostBreakdown>;
}

function zero(): CacheCostBreakdown {
	return {
		cacheReadTokens: 0,
		cacheReadCost: 0,
		cacheWriteTokens: 0,
		cacheWriteCost: 0,
		savedVsUncached: 0,
		unknownTokens: 0
	};
}

function addRow(into: CacheCostBreakdown, dm: DayModelAgg): void {
	const read = dm.tokens.cacheRead;
	const write = dm.tokens.cacheCreation;
	into.cacheReadTokens += read;
	into.cacheWriteTokens += write;

	const money = dm.monetary;
	if (!money) {
		into.unknownTokens += read + write;
		if (read > 0) into.cacheReadCost = into.savedVsUncached = null;
		if (write > 0) into.cacheWriteCost = null;
		return;
	}
	if (into.cacheReadCost !== null) into.cacheReadCost += money.cacheRead;
	if (into.cacheWriteCost !== null) into.cacheWriteCost += money.cacheCreation;
	if (into.savedVsUncached !== null && read > 0) {
		if (money.cacheReadUncached === undefined) into.savedVsUncached = null;
		else into.savedVsUncached += money.cacheReadUncached - money.cacheRead;
	}
}

/** Sum retained cache economics over the filtered grain. */
export function cacheCostBreakdownWith(
	grain: DayModelAgg[]
): CacheCostBreakdownResult {
	const combined = zero();
	const byProvider = new Map<string, CacheCostBreakdown>();
	for (const dm of grain) {
		addRow(combined, dm);
		let p = byProvider.get(dm.provider);
		if (!p) {
			p = zero();
			byProvider.set(dm.provider, p);
		}
		addRow(p, dm);
	}
	return { combined, byProvider };
}
