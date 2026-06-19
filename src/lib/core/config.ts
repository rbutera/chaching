import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

export interface ClaudeProviderConfig {
	enabled: boolean;
	roots: string[];
}

export interface CodexProviderConfig {
	enabled: boolean;
	root: string;
}

export interface CursorProviderConfig {
	enabled: boolean;
	adminApiToken: string;
	email: string | null;
	pollSeconds: number;
}

export interface OpenCodeProviderConfig {
	enabled: boolean;
	dbPath: string;
}

export interface chachingConfig {
	cutoverTs: number | null;
	server: {
		host: string;
		port: number;
	};
	providers: {
		claude: ClaudeProviderConfig;
		codex: CodexProviderConfig;
		cursor: CursorProviderConfig;
		opencode: OpenCodeProviderConfig;
	};
}

export interface PublicchachingConfig extends Omit<chachingConfig, 'providers'> {
	providers: {
		claude: ClaudeProviderConfig;
		codex: CodexProviderConfig;
		cursor: Omit<CursorProviderConfig, 'adminApiToken'> & { adminApiTokenConfigured: boolean };
		opencode: OpenCodeProviderConfig;
	};
}

export interface ConfigPathInput {
	env?: Pick<NodeJS.ProcessEnv, 'XDG_CONFIG_HOME'>;
	homeDir?: string;
}

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 5178;
const DEFAULT_CURSOR_POLL_SECONDS = 3600;

let cache: chachingConfig | null = null;

export function configFilePath(input: ConfigPathInput = {}): string {
	const home = input.homeDir ?? homedir();
	const env = input.env ?? process.env;
	const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
	return join(configHome, 'chaching', 'config.json');
}

export function defaultConfig(): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: DEFAULT_HOST, port: DEFAULT_PORT },
		providers: {
			claude: { enabled: true, roots: ['~/.claude', '~/.config/claude'] },
			codex: { enabled: true, root: '~/.codex/sessions' },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: DEFAULT_CURSOR_POLL_SECONDS },
			opencode: { enabled: true, dbPath: '~/.local/share/opencode/opencode.db' }
		}
	};
}

export function normalizeConfig(raw: unknown): chachingConfig {
	const defaults = defaultConfig();
	const root = objectRecord(raw);
	const providers = objectRecord(root.providers);
	const server = objectRecord(root.server);
	const claude = objectRecord(providers.claude);
	const codex = objectRecord(providers.codex);
	const cursor = objectRecord(providers.cursor);
	const opencode = objectRecord(providers.opencode);

	return {
		cutoverTs: numberOrNull(root.cutoverTs),
		server: {
			host: stringOr(server.host, defaults.server.host),
			port: positiveIntOr(server.port, defaults.server.port)
		},
		providers: {
			claude: {
				enabled: booleanOr(claude.enabled, defaults.providers.claude.enabled),
				roots: stringArrayOr(claude.roots, defaults.providers.claude.roots)
			},
			codex: {
				enabled: booleanOr(codex.enabled, defaults.providers.codex.enabled),
				root: stringOr(codex.root, defaults.providers.codex.root)
			},
			cursor: {
				enabled: booleanOr(cursor.enabled, defaults.providers.cursor.enabled),
				adminApiToken: stringOr(cursor.adminApiToken, defaults.providers.cursor.adminApiToken),
				email: nullableStringOr(cursor.email, defaults.providers.cursor.email),
				pollSeconds: positiveIntOr(cursor.pollSeconds, defaults.providers.cursor.pollSeconds)
			},
			opencode: {
				enabled: booleanOr(opencode.enabled, defaults.providers.opencode.enabled),
				dbPath: stringOr(opencode.dbPath, defaults.providers.opencode.dbPath)
			}
		}
	};
}

export function publicConfig(cfg: chachingConfig): PublicchachingConfig {
	return {
		cutoverTs: cfg.cutoverTs,
		server: { ...cfg.server },
		providers: {
			claude: { ...cfg.providers.claude, roots: [...cfg.providers.claude.roots] },
			codex: { ...cfg.providers.codex },
			cursor: {
				enabled: cfg.providers.cursor.enabled,
				email: cfg.providers.cursor.email,
				pollSeconds: cfg.providers.cursor.pollSeconds,
				adminApiTokenConfigured: cfg.providers.cursor.adminApiToken.length > 0
			},
			opencode: { ...cfg.providers.opencode }
		}
	};
}

export async function loadConfig(): Promise<chachingConfig> {
	if (cache) return cache;
	try {
		const raw = await readFile(configFilePath(), 'utf8');
		const parsed: unknown = JSON.parse(raw);
		cache = normalizeConfig(parsed);
	} catch {
		cache = defaultConfig();
	}
	return cache;
}

export async function saveConfig(cfg: chachingConfig): Promise<void> {
	cache = normalizeConfig(cfg);
	try {
		const file = configFilePath();
		await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
		await writeFile(file, JSON.stringify(cache, null, 2), { encoding: 'utf8', mode: 0o600 });
		await chmod(file, 0o600);
	} catch {
		return;
	}
}

export async function configFileMode(): Promise<number | null> {
	try {
		return (await stat(configFilePath())).mode & 0o777;
	} catch {
		return null;
	}
}

function objectRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function nullableStringOr(value: unknown, fallback: string | null): string | null {
	if (value === null) return null;
	return typeof value === 'string' ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveIntOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const strings = value.filter((item) => typeof item === 'string' && item.length > 0);
	return strings.length > 0 ? strings : fallback;
}
