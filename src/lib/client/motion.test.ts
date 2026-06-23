/**
 * Tests for the web motion helpers (countUp + trailingThrottle).
 *
 * Covers design.md scenario matrix rows 8, 9, 12:
 *  - count-up runs from 0 → total when motion is allowed (intermediate frames)
 *  - reduced motion = immediate set, ZERO intermediate frames
 *  - a burst of SSE deltas → bounded tick count, lands on the latest value
 */

import { describe, it, expect, vi } from 'vitest';
import { countUp, trailingThrottle } from './motion.js';

// A controllable rAF: collects callbacks; `step(t)` drains the queued frame.
function fakeRaf() {
	let queue: Array<(t: number) => void> = [];
	const raf = (cb: (t: number) => void) => {
		queue.push(cb);
		return queue.length;
	};
	const cancel = () => {
		queue = [];
	};
	const step = (t: number) => {
		const pending = queue;
		queue = [];
		for (const cb of pending) cb(t);
	};
	return { raf, cancel, step, pending: () => queue.length };
}

describe('countUp', () => {
	it('row 8: animates from → to with intermediate frames when motion is allowed', () => {
		const frames: number[] = [];
		const r = fakeRaf();
		countUp(0, 100, (v) => frames.push(v), {
			durMs: 100,
			reduced: false,
			now: () => 0,
			raf: r.raf,
			cancel: r.cancel
		});
		// Drive a few frames partway, then past the end.
		r.step(25);
		r.step(50);
		r.step(75);
		r.step(100);
		expect(frames.length).toBeGreaterThan(1); // intermediate frames happened
		expect(frames[frames.length - 1]).toBe(100); // lands exactly on target
		expect(Math.max(...frames)).toBeLessThanOrEqual(100);
	});

	it('row 9: reduced motion = single immediate set, ZERO intermediate frames', () => {
		const frames: number[] = [];
		const r = fakeRaf();
		countUp(0, 100, (v) => frames.push(v), {
			durMs: 650,
			reduced: true,
			raf: r.raf,
			cancel: r.cancel
		});
		expect(frames).toEqual([100]); // exactly one call, the final value
		expect(r.pending()).toBe(0); // no rAF scheduled at all
	});

	it('durMs <= 0 also jumps straight to the final value', () => {
		const frames: number[] = [];
		countUp(5, 42, (v) => frames.push(v), { durMs: 0, reduced: false });
		expect(frames).toEqual([42]);
	});

	it('cancel stops further frames', () => {
		const frames: number[] = [];
		const r = fakeRaf();
		const cancel = countUp(0, 100, (v) => frames.push(v), {
			durMs: 100,
			reduced: false,
			now: () => 0,
			raf: r.raf,
			cancel: r.cancel
		});
		r.step(25);
		const countBefore = frames.length;
		cancel();
		r.step(50);
		expect(frames.length).toBe(countBefore); // no frames after cancel
	});
});

describe('trailingThrottle', () => {
	it('row 12: a burst coalesces to a bounded number of emits, landing on the latest', () => {
		vi.useFakeTimers();
		const emitted: number[] = [];
		const t = trailingThrottle<number>(900, (v) => emitted.push(v), {
			setTimeoutFn: setTimeout as unknown as typeof setTimeout,
			clearTimeoutFn: clearTimeout as unknown as typeof clearTimeout
		});
		// 10 deltas inside one window.
		for (let i = 1; i <= 10; i++) t.push(i);
		// Leading edge emitted immediately (value 1); trailing pending.
		expect(emitted).toEqual([1]);
		vi.advanceTimersByTime(900);
		// Trailing emit lands on the LATEST (10), not every intermediate.
		expect(emitted).toEqual([1, 10]);
		expect(emitted.length).toBeLessThan(10); // bounded, not one-per-delta
		vi.useRealTimers();
	});

	it('windowMs <= 0 makes every push immediate (reduced-motion path)', () => {
		const emitted: number[] = [];
		const t = trailingThrottle<number>(0, (v) => emitted.push(v));
		t.push(1);
		t.push(2);
		t.push(3);
		expect(emitted).toEqual([1, 2, 3]);
	});

	it('flush emits the pending trailing value immediately', () => {
		vi.useFakeTimers();
		const emitted: number[] = [];
		const t = trailingThrottle<number>(900, (v) => emitted.push(v));
		t.push(1);
		t.push(2);
		t.flush();
		expect(emitted).toEqual([1, 2]);
		vi.useRealTimers();
	});
});
