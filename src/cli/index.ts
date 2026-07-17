// CLI entry point — dispatches to subcommand handlers.
// Imports the built SvelteKit server for `serve`.
// No third-party arg-parser: hand-rolled per D3.

import { run } from './router.js';

// Top-level catch: expected operational failures (bad Postgres URL, unreachable
// database, invalid flags) print a single actionable line, never a raw stack trace.
try {
	await run(process.argv.slice(2));
} catch (cause) {
	const message = cause instanceof Error ? cause.message : String(cause);
	process.stderr.write(`chaching: ${message}\n`);
	process.exit(1);
}
