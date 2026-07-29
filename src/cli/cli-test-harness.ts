// Shared harness for the subprocess CLI smoke tests (receipt / wrapped / whatif /
// router / serve).
//
// WHY THIS EXISTS: these tests spawn the real CLI bundle, and the CLI's cold scan
// reads whatever the *developer's* machine happens to hold under `~/.claude`,
// `~/.codex`, the OpenCode DB, and the history DB. On a machine with a real
// working set that scan took ~17s per invocation; ~30 invocations running
// concurrently under vitest blew past the 45s execFile timeout and the suite went
// red for reasons that had nothing to do with the code under test. It was also
// non-deterministic: assertions were written as "real data OR empty state"
// precisely because nobody could predict which one they'd get.
//
// The fix is a hermetic fixture. `XDG_CONFIG_HOME` relocates the config file
// (config.ts::configFilePath), and the config's `providers.claude.roots` is what
// the engine turns into CLAUDE_CONFIG_DIR (engine.ts), so one generated
// config.json pins every provider. We disable codex/opencode/pi/cursor/sync +
// history entirely and point Claude at a small seeded transcript.
//
// NOTE we seed REAL records rather than pointing at an empty dir. An empty ledger
// would make the loop-body assertions in whatif-cli.test.ts vacuous — a check that
// cannot fail has not passed. The seed uses priced models so costs resolve to
// numbers, exercising the honest-total paths for real.
//
// We deliberately do NOT override HOME: `node` is commonly a version-manager shim
// (asdf/nvm) that resolves its real binary through $HOME, so clobbering it makes
// the child exit 126 before the CLI ever runs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
/** The tsup-built CLI bundle (`pretest` guarantees it exists). */
export const cliBundle = join(repoRoot, 'dist', 'cli', 'index.js');
/** The real launcher, including its one-shot force-exit logic. */
export const binLauncher = join(repoRoot, 'bin', 'chaching.js');

/** A priced model, so seeded records produce a real (non-null) cost. */
export const FIXTURE_MODEL = 'claude-sonnet-4-6';
export const FIXTURE_ALT_MODEL = 'claude-opus-4-8';
export const FIXTURE_PROJECT = '/fixture/project';
export const FIXTURE_SESSION = 'fixture-session-0001';

function isoDayUTC(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function assistantLine(opts: {
	n: number;
	ts: Date;
	model: string;
}): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: opts.ts.toISOString(),
		requestId: `req_fixture_${opts.n}`,
		sessionId: FIXTURE_SESSION,
		isSidechain: false,
		cwd: FIXTURE_PROJECT,
		message: {
			id: `msg_fixture_${opts.n}`,
			model: opts.model,
			usage: {
				input_tokens: 1_000 + opts.n,
				output_tokens: 500 + opts.n,
				cache_creation_input_tokens: 2_000,
				cache_read_input_tokens: 10_000
			}
		}
	});
}

export interface Fixture {
	/** Env to merge into every spawned CLI process. */
	env: NodeJS.ProcessEnv;
	/** Root of the throwaway fixture tree (for cleanup). */
	dir: string;
	/** UTC days the seed covers, most recent last. */
	days: string[];
	cleanup(): void;
}

/**
 * Build a throwaway, fully-pinned data root and return the env that points the
 * CLI at it. Seeds `days` UTC days (ending today) of Claude transcript records so
 * period-scoped output is non-empty and deterministic.
 *
 * Call once per test file (module scope) and pass `fixture.env` to `runCli`.
 */
export function createCliFixture(opts: { days?: number } = {}): Fixture {
	const dayCount = opts.days ?? 3;
	const dir = mkdtempSync(join(tmpdir(), 'chaching-cli-fixture-'));

	const claudeRoot = join(dir, 'claude');
	const projectsDir = join(claudeRoot, 'projects', '-fixture-project');
	mkdirSync(projectsDir, { recursive: true });

	const days: string[] = [];
	const lines: string[] = [];
	let n = 0;
	for (let back = dayCount - 1; back >= 0; back--) {
		// Midday UTC keeps the record inside its intended UTC day regardless of the
		// runner's local timezone.
		const ts = new Date(Date.now() - back * 86_400_000);
		ts.setUTCHours(12, 0, 0, 0);
		days.push(isoDayUTC(ts));
		lines.push(assistantLine({ n: n++, ts, model: FIXTURE_MODEL }));
		lines.push(assistantLine({ n: n++, ts, model: FIXTURE_ALT_MODEL }));
	}
	writeFileSync(join(projectsDir, `${FIXTURE_SESSION}.jsonl`), lines.join('\n') + '\n');

	// History is disabled outright: freezing writes a SQLite DB, and a test run
	// must never touch the developer's real ~/.local/share/chaching/history.db.
	const configDir = join(dir, 'xdg', 'chaching');
	mkdirSync(configDir, { recursive: true });
	writeFileSync(
		join(configDir, 'config.json'),
		JSON.stringify(
			{
				history: { enabled: false, dbPath: join(dir, 'history.db') },
				sync: { enabled: false, databaseUrl: '' },
				providers: {
					claude: { enabled: true, roots: [claudeRoot] },
					codex: { enabled: false, root: join(dir, 'no-codex') },
					cursor: { enabled: false, adminApiToken: '' },
					opencode: { enabled: false, dbPath: join(dir, 'no-opencode.db') },
					pi: { enabled: false, roots: [] }
				}
			},
			null,
			2
		)
	);

	return {
		dir,
		days,
		env: {
			XDG_CONFIG_HOME: join(dir, 'xdg'),
			// Belt-and-braces: the engine derives this from the config, but any code
			// path that reads the ambient env must not fall back to the real ~/.claude.
			CLAUDE_CONFIG_DIR: claudeRoot,
			CHACHING_DATABASE_URL: ''
			// Deliberately NOT setting NO_COLOR/CHACHING_NO_ART here: the colour- and
			// art-discipline tests assert those behaviours, and pre-setting them would
			// make those assertions pass for the wrong reason.
		},
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** Run any node entrypoint with the fixture env applied. */
export async function runNode(
	entry: string,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv; fixture?: Fixture } = {}
): Promise<RunResult> {
	try {
		const { stdout, stderr } = await exec('node', [entry, ...args], {
			timeout: 45_000,
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, ...opts.fixture?.env, ...opts.env }
		});
		return { stdout, stderr, code: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
		// execFile reports a timeout kill with code undefined; surface it loudly
		// instead of letting it masquerade as an ordinary non-zero exit.
		if (e.killed && e.code === undefined) {
			throw new Error(
				`CLI timed out after 45s: node ${entry} ${args.join(' ')}\n${e.stderr ?? ''}`
			);
		}
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
	}
}

/** Run the built CLI bundle with the fixture env applied. */
export function runCliWith(
	fixture: Fixture,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<RunResult> {
	return runNode(cliBundle, args, { ...opts, fixture });
}
