// CLI entry point — dispatches to subcommand handlers.
// Imports the built SvelteKit server for `serve`.
// No third-party arg-parser: hand-rolled per D3.

import { run } from './router.js';

await run(process.argv.slice(2));
