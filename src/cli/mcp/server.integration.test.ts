import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// End-to-end smoke test: spawn the BUILT CLI (`node bin/chaching.js mcp`) and drive
// a real MCP handshake over stdio via the SDK client — initialize, tools/list, one
// tools/call — then assert a sane, content-free result. Relies on dist/cli being
// built; the `pretest` hook runs `build:cli`, so it exists under `pnpm test`.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function hasCliBundle(): boolean {
	return existsSync(join(repoRoot, 'dist', 'cli', 'index.js'));
}

describe('mcp server — stdio integration smoke', () => {
	it.runIf(hasCliBundle())(
		'initializes, lists tools, and answers a tools/call over stdio',
		async () => {
			const configHome = await mkdtemp(join(tmpdir(), 'chaching-mcp-test-'));
			const configDir = join(configHome, 'chaching');
			await mkdir(configDir, { recursive: true });
			await writeFile(
				join(configDir, 'config.json'),
				JSON.stringify({
					history: { enabled: false },
					sync: { enabled: false },
					providers: {
						claude: { enabled: false },
						codex: { enabled: false },
						opencode: { enabled: false },
						cursor: { enabled: false },
						pi: { enabled: false }
					}
				})
			);
			const transport = new StdioClientTransport({
				command: process.execPath,
				args: [join(repoRoot, 'bin', 'chaching.js'), 'mcp'],
				cwd: repoRoot,
				env: { XDG_CONFIG_HOME: configHome },
				stderr: 'ignore'
			});
			const client = new Client({ name: 'chaching-smoke', version: '0.0.0' });
			try {
				await client.connect(transport);

				const tools = await client.listTools();
				const names = tools.tools.map((t) => t.name).sort();
				expect(names).toEqual(
					[
						'burn_since',
						'cache_efficiency',
						'provider_status',
						'quote_tokens',
						'spend_today',
						'subscription_headroom',
						'unknown_pricing'
					].sort()
				);

				// A deterministic, environment-independent call: price a hypothetical mix.
				const res = await client.callTool({
					name: 'quote_tokens',
					arguments: { model: 'claude-opus-4-8', input: 1000, output: 1000 }
				});
				const content = res.content as { type: string; text: string }[];
				expect(content[0].type).toBe('text');
				const payload = JSON.parse(content[0].text);
				expect(payload.model).toBe('claude-opus-4-8');
				expect(payload.advisory).toBe(true);
				// Either a real number or the honest null marker — never undefined.
				expect(payload.unknown === false ? typeof payload.cost === 'number' : payload.cost === null).toBe(
					true
				);
			} finally {
				await client.close().catch(() => {});
				await rm(configHome, { recursive: true, force: true });
			}
		},
		30_000
	);
});
