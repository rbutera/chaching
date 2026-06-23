// TUI banner — the brass-gold register wordmark.
//
// The full banner is the figlet "$$$$ chaching" wordmark. Its editable source of
// truth is `logo.txt` at the repo ROOT. It is INLINED here as a string literal
// (not read at runtime) so the bundled CLI has no runtime file dependency and the
// art ships in the tarball regardless of the package `files` allowlist (which
// does not include `logo.txt` or `src/`). If you edit `logo.txt`, re-inline it
// here (keep the two in sync — `npm run check`/tests guard the art's shape, not
// its byte-equality to logo.txt).
//
// Color comes from the shared brand-token ANSI map via theme.ts (brass gold
// #eba92c); this module is content only. Suppression (--no-art / NO_COLOR) and
// width selection live in theme.ts's bannerLine().

/**
 * Full register wordmark — inlined from `logo.txt` (repo root, editable source).
 * Widest line is 76 cols; bannerLine() falls back to the compact variant below
 * the full-banner min width.
 */
export const LOGO_FULL = `  $$$$$$\\  $$\\                            $$\\       $$\\
 $$  __$$\\ $$ |                           $$ |      \\__|
 $$ /  \\__|$$$$$$$\\   $$$$$$\\   $$$$$$$\\ $$$$$$\\    $$\\ $$$$$$$\\   $$$$$$\\
 $$ |      $$  __$$\\  \\____$$\\ $$  _____|\\_$$  _|   $$ |$$  __$$\\ $$  __$$\\
 $$ |      $$ |  $$ | $$$$$$$ |$$ /        $$ |     $$ |$$ |  $$ |$$ /  $$ |
 $$ |  $$\\ $$ |  $$ |$$  __$$ |$$ |        $$ |$$\\  $$ |$$ |  $$ |$$ |  $$ |
 \\$$$$$$  |$$ |  $$ |\\$$$$$$$ |\\$$$$$$$\\   \\$$$$  | $$ |$$ |  $$ |\\$$$$$$$ |
  \\______/ \\__|  \\__| \\_______| \\_______|   \\____/  \\__|\\__|  \\__| \\____$$ |
                                                                  $$\\   $$ |
  the register that counts the cache hits too                     \\$$$$$$  |
                                                                   \\______/`;

/** Widest line in {@link LOGO_FULL} — the min terminal width to render it. */
export const LOGO_FULL_MIN_COLS = 76;

/**
 * Compact wordmark for narrow terminals (< {@link LOGO_FULL_MIN_COLS}). Keeps the
 * dollar-sign register feel + the caching pun in a single short block.
 */
export const LOGO_COMPACT = `$$ chaching
─ the register that counts the cache hits too`;
