/**
 * Tests for the shared voice module (src/lib/voice/).
 *
 * Covers the design.md scenario matrix rows 1–7, 13:
 *  - pickForBucket stable-within / varies-across (injected clock)
 *  - receipt footer stable per receipt (seeded), differs across receipts
 *  - escalation tier pure-by-amount + crossing detection, identical across surfaces
 *  - casing (caps → UPPERCASE)
 *  - suppression predicates (--no-art / CHACHING_NO_ART / NO_COLOR), framework-free
 */

import { describe, it, expect } from 'vitest';
import {
	pickForBucket,
	pick,
	hashMix,
	seedFrom,
	scanningLine,
	emptyLine,
	errorLine,
	receiptFooter,
	noArt,
	noColor,
	caps,
	flourishFor,
	tierIndex,
	crossedUp,
	formatFlourishText,
	BLOCK_FLOURISHES,
	DAILY_FLOURISHES,
	LIFETIME_FLOURISHES,
	SCANNING_LINES,
	EMPTY_LINES,
	ERROR_LINES,
	RECEIPT_FOOTERS,
} from './index.js';

describe('pickForBucket — deterministic per bucket', () => {
	const items = ['a', 'b', 'c', 'd', 'e'] as const;

	it('row 1: stable within the same bucket (same line both calls)', () => {
		const now = 1_000_000;
		const a = pickForBucket(items, { bucketMs: 2_500, now });
		const b = pickForBucket(items, { bucketMs: 2_500, now });
		expect(a).toBe(b);
	});

	it('stable across the whole bucket window', () => {
		const base = 5_000_000;
		const first = pickForBucket(items, { bucketMs: 1_000, now: base });
		// Anywhere inside the same 1s bucket → same pick.
		expect(pickForBucket(items, { bucketMs: 1_000, now: base + 1 })).toBe(first);
		expect(pickForBucket(items, { bucketMs: 1_000, now: base + 999 })).toBe(first);
	});

	it('row 2: varies across adjacent buckets (not pinned to one line)', () => {
		// Across a span of buckets the selection visits more than one line.
		const seen = new Set<string>();
		for (let b = 0; b < 40; b++) {
			seen.add(pickForBucket(items, { bucketMs: 1_000, now: b * 1_000 }));
		}
		expect(seen.size).toBeGreaterThan(1);
	});

	it('is pure: same (bucket, seed) ⇒ same result regardless of call order', () => {
		const x = pickForBucket(items, { bucketMs: 1_000, now: 7_000, seed: 'web' });
		const y = pickForBucket(items, { bucketMs: 1_000, now: 7_000, seed: 'web' });
		expect(x).toBe(y);
	});

	it('seed shifts the selection independently of the clock', () => {
		// Different seeds across many buckets must not be identical everywhere.
		let differed = false;
		for (let b = 0; b < 20; b++) {
			const noSeed = pickForBucket(items, { bucketMs: 1_000, now: b * 1_000 });
			const seeded = pickForBucket(items, { bucketMs: 1_000, now: b * 1_000, seed: 'tui' });
			if (noSeed !== seeded) differed = true;
		}
		expect(differed).toBe(true);
	});

	it('always returns a member of the bank', () => {
		for (let n = 0; n < 100; n++) {
			expect(items).toContain(pickForBucket(items, { bucketMs: 1_000, now: n * 137 }));
		}
	});

	it('throws on an empty bank rather than returning undefined', () => {
		expect(() => pickForBucket([], { bucketMs: 1_000 })).toThrow();
	});

	it('hashMix is deterministic and unsigned', () => {
		expect(hashMix(42)).toBe(hashMix(42));
		expect(hashMix(-1)).toBeGreaterThanOrEqual(0);
	});

	it('seedFrom is deterministic', () => {
		expect(seedFrom('abc')).toBe(seedFrom('abc'));
		expect(seedFrom('abc')).not.toBe(seedFrom('abd'));
	});
});

describe('pick — legacy index wrapper preserved', () => {
	it('cycles by index and wraps', () => {
		const items = ['a', 'b', 'c'] as const;
		expect(pick(items, 0)).toBe('a');
		expect(pick(items, 1)).toBe('b');
		expect(pick(items, 3)).toBe('a');
	});
});

describe('per-bank wrappers', () => {
	it('scanningLine returns a member, stable within its bucket', () => {
		const now = 9_000;
		expect(SCANNING_LINES).toContain(scanningLine({ now }));
		expect(scanningLine({ now })).toBe(scanningLine({ now }));
	});

	it('emptyLine / errorLine return members of their banks', () => {
		expect(EMPTY_LINES).toContain(emptyLine({ now: 1 }));
		expect(ERROR_LINES).toContain(errorLine({ now: 1 }));
	});

	it('row 3: receipt footer stable per receipt (same seed ⇒ same footer)', () => {
		const a = receiptFooter({ seed: '2026-06:day' });
		const b = receiptFooter({ seed: '2026-06:day' });
		expect(a).toBe(b);
		expect(RECEIPT_FOOTERS).toContain(a);
	});

	it('row 4: two different receipts can differ; both from the bank', () => {
		// Across many distinct receipt seeds we see more than one footer.
		const seen = new Set<string>();
		for (let i = 0; i < 30; i++) seen.add(receiptFooter({ seed: `r-${i}` }));
		expect(seen.size).toBeGreaterThan(1);
		for (const f of seen) expect(RECEIPT_FOOTERS).toContain(f);
	});
});

describe('suppression contract (framework-free)', () => {
	it('row 5: --no-art suppresses', () => {
		expect(noArt(['--no-art'], {})).toBe(true);
	});
	it('row 5: CHACHING_NO_ART env suppresses; empty string does not', () => {
		expect(noArt([], { CHACHING_NO_ART: '1' })).toBe(true);
		expect(noArt([], { CHACHING_NO_ART: '' })).toBe(false);
	});
	it('default (no flag, no env) is false', () => {
		expect(noArt([], {})).toBe(false);
	});
	it('row 6: NO_COLOR strips color; empty string does not', () => {
		expect(noColor({ NO_COLOR: '1' })).toBe(true);
		expect(noColor({ NO_COLOR: '' })).toBe(false);
		expect(noColor({})).toBe(false);
	});
});

describe('casing contract', () => {
	it('caps → UPPERCASE structural tag', () => {
		expect(caps('total burn')).toBe('TOTAL BURN');
		expect(caps('by model')).toBe('BY MODEL');
	});
	it('personality banks are authored lowercase', () => {
		for (const line of [...SCANNING_LINES, ...EMPTY_LINES, ...ERROR_LINES]) {
			// no uppercase letters in personality copy
			expect(line).toBe(line.toLowerCase());
		}
	});
});

describe('escalation ladder — pure by amount, one ladder everywhere', () => {
	it('row 13: flourishFor is a pure function of the amount', () => {
		expect(flourishFor(75, BLOCK_FLOURISHES)).toEqual(flourishFor(75, BLOCK_FLOURISHES));
		expect(flourishFor(75, BLOCK_FLOURISHES).emoji).toContain('🔥');
	});

	it('zero tier below the first threshold (no decoration)', () => {
		expect(flourishFor(0, BLOCK_FLOURISHES).remark).toBe('');
		expect(flourishFor(9.99, BLOCK_FLOURISHES).emoji).toBe('');
		expect(flourishFor(50, LIFETIME_FLOURISHES).emoji).toBe('');
	});

	it('tierIndex increases with spend', () => {
		expect(tierIndex(0, DAILY_FLOURISHES)).toBe(0);
		expect(tierIndex(20, DAILY_FLOURISHES)).toBe(1);
		expect(tierIndex(500, DAILY_FLOURISHES)).toBeGreaterThan(tierIndex(100, DAILY_FLOURISHES));
	});

	it('crossedUp fires only on an upward tier change', () => {
		expect(crossedUp(0, 1)).toBe(true);
		expect(crossedUp(2, 3)).toBe(true);
		expect(crossedUp(2, 2)).toBe(false); // same tier — no fire
		expect(crossedUp(3, 1)).toBe(false); // dropped — no fire
	});

	it('formatFlourishText is empty at the zero tier, "emoji remark" otherwise', () => {
		expect(formatFlourishText(flourishFor(0, BLOCK_FLOURISHES))).toBe('');
		const t = formatFlourishText(flourishFor(10, BLOCK_FLOURISHES));
		expect(t).toContain('💸');
		expect(t).toContain('warming up');
	});
});
