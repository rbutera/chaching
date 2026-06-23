// Client-side live feed store (Svelte 5 runes). Connects to /api/feed (SSE),
// merges snapshot + deltas into reactive $state, and PAUSES via the Page
// Visibility API when the tab is hidden — the biggest idle-CPU win for an
// always-open 2nd-monitor tab.

import type {
	BlockSummary,
	DayModelAgg,
	RollupDelta,
	RollupSnapshot,
	SessionSummary,
	SSEMessage
} from '$lib/types';

const KEY_SEP = '\u001f';

export type ConnState = 'connecting' | 'live' | 'paused' | 'error';

export class FeedStore {
	snapshot = $state<RollupSnapshot | null>(null);
	conn = $state<ConnState>('connecting');
	lastUpdate = $state<number>(0);

	private es: EventSource | null = null;
	private dayModelIndex = new Map<string, DayModelAgg>();
	private sessionIndex = new Map<string, SessionSummary>();
	private visHandler: (() => void) | null = null;
	private started = false;

	start(): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.visHandler = () => this.onVisibility();
		document.addEventListener('visibilitychange', this.visHandler);
		if (document.visibilityState === 'visible') this.connect();
		else this.conn = 'paused';
	}

	stop(): void {
		this.disconnect();
		if (this.visHandler) document.removeEventListener('visibilitychange', this.visHandler);
		this.visHandler = null;
		this.started = false;
	}

	private onVisibility(): void {
		if (document.visibilityState === 'visible') {
			if (!this.es) this.connect();
		} else {
			// suspend the subscription so an idle tab burns no cycles
			this.disconnect();
			this.conn = 'paused';
		}
	}

	private connect(): void {
		this.conn = this.snapshot ? 'connecting' : 'connecting';
		try {
			this.es = new EventSource('/api/feed');
		} catch {
			this.conn = 'error';
			return;
		}
		this.es.onmessage = (ev) => {
			let msg: SSEMessage;
			try {
				msg = JSON.parse(ev.data) as SSEMessage;
			} catch {
				return;
			}
			if (msg.type === 'snapshot') this.applySnapshot(msg.data);
			else if (msg.type === 'delta') this.applyDelta(msg.data);
			this.conn = 'live';
			this.lastUpdate = Date.now();
		};
		this.es.onerror = () => {
			// EventSource auto-reconnects; surface a soft error state meanwhile
			if (document.visibilityState === 'visible') this.conn = 'error';
		};
	}

	private disconnect(): void {
		if (this.es) {
			this.es.close();
			this.es = null;
		}
	}

	private applySnapshot(snap: RollupSnapshot): void {
		this.dayModelIndex.clear();
		this.sessionIndex.clear();
		for (const dm of snap.dayModel) this.dayModelIndex.set(dayModelKey(dm), dm);
		for (const s of snap.sessions) this.sessionIndex.set(sessionKey(s), s);
		this.snapshot = snap;
	}

	private applyDelta(delta: RollupDelta): void {
		if (!this.snapshot) return;
		for (const dm of delta.dayModel) this.dayModelIndex.set(dayModelKey(dm), dm);
		for (const s of delta.sessions) this.sessionIndex.set(sessionKey(s), s);

		const blocks: BlockSummary[] = delta.blocks;
		// reassign a fresh snapshot object so $state/$derived consumers re-run
		this.snapshot = {
			...this.snapshot,
			generatedAt: delta.generatedAt,
			totals: delta.totals,
			earliestDay: delta.earliestDay,
			latestDay: delta.latestDay,
			models: delta.models,
			providers: delta.providers,
			unknownPriceModels: delta.unknownPriceModels,
			stats: delta.stats,
			dayModel: [...this.dayModelIndex.values()],
			sessions: [...this.sessionIndex.values()].sort((a, b) => b.lastTs - a.lastTs),
			blocks,
			// full replace: the engine recomputes coverage each delta (range-relative, not
			// mergeable), so the fresh map keeps the dashboard's provenance live (today flips
			// missing->partial; a frozen-mid-run day flips partial->frozen).
			coverage: delta.coverage
		};
	}
}

function dayModelKey(dm: DayModelAgg): string {
	return `${dm.day}${KEY_SEP}${dm.provider}${KEY_SEP}${dm.model}`;
}

function sessionKey(session: SessionSummary): string {
	return `${session.provider}${KEY_SEP}${session.sessionId}`;
}
