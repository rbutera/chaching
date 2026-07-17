import type { BlockSummary, TokenCounts, UsageRecord } from '../../types';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

function zeroTokens(): TokenCounts {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function addTokens(into: TokenCounts, from: TokenCounts): void {
	into.input += from.input;
	into.output += from.output;
	into.cacheCreation += from.cacheCreation;
	into.cacheRead += from.cacheRead;
}

export class BlockAccumulator {
	private blocks = new Map<number, BlockSummary>();

	add(rec: UsageRecord): void {
		const start = Math.floor(rec.timestamp / FIVE_HOURS_MS) * FIVE_HOURS_MS;
		let b = this.blocks.get(start);
		if (!b) {
			b = {
				startTs: start,
				endTs: start + FIVE_HOURS_MS,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				isActive: false
			};
			this.blocks.set(start, b);
		}
		addTokens(b.tokens, rec.tokens);
		b.requests++;
		b.cost += rec.cost ?? 0;
	}

	/**
	 * Add a pre-aggregated hour bucket (pooled peer overlay). Same 5-hour windowing as
	 * `add()` but folds in a whole hour's tokens/cost/requests at once, anchored at the
	 * bucket's hour timestamp (hour grain, coarser than per-record — a pooled trade-off).
	 */
	addBucket(hourTs: number, tokens: TokenCounts, cost: number, requests: number): void {
		const start = Math.floor(hourTs / FIVE_HOURS_MS) * FIVE_HOURS_MS;
		let b = this.blocks.get(start);
		if (!b) {
			b = {
				startTs: start,
				endTs: start + FIVE_HOURS_MS,
				tokens: zeroTokens(),
				requests: 0,
				cost: 0,
				isActive: false
			};
			this.blocks.set(start, b);
		}
		addTokens(b.tokens, tokens);
		b.requests += requests;
		b.cost += cost;
	}

	snapshot(now: number): BlockSummary[] {
		return [...this.blocks.values()]
			.map((b) => ({ ...b, tokens: { ...b.tokens }, isActive: now < b.endTs }))
			.sort((a, b) => b.startTs - a.startTs);
	}
}
