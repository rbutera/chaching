// `chaching mcp` — a local, read-only MCP server over stdio (task 1.1, 2.1).
//
// Holds ONE live `createEngine()` for the process lifetime, exactly like `serve`
// (design decision 1): the stdio transport keeps the process alive, so this
// command is exempt from the launcher's force-exit (see bin/chaching.js). Tool
// calls answer from the latest engine snapshot — the same freshness model as the
// web dashboard and TUI, no second accounting path.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngine } from '../../lib/core/engine.js';
import { getReportAccountContext } from '../../lib/core/sync/manager.js';
import { packageVersion } from '../help.js';
import { registerTools, type ToolContext } from './tools.js';

/**
 * Start the stdio MCP server. Resolves once connected (like `serve`, whose socket
 * outlives the promise) — the stdin handle then keeps the process alive. The
 * launcher must NOT force-exit this command.
 */
export async function runMcp(): Promise<void> {
	const { config: cfg } = await getReportAccountContext();
	const engine = createEngine(cfg);
	await engine.ensureStarted();

	const server = new McpServer({ name: 'chaching', version: packageVersion() });

	// Fresh context per tool call: the latest snapshot + live provider-health map.
	const getContext = async (): Promise<ToolContext> => ({
		snapshot: engine.snapshot(),
		subsidyConfig: (await getReportAccountContext()).fees,
		providerErrors: engine.stats.providerErrors,
		now: Date.now()
	});
	registerTools(server, getContext);

	const transport = new StdioServerTransport();
	// Client closed stdin (or the SDK closed the transport): tear the engine down and
	// exit cleanly so no watcher/timer lingers.
	transport.onclose = () => {
		engine.dispose();
		process.exit(0);
	};
	const shutdown = () => {
		engine.dispose();
		process.exit(0);
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);

	await server.connect(transport);
}
