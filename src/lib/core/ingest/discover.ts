// Discover Claude Code transcript files. READ-ONLY: this module never writes,
// moves, or deletes anything under the Claude data dirs.
//
// Resolution order for roots:
//   - CLAUDE_CONFIG_DIR (single path or comma-separated list) overrides everything
//   - else ~/.config/claude (XDG) if it exists, AND ~/.claude
// Within each root we glob `projects/**/*.jsonl`, which naturally sweeps up
// `<session>/subagents/agent-*.jsonl` subagent files too.

import { homedir } from 'node:os';
import { join, sep, basename } from 'node:path';
import { readdir, stat } from 'node:fs/promises';

export interface DiscoveredFile {
	path: string;
	/** decoded project dir name, e.g. "/Users/rai/focused" from "-Users-rai-focused" */
	project: string;
	isSidechain: boolean;
}

/** Resolve the set of config roots to search (the dirs that CONTAIN a `projects/`). */
export function resolveRoots(env: NodeJS.ProcessEnv = process.env): string[] {
	const override = env.CLAUDE_CONFIG_DIR?.trim();
	if (override) {
		return override
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean);
	}
	const home = homedir();
	return [join(home, '.config', 'claude'), join(home, '.claude')];
}

async function isDir(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

/** Decode an encoded project dir name back to a readable cwd-ish path. */
export function decodeProject(encoded: string): string {
	// Claude encodes the cwd by replacing path separators with '-' and a leading
	// '-' for the root. We can't perfectly invert (dashes in real names collide),
	// so present a best-effort readable form: strip the leading dash, swap '-' to '/'.
	if (!encoded.startsWith('-')) return encoded;
	return '/' + encoded.slice(1).split('-').join('/');
}

async function walkJsonl(dir: string, out: string[]): Promise<void> {
	let entries: import('node:fs').Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walkJsonl(full, out);
		} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
			out.push(full);
		}
	}
}

/** Discover every transcript file across all resolved roots' `projects/` dirs. */
export async function discoverFiles(env: NodeJS.ProcessEnv = process.env): Promise<DiscoveredFile[]> {
	const roots = resolveRoots(env);
	const result: DiscoveredFile[] = [];
	const seen = new Set<string>();

	for (const root of roots) {
		const projectsDir = join(root, 'projects');
		if (!(await isDir(projectsDir))) continue;

		const files: string[] = [];
		await walkJsonl(projectsDir, files);

		for (const path of files) {
			if (seen.has(path)) continue;
			seen.add(path);
			result.push({
				path,
				project: projectForFile(projectsDir, path),
				// subagent files live under .../<session>/subagents/agent-*.jsonl
				isSidechain: path.includes(`${sep}subagents${sep}`) || basename(path).startsWith('agent-')
			});
		}
	}
	return result;
}

/** The watched `projects/` directories (for fs.watch). */
export async function resolveProjectsDirs(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
	const dirs: string[] = [];
	for (const root of resolveRoots(env)) {
		const projectsDir = join(root, 'projects');
		if (await isDir(projectsDir)) dirs.push(projectsDir);
	}
	return dirs;
}

function projectForFile(projectsDir: string, filePath: string): string {
	const rel = filePath.slice(projectsDir.length + 1);
	const encoded = rel.split(sep)[0] ?? '';
	return decodeProject(encoded);
}
