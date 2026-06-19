// De-dup across the MERGED set of all transcripts (top-level + subagent).
// Streaming rewrites the same API response across many lines with the same
// `${message.id}:${requestId}`; the same message can also appear in both a
// top-level file and a subagent file. Without dedup, cost inflates massively.
//
// If either id is null we cannot form a stable key, so we count the line as-is
// (a unique synthetic key per occurrence).

let nullCounter = 0;

/** Build the dedup key for a line. Null ids -> a unique per-occurrence key. */
export function makeKey(messageId: string | null, requestId: string | null): string {
	if (messageId == null || requestId == null) {
		// count-as-is: guaranteed-unique key so it is never deduped away
		return `__nokey__:${nullCounter++}`;
	}
	return `${messageId}:${requestId}`;
}

export function isNoKey(key: string): boolean {
	return key.startsWith('__nokey__:');
}

/** A seen-key set with a tiny convenience API. */
export class DedupSet {
	private seen = new Set<string>();

	/** Returns true if this is the FIRST time we've seen the key (i.e. count it). */
	add(key: string): boolean {
		if (isNoKey(key)) return true; // never dedup null-id lines
		if (this.seen.has(key)) return false;
		this.seen.add(key);
		return true;
	}

	has(key: string): boolean {
		return !isNoKey(key) && this.seen.has(key);
	}

	get size(): number {
		return this.seen.size;
	}
}
