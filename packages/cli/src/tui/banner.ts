// TUI banner — the brass-gold register wordmark.
//
// The full banner is the figlet "chaching" wordmark. Its editable source of truth
// is `logo.txt` at the repo ROOT — that file is READ-ONLY for humans: DO NOT
// hand-edit the art in THIS file. The art is embedded here as BASE64 (decoded at
// import) so the figlet's `$` and `\` characters can never be mangled by string-
// escaping (a hand-escaped template literal is exactly what previously corrupted it
// into reading "chacting"). To change the banner: edit `logo.txt`, then regenerate
// the base64 with
//   node -e "process.stdout.write(require('fs').readFileSync('logo.txt').toString('base64'))"
// and paste it into LOGO_FULL_B64. The byte-exactness test (theme.test.ts) fails if
// LOGO_FULL drifts from logo.txt, so the two can never silently diverge.
//
// Embedding (vs reading logo.txt at runtime) keeps the bundled CLI free of any
// runtime file dependency and ships the art in the tarball regardless of the
// package `files` allowlist (which excludes `logo.txt` and `src/`).
//
// Color comes from the shared brand-token ANSI map via theme.ts (brass gold
// #eba92c); this module is content only. Suppression (--no-art / NO_COLOR) and
// width selection live in theme.ts's bannerLine().

/**
 * Base64 of `logo.txt` (repo root, the read-only editable source of the figlet).
 * Decoded into {@link LOGO_FULL} below. Regenerate from logo.txt on any change —
 * see the module header. `Buffer` is fine here (CLI runs on Node).
 */
const LOGO_FULL_B64 =
	'ICQkJCQkJFwgICQkXCAgICAgICAgICAgICAgICAgICAgICAgICAgICQkXCAgICAgICAkJFwgICAgICAgICAgICAgICAgICAgICAkJFwgCiQkICBfXyQkXCAkJCB8ICAgICAgICAgICAgICAgICAgICAgICAgICAkJCB8ICAgICAgXF9ffCAgICAgICAgICAgICAgICAgICAgJCQgfAokJCAvICBcX198JCQkJCQkJFwgICAkJCQkJCRcICAgJCQkJCQkJFwgJCQkJCQkJFwgICQkXCAkJCQkJCQkXCAgICQkJCQkJFwgICQkIHwKJCQgfCAgICAgICQkICBfXyQkXCAgXF9fX18kJFwgJCQgIF9fX19ffCQkICBfXyQkXCAkJCB8JCQgIF9fJCRcICQkICBfXyQkXCAkJCB8CiQkIHwgICAgICAkJCB8ICAkJCB8ICQkJCQkJCQgfCQkIC8gICAgICAkJCB8ICAkJCB8JCQgfCQkIHwgICQkIHwkJCAvICAkJCB8XF9ffAokJCB8ICAkJFwgJCQgfCAgJCQgfCQkICBfXyQkIHwkJCB8ICAgICAgJCQgfCAgJCQgfCQkIHwkJCB8ICAkJCB8JCQgfCAgJCQgfCAgICAKXCQkJCQkJCAgfCQkIHwgICQkIHxcJCQkJCQkJCB8XCQkJCQkJCRcICQkIHwgICQkIHwkJCB8JCQgfCAgJCQgfFwkJCQkJCQkIHwkJFwgCiBcX19fX19fLyBcX198ICBcX198IFxfX19fX19ffCBcX19fX19fX3xcX198ICBcX198XF9ffFxfX3wgIFxfX3wgXF9fX18kJCB8XF9ffAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJCRcICAgJCQgfCAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwkJCQkJCQgIHwgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXF9fX19fXy8gICAgIAo=';

/**
 * Full register wordmark — decoded from {@link LOGO_FULL_B64} (= `logo.txt` minus
 * its single trailing newline, matching the no-trailing-newline render the callers
 * expect). bannerLine() falls back to the compact variant below the min width.
 */
export const LOGO_FULL = Buffer.from(LOGO_FULL_B64, 'base64').toString('utf8').replace(/\n$/, '');

/** Widest line in {@link LOGO_FULL} — the min terminal width to render it. */
export const LOGO_FULL_MIN_COLS = 78;

/**
 * Compact wordmark for narrow terminals (< {@link LOGO_FULL_MIN_COLS}). Keeps the
 * dollar-sign register feel + the caching pun in a single short block.
 */
export const LOGO_COMPACT = `$$ chaching
─ the register that counts the cache hits too`;
