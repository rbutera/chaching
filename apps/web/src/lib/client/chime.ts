/**
 * The "cha-ching" cash-register chime — Web Audio synthesis (no asset, no dep).
 *
 * This module is DYNAMICALLY IMPORTED only on the joy path, so the default build
 * ships nothing eager and no `AudioContext` is constructed unless joy is enabled.
 * The context is created lazily on first play (a user-gestured enable satisfies
 * the autoplay policy) and reused.
 *
 * A short two-note bright "ding-ding" with a quick decay — a register bell, not a
 * synth pad. Kept under ~250ms.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const Ctor =
		window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return null;
	if (!ctx) ctx = new Ctor();
	return ctx;
}

/** Play one cha-ching. Resolves once scheduled; no-op when Web Audio is unavailable. */
export async function playChime(): Promise<void> {
	const ac = audioContext();
	if (!ac) return;
	// A suspended context (autoplay policy) resumes on the user-gestured enable.
	if (ac.state === 'suspended') {
		try {
			await ac.resume();
		} catch {
			/* ignore — best-effort */
		}
	}
	const now = ac.currentTime;
	// Two bright bell notes a major third apart, each a fast-decaying triangle.
	const notes: Array<{ freq: number; at: number }> = [
		{ freq: 1318.5, at: 0 }, // E6
		{ freq: 1661.2, at: 0.08 } // G#6
	];
	for (const { freq, at } of notes) {
		const osc = ac.createOscillator();
		const gain = ac.createGain();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(freq, now + at);
		gain.gain.setValueAtTime(0.0001, now + at);
		gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.18);
		osc.connect(gain).connect(ac.destination);
		osc.start(now + at);
		osc.stop(now + at + 0.2);
	}
}

/** Release the shared context (page teardown). */
export function disposeChime(): void {
	if (ctx) {
		void ctx.close().catch(() => {});
		ctx = null;
	}
}
