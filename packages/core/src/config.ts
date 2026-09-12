import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod, link, mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Subscription plan constants live in the client-safe subscription-presets.ts
 * (no Node imports) because browser components consume them; re-exported here
 * so server-side config consumers keep one import surface.
 */
export {
	SUBSCRIPTION_PRESETS,
	type SubscriptionConfig,
	type SubscriptionPreset
} from '@chaching/shared/subscription-presets';
import { SUBSCRIPTION_PRESETS } from '@chaching/shared/subscription-presets';
import type { Account, PrivateAccount } from '@chaching/shared/accounts';

export const CONFIG_VERSION = 1;


import type { ClaudeProviderConfig, CodexProviderConfig, PiProviderConfig, CursorProviderConfig, OpenCodeProviderConfig, HistoryConfig, TokenmaxxConfig, SyncConfig, chachingConfig, PublicchachingConfig } from '@chaching/shared/config';
export type { ClaudeProviderConfig, CodexProviderConfig, PiProviderConfig, CursorProviderConfig, OpenCodeProviderConfig, HistoryConfig, TokenmaxxConfig, SyncConfig, chachingConfig, PublicchachingConfig } from '@chaching/shared/config';

export interface ConfigPathInput {
	env?: Pick<NodeJS.ProcessEnv, 'XDG_CONFIG_HOME'>;
	homeDir?: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5178;
const DEFAULT_CURSOR_POLL_SECONDS = 3600;
const DEFAULT_HISTORY_DB_PATH = '~/.local/share/chaching/history.db';
const DEFAULT_TOKENMAXX_DB_PATH = '~/.tokenmaxx/state.sqlite';
const LEGACY_DEFAULT_PI_ROOT = '~/.pi/agent/sessions';
export const DEFAULT_PI_SESSION_ROOTS = [
	LEGACY_DEFAULT_PI_ROOT,
	'~/.omp/agent/sessions'
] as const;

let cache: chachingConfig | null = null;

export function configFilePath(input: ConfigPathInput = {}): string {
	const home = input.homeDir ?? homedir();
	const env = input.env ?? process.env;
	const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
	return join(configHome, 'chaching', 'config.json');
}

export function defaultConfig(): chachingConfig {
	return {
		version: CONFIG_VERSION,
		accounts: [],
		providerAccounts: {},
		cutoverTs: null,
		server: { host: DEFAULT_HOST, port: DEFAULT_PORT, origin: '' },
		history: { enabled: true, dbPath: DEFAULT_HISTORY_DB_PATH },
		tokenmaxx: { enabled: true, dbPath: DEFAULT_TOKENMAXX_DB_PATH },
		sync: {
			enabled: false,
			databaseUrl: '',
			poolId: null,
			machineId: null,
			machineName: '',
			intervalMinutes: 15
		},
		providers: {
			claude: {
				enabled: true,
				roots: ['~/.claude', '~/.config/claude']
			},
			codex: { enabled: true, root: '~/.codex/sessions' },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: DEFAULT_CURSOR_POLL_SECONDS },
			opencode: { enabled: true, dbPath: '~/.local/share/opencode/opencode.db' },
			pi: { enabled: true, roots: [...DEFAULT_PI_SESSION_ROOTS] }
		}
	};
}

export function normalizeConfig(raw: unknown): chachingConfig {
	const defaults = defaultConfig();
	const root = objectRecord(raw);
	if (root.version !== undefined && root.version !== CONFIG_VERSION) {
		throw new Error(`Unsupported config version ${String(root.version)}; expected ${CONFIG_VERSION}. Upgrade chaching before editing this config.`);
	}
	const providers = objectRecord(root.providers);
	const server = objectRecord(root.server);
	const history = objectRecord(root.history);
	const tokenmaxx = objectRecord(root.tokenmaxx);
	const sync = objectRecord(root.sync);
	const claude = objectRecord(providers.claude);
	const codex = objectRecord(providers.codex);
	const cursor = objectRecord(providers.cursor);
	const opencode = objectRecord(providers.opencode);
	const pi = objectRecord(providers.pi);

	const { accounts, providerAccounts } = normalizeAccounts(root);
	return {
		version: CONFIG_VERSION,
		accounts,
		providerAccounts,
		cutoverTs: numberOrNull(root.cutoverTs),
		server: {
			host: stringOr(server.host, defaults.server.host),
			port: positiveIntOr(server.port, defaults.server.port),
			origin: stringOr(server.origin, defaults.server.origin)
		},
		history: {
			enabled: booleanOr(history.enabled, defaults.history.enabled),
			dbPath: stringOr(history.dbPath, defaults.history.dbPath)
		},
		tokenmaxx: {
			enabled: booleanOr(tokenmaxx.enabled, defaults.tokenmaxx.enabled),
			dbPath: stringOr(tokenmaxx.dbPath, defaults.tokenmaxx.dbPath)
		},
		sync: {
			enabled: booleanOr(sync.enabled, defaults.sync.enabled),
			databaseUrl: stringOrEmpty(sync.databaseUrl, defaults.sync.databaseUrl),
			poolId: nullableStringOr(sync.poolId, defaults.sync.poolId),
			machineId: nullableStringOr(sync.machineId, defaults.sync.machineId),
			machineName: stringOrEmpty(sync.machineName, defaults.sync.machineName),
			intervalMinutes: positiveIntOr(sync.intervalMinutes, defaults.sync.intervalMinutes)
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
			},
			pi: {
				enabled: booleanOr(pi.enabled, defaults.providers.pi.enabled),
				roots: normalizePiRoots(pi)
			}
		}
	};
}

export function publicConfig(cfg: chachingConfig): PublicchachingConfig {
	return {
		version: cfg.version,
		accounts: cfg.accounts.map(({ id, provider, name, tier, monthlyUsd, feeSource, pendingLegacyIds }) => ({ id, provider, name, tier, monthlyUsd, feeSource, ...(pendingLegacyIds?.length ? { pendingLegacyIds: [...pendingLegacyIds] } : {}) })),
		providerAccounts: Object.fromEntries(Object.entries(cfg.providerAccounts).map(([provider, ids]) => [provider, [...ids]])),
		cutoverTs: cfg.cutoverTs,
		server: { ...cfg.server },
		history: { ...cfg.history },
		tokenmaxx: { ...cfg.tokenmaxx },
		sync: {
			enabled: cfg.sync.enabled,
			poolId: cfg.sync.poolId,
			machineId: cfg.sync.machineId,
			machineName: cfg.sync.machineName,
			intervalMinutes: cfg.sync.intervalMinutes,
			databaseConfigured: cfg.sync.databaseUrl.length > 0
		},
		providers: {
			claude: {
				...cfg.providers.claude,
				roots: [...cfg.providers.claude.roots]
			},
			codex: { ...cfg.providers.codex },
			cursor: {
				enabled: cfg.providers.cursor.enabled,
				email: cfg.providers.cursor.email,
				pollSeconds: cfg.providers.cursor.pollSeconds,
				adminApiTokenConfigured: cfg.providers.cursor.adminApiToken.length > 0
			},
			opencode: { ...cfg.providers.opencode },
			pi: { ...cfg.providers.pi, roots: [...cfg.providers.pi.roots] }
		}
	};
}

let loading: Promise<chachingConfig> | null = null;

export async function loadConfig(): Promise<chachingConfig> {
	if (cache) return cache;
	if (loading) return loading;
	loading = readConfig();
	try { return await loading; } finally { loading = null; }
}

async function readConfig(): Promise<chachingConfig> {
	let raw: string;
	try { raw = await readFile(configFilePath(), 'utf8'); }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return cache = defaultConfig();
		throw error;
	}
	const parsed: unknown = JSON.parse(raw);
	if (objectRecord(parsed).version === undefined) {
		return withConfigLock(async () => {
			const latest = await readFile(configFilePath(), 'utf8');
			const current: unknown = JSON.parse(latest);
			const normalized = normalizeConfig(current);
			if (objectRecord(current).version === undefined) {
				await writeConfigFile(`${configFilePath()}.pre-accounts`, latest, true);
				await writeConfigFile(configFilePath(), JSON.stringify(normalized, null, 2));
			}
			return cache = normalized;
		});
	}
	return cache = normalizeConfig(parsed);
}

export async function updateConfig(change: (config: chachingConfig) => chachingConfig | Promise<chachingConfig>): Promise<chachingConfig> {
	return withConfigLock(async () => {
		let raw: string | null = null;
		try { raw = await readFile(configFilePath(), 'utf8'); }
		catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
		const parsed: unknown = raw === null ? null : JSON.parse(raw);
		const current = raw === null ? defaultConfig() : normalizeConfig(parsed);
		const normalized = normalizeConfig(await change(current));
		if (raw !== null && objectRecord(parsed).version === CONFIG_VERSION && JSON.stringify(normalized) === JSON.stringify(current)) return cache = normalized;
		if (raw !== null && objectRecord(parsed).version === undefined) await writeConfigFile(`${configFilePath()}.pre-accounts`, raw, true);
		await writeConfigFile(configFilePath(), JSON.stringify(normalized, null, 2));
		return cache = normalized;
	});
}

async function withConfigLock<T>(work: () => Promise<T>): Promise<T> {
	const lock = `${configFilePath()}.lock`;
	await mkdir(join(configFilePath(), '..'), { recursive: true, mode: 0o700 });
	for (let attempt = 0; ; attempt++) {
		try { await mkdir(lock, { mode: 0o700 }); break; }
		catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
			if (attempt === 100) throw new Error(`Config is locked: ${lock}. Stop other chaching processes; if none are running, remove this lock directory and retry.`);
			await delay(50);
		}
	}
	// ponytail: a killed writer leaves its lock; clear it only after stopping all config writers.
	try { return await work(); } finally { await rmdir(lock); }
}

async function writeConfigFile(file: string, contents: string, exclusive = false): Promise<void> {
	const dir = join(file, '..');
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const tmp = join(dir, `.chaching-${randomBytes(6).toString('hex')}.tmp`);
	try {
		await writeFile(tmp, contents, { encoding: 'utf8', mode: 0o600 });
		await chmod(tmp, 0o600);
		if (exclusive) {
			try { await link(tmp, file); }
			catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
			}
		} else {
			await rename(tmp, file);
			await chmod(file, 0o600);
		}
	} finally {
		await unlink(tmp).catch(() => {});
	}
}

/** Invalidate the in-memory config cache (useful after external config edits or re-init). */
export function clearConfigCache(): void {
	cache = null;
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

function stringOrEmpty(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
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

function normalizeAccounts(root: Record<string, unknown>): Pick<chachingConfig, 'accounts' | 'providerAccounts'> {
	const accounts: PrivateAccount[] = [];
	const providerAccounts: Record<string, string[]> = {};
	if (root.version === undefined) {
		const providers = objectRecord(root.providers);
		const mappings = objectRecord(objectRecord(root.sync).providerSubscriptions);
		for (const provider of ['claude', 'codex'] as const) {
			const subscription = objectRecord(objectRecord(providers[provider]).subscription);
			const mappedId = nullableStringOr(mappings[provider], null);
			if (!Object.keys(subscription).length && !mappedId) continue;
			const tier = stringOr(subscription.tier, 'unknown');
			const fee = numberOrNull(subscription.monthlyUsd);
			const explicit = fee !== null && fee >= 0;
			const id = mappedId ?? randomUUID();
			accounts.push({
				id, provider, name: provider === 'claude' ? 'Claude' : 'Codex', tier,
				monthlyUsd: explicit ? fee : SUBSCRIPTION_PRESETS[provider].find(p => p.id === tier && !p.custom)?.monthlyUsd ?? null,
				feeSource: explicit ? 'explicit' : 'inferred', identity: null, registrations: [], legacy: true
			});
			providerAccounts[provider] = [id];
		}
		return { accounts, providerAccounts };
	}
	if (!Array.isArray(root.accounts)) throw new Error('Invalid Account config: accounts must be an array.');
	for (const value of root.accounts) {
		const account = objectRecord(value);
		if (typeof account.id !== 'string' || !account.id || typeof account.provider !== 'string' || !account.provider ||
			typeof account.name !== 'string' || typeof account.tier !== 'string' ||
			(account.monthlyUsd !== null && (typeof account.monthlyUsd !== 'number' || !Number.isFinite(account.monthlyUsd) || account.monthlyUsd < 0)) ||
			(account.feeSource !== 'explicit' && account.feeSource !== 'inferred') ||
			(account.feeSource === 'explicit' && account.monthlyUsd === null) || accounts.some(a => a.id === account.id)) {
			throw new Error('Invalid Account config: check IDs, provider, tier and monthly fee.');
		}
		let identity: PrivateAccount['identity'] = null;
		if (account.identity !== null && account.identity !== undefined) {
			const raw = objectRecord(account.identity);
			if (typeof raw.accountId !== 'string' || !raw.accountId || (raw.userId !== null && typeof raw.userId !== 'string')) {
				throw new Error('Invalid Account identity.');
			}
			identity = { accountId: raw.accountId, userId: raw.userId };
		}
		accounts.push({ id: account.id, provider: account.provider, name: account.name, tier: account.tier,
			monthlyUsd: account.monthlyUsd, feeSource: account.feeSource, identity,
			...(typeof account.pendingPoolId === 'string' && account.pendingPoolId ? { pendingPoolId: account.pendingPoolId } : {}),
			...(typeof account.privateLabel === 'string' && account.privateLabel ? { privateLabel: account.privateLabel } : {}),
			registrations: stringArrayOr(account.registrations, []), legacy: account.legacy === true,
			...(stringArrayOr(account.pendingLegacyIds, []).length ? { pendingLegacyIds: stringArrayOr(account.pendingLegacyIds, []) } : {}) });
	}
	for (const [provider, ids] of Object.entries(objectRecord(root.providerAccounts))) {
		if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid provider Account links.');
		providerAccounts[provider] = [...new Set(ids)];
	}
	return { accounts, providerAccounts };
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const strings = value.filter((item) => typeof item === 'string' && item.length > 0);
	return strings.length > 0 ? strings : fallback;
}

function normalizePiRoots(pi: Record<string, unknown>): string[] {
	if (Array.isArray(pi.roots)) {
		const roots = pi.roots.filter(
			(item): item is string => typeof item === 'string' && item.length > 0
		);
		if (roots.length > 0) return roots;
	}
	if (typeof pi.root === 'string' && pi.root.length > 0) {
		return pi.root === LEGACY_DEFAULT_PI_ROOT ? [...DEFAULT_PI_SESSION_ROOTS] : [pi.root];
	}
	return [...DEFAULT_PI_SESSION_ROOTS];
}
