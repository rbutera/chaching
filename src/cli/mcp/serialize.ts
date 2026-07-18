// The ONE place the MCP read-only/content-free contract is enforced (task 1.4).
//
// Every tool handler returns a plain aggregate object; it is wrapped into a
// CallToolResult here and NOWHERE else, so no handler can hand-roll a result that
// leaks prompt/transcript text or a filesystem path. The guard walks the whole
// object and throws (fail-closed) if it finds a forbidden key or a path-shaped
// string value — a leak is a bug that must surface in tests, never ship silently.

import { homedir } from 'node:os';

/**
 * Keys a content-free aggregate result must never carry. These are the shapes that
 * would carry raw content or a filesystem location: transcript/prompt text, project
 * or file paths, hostnames/usernames, working dirs, raw session identifiers. Model
 * ids, provider ids, day/period labels, dollar figures, token counts and statuses
 * are all allowed and are what the tools actually return.
 */
const FORBIDDEN_KEYS = new Set([
	'project',
	'projects',
	'path',
	'paths',
	'prompt',
	'prompts',
	'transcript',
	'transcripts',
	'text',
	'content',
	'file',
	'files',
	'filename',
	'cwd',
	'home',
	'host',
	'hostname',
	'user',
	'username',
	'sessionid',
	'sessionids'
]);

/**
 * A string value that names a filesystem location: an absolute POSIX path, a
 * `~`-relative path, or anything containing the current user's home directory.
 * Model ids (`claude-opus-4-8`), provider ids (`cursor-acp`), and ISO day strings
 * (`2026-07-18`) do not match — they carry no leading `/` or `~` and no home dir.
 */
function looksLikePath(value: string): boolean {
	if (value.startsWith('/') || value.startsWith('~')) return true;
	const home = homedir();
	return home.length > 0 && value.includes(home);
}

/** Recursively assert an aggregate result is content-free. Throws on any violation. */
export function assertContentFree(value: unknown, path = 'result'): void {
	if (value == null) return;
	if (typeof value === 'string') {
		if (looksLikePath(value)) {
			throw new Error(`mcp content-free contract: path-like string at ${path}: ${value}`);
		}
		return;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return;
	if (Array.isArray(value)) {
		value.forEach((v, i) => assertContentFree(v, `${path}[${i}]`));
		return;
	}
	if (typeof value === 'object') {
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
				throw new Error(`mcp content-free contract: forbidden key '${key}' at ${path}`);
			}
			assertContentFree(v, `${path}.${key}`);
		}
		return;
	}
	// functions, symbols, bigint: never part of a JSON aggregate — reject.
	throw new Error(`mcp content-free contract: non-serializable ${typeof value} at ${path}`);
}

/**
 * The MCP CallToolResult shape a handler produces (text mirror + structured object).
 * The index signature mirrors the SDK's `CallToolResult` (`_meta` extensibility), so
 * a `toolResult(...)` value is directly assignable to a registerTool callback return.
 */
export interface ToolResult {
	content: { type: 'text'; text: string }[];
	structuredContent: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Wrap a plain aggregate object into a content-free CallToolResult. The object is
 * validated first (assertContentFree), then serialized to JSON once — the same
 * payload is offered as human-readable `content` text and machine-readable
 * `structuredContent`. No `outputSchema` is registered, so the SDK passes
 * structuredContent through unvalidated (see mcp.js validateToolOutput).
 */
export function toolResult(payload: Record<string, unknown>): ToolResult {
	assertContentFree(payload);
	const text = JSON.stringify(payload);
	return {
		content: [{ type: 'text', text }],
		structuredContent: payload
	};
}
