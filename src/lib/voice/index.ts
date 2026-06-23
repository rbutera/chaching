/**
 * chaching shared voice — the single, framework-agnostic source for ALL voiced
 * copy across the three surfaces (web dashboard, Ink TUI, thermal receipt).
 *
 * "The voice is the product." This module owns the copy banks (scanning lines,
 * empty/error states, receipt footers, the block/daily/lifetime escalation
 * ladders), the casing contract, the deterministic-per-bucket selector, and the
 * suppression predicates. It is PLAIN TS: relative imports only, no `$lib` alias,
 * no SvelteKit/Ink runtime, no `process`-coupled core — the Svelte web app, the
 * CLI, and the receipt renderers all import it unchanged.
 *
 * Casing contract (README CONTENT FUNDAMENTALS):
 *   - lowercase  → personality copy (scanning / empty / error / footers / ladder)
 *   - sentence case → functional UI labels + prose (authored at the source)
 *   - UPPERCASE mono → structural tags only (`TOTAL BURN`, `BY MODEL`) via caps()
 * Consumers render verbatim and never re-case.
 *
 * Suppression contract (identical across surfaces): `--no-art` / `CHACHING_NO_ART`
 * / `NO_COLOR` suppress personality; the `--json` and `/api/*` data paths NEVER
 * carry any of it. The predicates here take explicit argv/env so the module stays
 * framework-free; CLI wrappers pass `process.env`.
 */

export * from './copy.js';
export * from './select.js';
export * from './suppress.js';
export * from './casing.js';
export * from './escalation.js';
