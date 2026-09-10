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
} from './subscription-presets';
import { SUBSCRIPTION_PRESETS } from './subscription-presets';
import type { Account, PrivateAccount } from './accounts';

export const CONFIG_VERSION = 1;


export interface ClaudeProviderConfig {
	enabled: boolean;
	roots: string[];
}

export interface CodexProviderConfig {
	enabled: boolean;
	root: string;
}

/**
 * Pi and Oh My Pi share the same version-3 JSONL session format, so one reader
 * covers both roots. Default ON, like the other local-log providers
 * (claude/codex/opencode); disable with `{"providers":{"pi":{"enabled":false}}}`.
 *
 * TODO(subscription): Pi has no subscription/subsidy block yet. Unlike Claude/Codex
 * — whose spend is a single homogeneous subscription stream — a Pi session mixes
 * subscription (Anthropic OAuth), pay-as-you-go API (e.g. zai), and Zen/Go usage in
 * one log, so subsidising ALL of it against one flat fee would be dishonest. When it
 * is wired, `~/.pi/agent/auth.json` (`anthropic.type === "oauth"` vs `"api_key"`) is
 * the signal for whether the Anthropic slice is subscription-backed. Left as a
 * documented gap rather than an unwired dead config field (see SUBSIDISED_PROVIDERS).
 */
export interface PiProviderConfig {
	enabled: boolean;
	roots: string[];
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

export interface HistoryConfig {
	enabled: boolean;
	dbPath: string;
}

export interface TokenmaxxConfig {
	enabled: boolean;
	dbPath: string;
}

export interface SyncConfig {
	enabled: boolean;
	/** PostgreSQL connection string. Secret: never expose through publicConfig(). */
	databaseUrl: string;
	poolId: string | null;
	machineId: string | null;
	machineName: string;
	/** Local ingestion attribution: harness provider -> pooled subscription id. */
	providerSubscriptions: Record<string, string | null>;
	/**
	 * Wall-clock-aligned sync burst cadence in minutes (min 1, default 15). Every pooled
	 * machine fires on the SAME aligned instants (epoch-grid multiples of this interval,
	 * hour-aligned for divisors of 60) plus a small jitter, so their PostgreSQL traffic
	 * lands in one narrow window and Neon's scale-to-zero engages between bursts.
	 */
	intervalMinutes: number;
}

export interface chachingConfig {
	version: number;
	accounts: PrivateAccount[];
	providerAccounts: Record<string, string[]>;
	cutoverTs: number | null;
	server: {
		host: string;
		port: number;
		/** Public origin for the web server (adapter-node ORIGIN), e.g. when behind a
		 *  reverse proxy: "https://chaching.example.com". Empty = let the adapter infer
		 *  it. The ORIGIN env var, if set, wins over this. */
		origin: string;
	};
	history: HistoryConfig;
	tokenmaxx: TokenmaxxConfig;
	sync: SyncConfig;
	providers: {
		claude: ClaudeProviderConfig;
		codex: CodexProviderConfig;
		cursor: CursorProviderConfig;
		opencode: OpenCodeProviderConfig;
		pi: PiProviderConfig;
	};
}

export interface PublicchachingConfig extends Omit<chachingConfig, 'providers' | 'history' | 'sync' | 'accounts'> {
	accounts: Account[];
	history: HistoryConfig;
	tokenmaxx: TokenmaxxConfig;
	sync: Omit<SyncConfig, 'databaseUrl'> & { databaseConfigured: boolean };
	providers: {
		claude: ClaudeProviderConfig;
		codex: CodexProviderConfig;
		cursor: Omit<CursorProviderConfig, 'adminApiToken'> & { adminApiTokenConfigured: boolean };
		opencode: OpenCodeProviderConfig;
		pi: PiProviderConfig;
	};
}

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
			providerSubscriptions: {},
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
			providerSubscriptions: nullableStringRecord(sync.providerSubscriptions),
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
			providerSubscriptions: { ...cfg.sync.providerSubscriptions },
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

export async function updateConfig(change: (config: chachingConfig) => chachingConfig): Promise<chachingConfig> {
	return withConfigLock(async () => {
		let raw: string | null = null;
		try { raw = await readFile(configFilePath(), 'utf8'); }
		catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
		const parsed: unknown = raw === null ? null : JSON.parse(raw);
		const current = raw === null ? defaultConfig() : normalizeConfig(parsed);
		const normalized = normalizeConfig(change(current));
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

function nullableStringRecord(value: unknown): Record<string, string | null> {
	const raw = objectRecord(value);
	const result: Record<string, string | null> = {};
	for (const [key, item] of Object.entries(raw)) {
		if (typeof item === 'string' || item === null) result[key] = item;
	}
	return result;
}
