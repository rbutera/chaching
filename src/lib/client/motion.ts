/**
 * Web motion helpers — the register motion language.
 *
 * Framework-free, web-only (uses `requestAnimationFrame` / `matchMedia`, guarded
 * for SSR). Every JS animation path here additionally checks
 * `prefers-reduced-motion` and no-ops to the FINAL value, so a tween never runs
 * when motion is reduced (the CSS base reset can't reach rAF tweens).
 *
 * Used by the hero/stat count-up and the rate-limited SSE number tick.
 */

/** True when the user asked for reduced motion (false under SSR / no matchMedia). */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface CountUpOpts {
	/** Tween duration in ms. */
	durMs?: number;
	/** Force the immediate-set path (reduced motion). Defaults to prefersReducedMotion(). */
	reduced?: boolean;
	/** Injectable now() for tests (defaults to performance.now). */
	now?: () => number;
	/** Injectable rAF for tests (defaults to requestAnimationFrame). */
	raf?: (cb: (t: number) => void) => number;
	/** Injectable cancel for tests (defaults to cancelAnimationFrame). */
	cancel?: (h: number) => void;
}

/**
 * Tween a number from → to over `durMs`, calling `onFrame` with each intermediate
 * value and landing EXACTLY on `to`. Returns a cancel function.
 *
 * Reduced-motion (or `reduced: true`): calls `onFrame(to)` once, synchronously,
 * with zero intermediate frames, and returns a no-op cancel. This is the property
 * the reduced-motion test asserts.
 *
 * Easing: cubic ease-out (mirrors the `--ease-out` token feel) so the count
 * decelerates onto the final value.
 */
export function countUp(
	from: number,
	to: number,
	onFrame: (value: number) => void,
	opts: CountUpOpts = {}
): () => void {
	const reduced = opts.reduced ?? prefersReducedMotion();
	// Reduced motion, no-op duration, or no rAF (SSR): jump straight to the final value.
	const raf =
		opts.raf ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
	const cancel =
		opts.cancel ?? (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined);
	const dur = opts.durMs ?? 650;
	if (reduced || dur <= 0 || !raf) {
		onFrame(to);
		return () => {};
	}
	const nowFn = opts.now ?? (() => performance.now());
	const start = nowFn();
	let handle = 0;
	let cancelled = false;
	const tick = (t: number) => {
		if (cancelled) return;
		const p = Math.min(1, (t - start) / dur);
		const eased = 1 - Math.pow(1 - p, 3);
		onFrame(from + (to - from) * eased);
		if (p < 1) handle = raf(tick);
		else onFrame(to);
	};
	handle = raf(tick);
	return () => {
		cancelled = true;
		if (cancel) cancel(handle);
	};
}

/**
 * A trailing throttle that coalesces a burst of updates into at most one call per
 * `windowMs`, ALWAYS landing on the latest value. The SSE number tick uses this so
 * a chatty feed never thrashes the animation: intermediate deltas collapse, and
 * the final value is correct.
 *
 * Returns a `{ push, flush, cancel }` controller. `push(value)` schedules a
 * trailing run; the first push in an idle window also runs immediately (leading +
 * trailing). Reduced motion is the caller's concern (it should set the value
 * directly and skip the throttle), but `windowMs <= 0` makes every push immediate.
 */
export interface ThrottleController<T> {
	push(value: T): void;
	flush(): void;
	cancel(): void;
}

export function trailingThrottle<T>(
	windowMs: number,
	onValue: (value: T) => void,
	opts: { setTimeoutFn?: typeof setTimeout; clearTimeoutFn?: typeof clearTimeout } = {}
): ThrottleController<T> {
	const setT = opts.setTimeoutFn ?? setTimeout;
	const clearT = opts.clearTimeoutFn ?? clearTimeout;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let latest: T | undefined;
	let hasLatest = false;

	const run = () => {
		timer = null;
		if (hasLatest) {
			hasLatest = false;
			const v = latest as T;
			latest = undefined;
			onValue(v);
		}
	};

	return {
		push(value: T) {
			if (windowMs <= 0) {
				onValue(value);
				return;
			}
			if (timer === null) {
				// Leading edge: emit now, then open the window for trailing coalescing.
				onValue(value);
				timer = setT(run, windowMs);
			} else {
				// Inside the window: keep only the latest; the trailing run emits it.
				latest = value;
				hasLatest = true;
			}
		},
		flush() {
			if (timer !== null) {
				clearT(timer);
				run();
			}
		},
		cancel() {
			if (timer !== null) {
				clearT(timer);
				timer = null;
			}
			latest = undefined;
			hasLatest = false;
		}
	};
}
