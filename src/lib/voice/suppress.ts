/**
 * Suppression predicates — the ONE contract across surfaces.
 *
 * Framework-free: env is passed explicitly (an `EnvLike` record, never read off
 * `process` here so the module stays importable in the browser). The CLI wrappers
 * in `personality.ts` default these to `process.env`; the web passes its own
 * runtime equivalent.
 *
 * `--no-art` / `CHACHING_NO_ART` / `NO_COLOR` suppress personality; the `--json`
 * and `/api/*` data paths never call into the voice module at all.
 */

export type EnvLike = Record<string, string | undefined>;

/** True if decorative art/personality should be omitted entirely. */
export function noArt(argv: readonly string[] = [], env: EnvLike = {}): boolean {
	if (env.CHACHING_NO_ART !== undefined && env.CHACHING_NO_ART !== '') return true;
	return argv.includes('--no-art');
}

/** True if color output should be stripped (https://no-color.org). */
export function noColor(env: EnvLike = {}): boolean {
	return env.NO_COLOR !== undefined && env.NO_COLOR !== '';
}
