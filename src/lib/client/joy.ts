/**
 * Opt-in "Cha-Ching Moment" joy controller — DEFAULT OFF.
 *
 * Owns the persisted joy settings (`{ enabled: false, muted: false }` in
 * localStorage), the chime on escalation-threshold crossings, and the confetti
 * burst on lifetime milestone crossings. Everything is gated THREE ways before a
 * sound or a burst ever fires (design D8):
 *   1. joy enabled + not muted (chime); enabled (confetti)
 *   2. `document.visibilityState === 'visible'`  (Page-Visibility-aware)
 *   3. rate-limited (one chime per crossing, debounced; confetti hard-capped)
 * Confetti additionally respects `prefers-reduced-motion` (no burst when reduced).
 *
 * The audio + confetti helpers are DYNAMICALLY IMPORTED only on the fire path, so
 * the default build ships nothing eager and NO `AudioContext` is created unless
 * joy is enabled and a crossing actually fires. Crossing detection (the
 * `crossedUp` predicate) lives with the caller; this controller only fires when
 * told a crossing happened, and never retroactively.
 *
 * Injectable seams (storage / visibility / importers) keep it unit-testable
 * without a DOM or audio hardware.
 */

const STORAGE_KEY = 'chaching.joy';

export interface JoySettings {
	enabled: boolean;
	muted: boolean;
}

const DEFAULT_SETTINGS: JoySettings = { enabled: false, muted: false };

export interface JoyDeps {
	/** localStorage-like store. Defaults to window.localStorage (or a no-op under SSR). */
	storage?: Pick<Storage, 'getItem' | 'setItem'>;
	/** Returns the current visibility state. Defaults to document.visibilityState. */
	visibility?: () => DocumentVisibilityState;
	/** Returns prefers-reduced-motion. Defaults to a matchMedia check. */
	reducedMotion?: () => boolean;
	/** Resolves the chime player (dynamic import by default). */
	loadChime?: () => Promise<{ playChime: () => Promise<void>; disposeChime: () => void }>;
	/** Resolves the confetti burst (dynamic import by default). */
	loadConfetti?: () => Promise<{ fireMilestoneBurst: () => Promise<void> }>;
	/** Clock for rate-limiting (ms). Defaults to Date.now. */
	now?: () => number;
}

/** Minimum gap between chimes (debounce a flurry of same-tick crossings). */
const CHIME_MIN_GAP_MS = 1_500;
/** Minimum gap between confetti bursts (hard cap so milestones never spam). */
const CONFETTI_MIN_GAP_MS = 10_000;

function noopStorage(): Pick<Storage, 'getItem' | 'setItem'> {
	return { getItem: () => null, setItem: () => {} };
}

export class JoyController {
	private settings: JoySettings;
	private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	private readonly visibility: () => DocumentVisibilityState;
	private readonly reducedMotion: () => boolean;
	private readonly loadChime: NonNullable<JoyDeps['loadChime']>;
	private readonly loadConfetti: NonNullable<JoyDeps['loadConfetti']>;
	private readonly now: () => number;

	private lastChimeAt = -Infinity;
	private lastConfettiAt = -Infinity;
	private chimeDisposer: (() => void) | null = null;

	constructor(deps: JoyDeps = {}) {
		this.storage =
			deps.storage ??
			(typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage());
		this.visibility =
			deps.visibility ??
			(() => (typeof document !== 'undefined' ? document.visibilityState : 'visible'));
		this.reducedMotion =
			deps.reducedMotion ??
			(() =>
				typeof window !== 'undefined' && typeof window.matchMedia === 'function'
					? window.matchMedia('(prefers-reduced-motion: reduce)').matches
					: false);
		this.loadChime = deps.loadChime ?? (() => import('./chime.js'));
		this.loadConfetti = deps.loadConfetti ?? (() => import('./confetti.js'));
		this.now = deps.now ?? (() => Date.now());
		this.settings = this.read();
	}

	private read(): JoySettings {
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			if (!raw) return { ...DEFAULT_SETTINGS };
			const parsed = JSON.parse(raw) as Partial<JoySettings>;
			return {
				enabled: parsed.enabled === true, // default OFF unless explicitly true
				muted: parsed.muted === true
			};
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}

	private write(): void {
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
		} catch {
			/* persistence is best-effort */
		}
	}

	get enabled(): boolean {
		return this.settings.enabled;
	}
	get muted(): boolean {
		return this.settings.muted;
	}

	/** Toggle/set the master joy switch (persisted). Returns the new value. */
	setEnabled(on: boolean): boolean {
		this.settings.enabled = on;
		this.write();
		return on;
	}

	/** Toggle/set chime mute (persisted). Returns the new value. */
	setMuted(muted: boolean): boolean {
		this.settings.muted = muted;
		this.write();
		return muted;
	}

	/**
	 * Called when the caller's `crossedUp` says an escalation threshold was crossed.
	 * Fires the chime IFF: enabled + not muted + tab visible + outside the debounce
	 * window. Dynamically imports the chime only on the fire path.
	 */
	onEscalationCrossing(): void {
		if (!this.settings.enabled || this.settings.muted) return;
		if (this.visibility() !== 'visible') return;
		const t = this.now();
		if (t - this.lastChimeAt < CHIME_MIN_GAP_MS) return;
		this.lastChimeAt = t;
		void this.loadChime()
			.then((m) => {
				this.chimeDisposer = m.disposeChime;
				return m.playChime();
			})
			.catch(() => {});
	}

	/**
	 * Called when the caller's `crossedUp` says a LIFETIME milestone was crossed.
	 * Fires the confetti burst IFF: enabled + tab visible + motion allowed + outside
	 * the hard-cap window. Mute does NOT gate confetti (it's silent); reduced-motion
	 * does (no burst). Dynamically imports canvas-confetti only on the fire path.
	 */
	onMilestoneCrossing(opts: { reducedMotion?: boolean } = {}): void {
		if (!this.settings.enabled) return;
		if (this.visibility() !== 'visible') return;
		const reduced = opts.reducedMotion ?? this.reducedMotion();
		if (reduced) return; // reduced motion → no burst (a single static glint at most)
		const t = this.now();
		if (t - this.lastConfettiAt < CONFETTI_MIN_GAP_MS) return;
		this.lastConfettiAt = t;
		void this.loadConfetti()
			.then((m) => m.fireMilestoneBurst())
			.catch(() => {});
	}

	/** Release any lazily-created audio context. */
	dispose(): void {
		if (this.chimeDisposer) {
			this.chimeDisposer();
			this.chimeDisposer = null;
		}
	}
}
