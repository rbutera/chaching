/**
 * Deterministic-per-bucket selection.
 *
 * The voice is "randomized / rotated, but deterministic per a time bucket so it's
 * stable within a tick and varies bucket-to-bucket". `pickForBucket` is the single
 * primitive: it derives a bucket index from the clock (`floor(now / bucketMs)`),
 * mixes it with an optional per-surface seed through a small non-crypto hash, and
 * indexes the bank. Pure + injectable clock → fully testable without fake timers.
 *
 *   - stable WITHIN a bucket   → a re-render / SSE delta in the same tick yields
 *                                the same line (no flicker)
 *   - varies ACROSS buckets    → it feels alive run-to-run
 *
 * Per-bank cadence lives in the thin wrappers below: scanning rotates fast,
 * empty/error per ~minute, the receipt footer is seeded by the receipt's
 * period/range (stable per receipt, differs across receipts). The escalation
 * ladder is NOT clock-driven at all — see escalation.ts (`flourishFor`), keyed to
 * the spend tier.
 */

import {
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from './copy.js';

/** Small non-crypto 32-bit mix (xorshift-ish). Deterministic, fast, well-spread. */
export function hashMix(n: number): number {
	let x = n | 0;
	x ^= x << 13;
	x ^= x >>> 17;
	x ^= x << 5;
	// >>> 0 → unsigned so the downstream modulo never goes negative.
	return x >>> 0;
}

/**
 * Lightweight string → 32-bit seed (FNV-1a). Lets a per-surface / per-receipt
 * string ("2026-06-day") seed the selection without forcing a numeric id.
 */
export function seedFrom(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export interface BucketOpts {
	/** Bucket size in ms; the selection is stable for this long, then advances. */
	bucketMs: number;
	/** Optional per-surface / per-receipt seed (number or string). */
	seed?: number | string;
	/** Injectable clock (ms). Defaults to Date.now. Tests pass a fixed value. */
	now?: number;
}

/**
 * Pick a deterministic item from `items` for the current time bucket.
 *
 * Same bucket (and seed) ⇒ same item; adjacent buckets ⇒ (almost always) a
 * different item. With `bucketMs <= 0` the selection is seed-only (no clock
 * dependence) — useful when only the seed should drive the choice.
 */
export function pickForBucket<T>(items: readonly T[], opts: BucketOpts): T {
	if (items.length === 0) {
		throw new RangeError('pickForBucket: empty items');
	}
	const now = opts.now ?? Date.now();
	const bucket = opts.bucketMs > 0 ? Math.floor(now / opts.bucketMs) : 0;
	const seedN = typeof opts.seed === 'string' ? seedFrom(opts.seed) : (opts.seed ?? 0);
	// Mix bucket index with the seed, then hash, then index.
	const mixed = hashMix((bucket ^ Math.imul(seedN, 0x9e3779b1)) | 0);
	return items[mixed % items.length];
}

/**
 * Legacy index-based picker (kept for backward compat with existing call sites
 * + tests). `index` defaults to the current minute so it "rotates" by the clock
 * without being random. New code should prefer `pickForBucket`.
 */
export function pick<T>(items: readonly T[], index?: number): T {
	const i = index ?? Math.floor(Date.now() / 60_000);
	return items[((i % items.length) + items.length) % items.length];
}

// ── Per-bank cadences (thin wrappers) ──────────────────────────────────────────

/** Scanning rotates fast (~per 2.5s) so the cold-scan frame feels alive. */
export function scanningLine(opts: { now?: number; seed?: number | string } = {}): string {
	return pickForBucket(SCANNING_LINES, { bucketMs: 2_500, ...opts });
}

/** Empty-state copy, per ~minute. */
export function emptyLine(opts: { now?: number; seed?: number | string } = {}): string {
	return pickForBucket(EMPTY_LINES, { bucketMs: 60_000, ...opts });
}

/** Error copy, per ~minute. */
export function errorLine(opts: { now?: number; seed?: number | string } = {}): string {
	return pickForBucket(ERROR_LINES, { bucketMs: 60_000, ...opts });
}

/**
 * Receipt footer — seeded by the receipt period/range (NOT the clock), so the same
 * receipt is stable across renders but two different receipts differ. Pass the
 * receipt's period/range key as `seed`; with no seed it falls back to a per-minute
 * rotation (preserves the old behaviour for ad-hoc callers).
 */
export function receiptFooter(opts: { seed?: number | string; now?: number } = {}): string {
	if (opts.seed !== undefined) {
		return pickForBucket(RECEIPT_FOOTERS, { bucketMs: 0, seed: opts.seed });
	}
	return pickForBucket(RECEIPT_FOOTERS, { bucketMs: 60_000, now: opts.now });
}
