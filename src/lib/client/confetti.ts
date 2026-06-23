/**
 * Restrained milestone confetti — a brass coin burst, dynamically imported on the
 * joy path only (canvas-confetti is never in the default bundle).
 *
 * Reduced-motion is the CALLER's gate (the JoyController checks it before calling
 * here). This wrapper just fires a tasteful, brief, gold-toned burst.
 */

/** Fire one restrained gold confetti burst. No-op under SSR. */
export async function fireMilestoneBurst(): Promise<void> {
	if (typeof window === 'undefined') return;
	const mod = await import('canvas-confetti');
	const confetti = mod.default;
	// Brass/gold palette, low particle count, short spread — a coin shower, not a parade.
	confetti({
		particleCount: 60,
		spread: 55,
		startVelocity: 32,
		ticks: 120,
		gravity: 1.1,
		scalar: 0.9,
		origin: { y: 0.7 },
		colors: ['#f9c75a', '#eba92c', '#cc8f1f', '#f7bc42'],
		disableForReducedMotion: true
	});
}
