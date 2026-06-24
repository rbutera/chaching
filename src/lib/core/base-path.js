// Normalise a user-supplied base path into the form SvelteKit's `kit.paths.base`
// requires: either an empty string, or a string that starts with `/` and does
// NOT end with `/`. This is consumed at BUILD time by svelte.config.js (the base
// path is baked into the bundle — SvelteKit has no runtime base path), so to
// serve chaching under a subpath you build with CHACHING_BASE_PATH set, e.g.
//   CHACHING_BASE_PATH=/chaching pnpm build
//
// It is plain `.js` (not `.ts`) on purpose: svelte.config.js is loaded as raw
// Node ESM and cannot import a `.ts` module, so the config and the app/tests
// share this single tested source.
//
//   ''            -> ''           (root, the default)
//   '/'           -> ''
//   'chaching'    -> '/chaching'
//   '/chaching/'  -> '/chaching'
//   '/a/b/'       -> '/a/b'

/**
 * @param {string | undefined | null} raw
 * @returns {string}
 */
export function normalizeBasePath(raw) {
	if (raw == null) return '';
	const trimmed = raw.trim();
	if (trimmed === '' || trimmed === '/') return '';
	// strip leading + trailing slashes, then re-add exactly one leading slash
	const inner = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
	return inner === '' ? '' : `/${inner}`;
}
