import { stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';

export async function safeMtime(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return null;
	}
}

export function expandPath(path: string): string {
	if (path === '~') return homedir();
	if (path.startsWith(`~${sep}`)) return join(homedir(), path.slice(2));
	return path;
}
