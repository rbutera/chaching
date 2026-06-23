/**
 * Web suppression — the runtime "no-art" equivalent that mirrors the CLI contract
 * (design D9). The web can't read CLI flags, so it honors:
 *   - a `?no-art` (or `?no-art=1`) query param, and
 *   - a persisted `chaching.noArt` localStorage setting.
 * When suppressed, personality copy on the web falls back to the plain
 * sentence-case functional label and motion stays minimal — the same BEHAVIOUR
 * the `--no-art` / `CHACHING_NO_ART` CLI path gives the TUI/receipt.
 *
 * `NO_COLOR` is not a browser concept (no terminal color to strip); per the spec
 * `NO_COLOR` only ever strips color and preserves content, so the web (which has
 * no ANSI) has nothing to do for it. Framework-free; SSR-safe (returns false).
 */

const STORAGE_KEY = 'chaching.noArt';

/** True when the web should suppress personality copy + extra motion. */
export function webSuppressArt(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.has('no-art')) {
			const v = params.get('no-art');
			// `?no-art` (no value) or any non-"0"/"false" value enables it.
			if (v === null || v === '' || (v !== '0' && v.toLowerCase() !== 'false')) return true;
		}
	} catch {
		/* malformed URL — ignore */
	}
	try {
		const persisted = window.localStorage?.getItem(STORAGE_KEY);
		if (persisted !== null && persisted !== undefined && persisted !== '' && persisted !== '0') {
			return true;
		}
	} catch {
		/* storage blocked — ignore */
	}
	return false;
}
