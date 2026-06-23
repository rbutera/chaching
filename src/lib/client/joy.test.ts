/**
 * Tests for the opt-in joy controller (DEFAULT OFF).
 *
 * Covers design.md scenario matrix rows 14–19:
 *  - default (untouched) fires nothing + creates no AudioContext (nothing imported)
 *  - enabled + visible + unmuted crossing → chime once (debounced)
 *  - hidden tab → no chime (visibility gate)
 *  - muted → no chime
 *  - no retroactive fire (controller only fires when told a crossing happened)
 *  - confetti on milestone (motion allowed) only; reduced-motion suppresses it
 *  - setting persists to storage
 */

import { describe, it, expect, vi } from 'vitest';
import { JoyController, type JoyDeps } from './joy.js';

function memStorage(initial?: Record<string, string>) {
	const map = new Map<string, string>(Object.entries(initial ?? {}));
	return {
		store: {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v)
		},
		dump: () => Object.fromEntries(map)
	};
}

function makeDeps(over: Partial<JoyDeps> = {}) {
	const playChime = vi.fn(async () => {});
	const fireMilestoneBurst = vi.fn(async () => {});
	const loadChime = vi.fn(async () => ({ playChime, disposeChime: () => {} }));
	const loadConfetti = vi.fn(async () => ({ fireMilestoneBurst }));
	const deps: JoyDeps = {
		storage: memStorage().store,
		visibility: () => 'visible',
		reducedMotion: () => false,
		loadChime,
		loadConfetti,
		now: () => 0,
		...over
	};
	return { deps, playChime, fireMilestoneBurst, loadChime, loadConfetti };
}

describe('JoyController — default OFF', () => {
	it('row 14: default settings fire nothing and import nothing', async () => {
		const { deps, loadChime, loadConfetti } = makeDeps();
		const joy = new JoyController(deps);
		expect(joy.enabled).toBe(false);
		expect(joy.muted).toBe(false);
		joy.onEscalationCrossing();
		joy.onMilestoneCrossing({ reducedMotion: false });
		await Promise.resolve();
		expect(loadChime).not.toHaveBeenCalled(); // no dynamic import ⇒ no AudioContext
		expect(loadConfetti).not.toHaveBeenCalled();
	});
});

describe('JoyController — chime gating', () => {
	it('row 15: enabled + visible + unmuted crossing fires the chime once', async () => {
		const { deps, playChime, loadChime } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onEscalationCrossing();
		await new Promise((r) => setTimeout(r, 0));
		expect(loadChime).toHaveBeenCalledTimes(1);
		expect(playChime).toHaveBeenCalledTimes(1);
	});

	it('debounces a flurry of same-instant crossings to a single chime', async () => {
		const { deps, playChime } = makeDeps({ now: () => 1000 });
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onEscalationCrossing();
		joy.onEscalationCrossing(); // same now() → inside the debounce window
		await new Promise((r) => setTimeout(r, 0));
		expect(playChime).toHaveBeenCalledTimes(1);
	});

	it('row 16: hidden tab → chime does NOT fire (visibility gate)', async () => {
		const { deps, loadChime } = makeDeps({ visibility: () => 'hidden' });
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onEscalationCrossing();
		await Promise.resolve();
		expect(loadChime).not.toHaveBeenCalled();
	});

	it('row 17: muted → no chime', async () => {
		const { deps, loadChime } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.setMuted(true);
		joy.onEscalationCrossing();
		await Promise.resolve();
		expect(loadChime).not.toHaveBeenCalled();
	});
});

describe('JoyController — confetti gating', () => {
	it('row 18: milestone crossing, enabled + motion allowed → one burst', async () => {
		const { deps, fireMilestoneBurst, loadConfetti } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onMilestoneCrossing({ reducedMotion: false });
		await new Promise((r) => setTimeout(r, 0));
		expect(loadConfetti).toHaveBeenCalledTimes(1);
		expect(fireMilestoneBurst).toHaveBeenCalledTimes(1);
	});

	it('row 19: reduced motion suppresses the burst entirely', async () => {
		const { deps, loadConfetti } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onMilestoneCrossing({ reducedMotion: true });
		await Promise.resolve();
		expect(loadConfetti).not.toHaveBeenCalled();
	});

	it('mute does NOT gate confetti (it is silent), motion still governs it', async () => {
		const { deps, fireMilestoneBurst } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.setMuted(true);
		joy.onMilestoneCrossing({ reducedMotion: false });
		await new Promise((r) => setTimeout(r, 0));
		expect(fireMilestoneBurst).toHaveBeenCalledTimes(1);
	});

	it('hard-caps repeated bursts within the cooldown window', async () => {
		const { deps, fireMilestoneBurst } = makeDeps({ now: () => 0 });
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		joy.onMilestoneCrossing({ reducedMotion: false });
		joy.onMilestoneCrossing({ reducedMotion: false }); // same now → inside cap window
		await new Promise((r) => setTimeout(r, 0));
		expect(fireMilestoneBurst).toHaveBeenCalledTimes(1);
	});
});

describe('JoyController — persistence', () => {
	it('persists enabled + muted to storage', () => {
		const mem = memStorage();
		const joy = new JoyController({ ...makeDeps().deps, storage: mem.store });
		joy.setEnabled(true);
		joy.setMuted(true);
		const saved = JSON.parse(mem.dump()['chaching.joy']);
		expect(saved).toEqual({ enabled: true, muted: true });
	});

	it('reads persisted settings on construction (round-trip)', () => {
		const mem = memStorage({ 'chaching.joy': JSON.stringify({ enabled: true, muted: false }) });
		const joy = new JoyController({ ...makeDeps().deps, storage: mem.store });
		expect(joy.enabled).toBe(true);
		expect(joy.muted).toBe(false);
	});

	it('a corrupt/garbage persisted value falls back to default OFF', () => {
		const mem = memStorage({ 'chaching.joy': 'not json' });
		const joy = new JoyController({ ...makeDeps().deps, storage: mem.store });
		expect(joy.enabled).toBe(false);
	});

	it('row: no retroactive fire — the controller only fires when explicitly told', async () => {
		// Enabling joy does not itself fire anything; only a subsequent crossing call does.
		const { deps, loadChime } = makeDeps();
		const joy = new JoyController(deps);
		joy.setEnabled(true);
		await Promise.resolve();
		expect(loadChime).not.toHaveBeenCalled();
	});
});
