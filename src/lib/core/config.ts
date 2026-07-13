import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

/**
 * A flat subscription plan for a provider whose API-equivalent cost chaching
 * computes (Claude, Codex). `tier` is a preset id or `"custom"`; `monthlyUsd` is
 * the flat fee actually paid that the API value is subsidised against. $0 (Free)
 * is allowed and handled without divide-by-zero (see subsidisation.ts).
 */
export interface SubscriptionConfig {
	tier: string;
	monthlyUsd: number;
}

export interface ClaudeProviderConfig {
	enabled: boolean;
	roots: string[];
	subscription: SubscriptionConfig;
}

export interface CodexProviderConfig {
	enabled: boolean;
	root: string;
	subscription: SubscriptionConfig;
}

/**
 * Pi (and its fork omp — same `~/.pi/agent/sessions` path + JSONL format, so one
 * reader covers both). Default ON, like the other local-log providers
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
	root: string;
}

/** A single selectable subscription preset for a provider. */
export interface SubscriptionPreset {
	/** stable id stored in config (e.g. "corporate", "max-5x", "custom") */
	id: string;
	/** human label for the switcher */
	label: string;
	/** flat monthly fee in USD; ignored for the special `custom` preset (user supplies) */
	monthlyUsd: number;
	/** true for the free-form Custom amount entry (monthlyUsd is a placeholder) */
	custom?: boolean;
}

/** The Corporate $99 default both subsidised providers fall back to. */
export const DEFAULT_SUBSCRIPTION: SubscriptionConfig = { tier: 'corporate', monthlyUsd: 99 };

/**
 * Static preset tables per subsidised provider. The switcher writes the chosen
 * preset's `id` + `monthlyUsd` (or `custom` + the user's number), so a future
 * preset price change never silently rewrites a persisted fee (design D4).
 */
export const SUBSCRIPTION_PRESETS: {
	claude: SubscriptionPreset[];
	codex: SubscriptionPreset[];
} = {
	claude: [
		{ id: 'free', label: 'Free', monthlyUsd: 0 },
		{ id: 'pro', label: 'Pro', monthlyUsd: 20 },
		{ id: 'max-5x', label: 'Max 5×', monthlyUsd: 100 },
		{ id: 'max-20x', label: 'Max 20×', monthlyUsd: 200 },
		{ id: 'team', label: 'Team Premium', monthlyUsd: 100 },
		{ id: 'corporate', label: 'Corporate', monthlyUsd: 99 },
		{ id: 'custom', label: 'Custom', monthlyUsd: 0, custom: true }
	],
	codex: [
		{ id: 'free', label: 'Free', monthlyUsd: 0 },
		{ id: 'go', label: 'Go', monthlyUsd: 8 },
		{ id: 'plus', label: 'Plus', monthlyUsd: 20 },
		{ id: 'pro-5x', label: 'Pro 5×', monthlyUsd: 100 },
		{ id: 'pro-20x', label: 'Pro 20×', monthlyUsd: 200 },
		{ id: 'corporate', label: 'Corporate', monthlyUsd: 99 },
		{ id: 'custom', label: 'Custom', monthlyUsd: 0, custom: true }
	]
};

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

export interface chachingConfig {
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
	providers: {
		claude: ClaudeProviderConfig;
		codex: CodexProviderConfig;
		cursor: CursorProviderConfig;
		opencode: OpenCodeProviderConfig;
		pi: PiProviderConfig;
	};
}

export interface PublicchachingConfig extends Omit<chachingConfig, 'providers' | 'history'> {
	history: HistoryConfig;
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

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 5178;
const DEFAULT_CURSOR_POLL_SECONDS = 3600;
const DEFAULT_HISTORY_DB_PATH = '~/.local/share/chaching/history.db';

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
		server: { host: DEFAULT_HOST, port: DEFAULT_PORT, origin: '' },
		history: { enabled: true, dbPath: DEFAULT_HISTORY_DB_PATH },
		providers: {
			claude: {
				enabled: true,
				roots: ['~/.claude', '~/.config/claude'],
				subscription: { ...DEFAULT_SUBSCRIPTION }
			},
			codex: { enabled: true, root: '~/.codex/sessions', subscription: { ...DEFAULT_SUBSCRIPTION } },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: DEFAULT_CURSOR_POLL_SECONDS },
			opencode: { enabled: true, dbPath: '~/.local/share/opencode/opencode.db' },
			pi: { enabled: true, root: '~/.pi/agent/sessions' }
		}
	};
}

export function normalizeConfig(raw: unknown): chachingConfig {
	const defaults = defaultConfig();
	const root = objectRecord(raw);
	const providers = objectRecord(root.providers);
	const server = objectRecord(root.server);
	const history = objectRecord(root.history);
	const claude = objectRecord(providers.claude);
	const codex = objectRecord(providers.codex);
	const cursor = objectRecord(providers.cursor);
	const opencode = objectRecord(providers.opencode);
	const pi = objectRecord(providers.pi);

	return {
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
		providers: {
			claude: {
				enabled: booleanOr(claude.enabled, defaults.providers.claude.enabled),
				roots: stringArrayOr(claude.roots, defaults.providers.claude.roots),
				subscription: normalizeSubscription(claude.subscription)
			},
			codex: {
				enabled: booleanOr(codex.enabled, defaults.providers.codex.enabled),
				root: stringOr(codex.root, defaults.providers.codex.root),
				subscription: normalizeSubscription(codex.subscription)
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
				root: stringOr(pi.root, defaults.providers.pi.root)
			}
		}
	};
}

export function publicConfig(cfg: chachingConfig): PublicchachingConfig {
	return {
		cutoverTs: cfg.cutoverTs,
		server: { ...cfg.server },
		history: { ...cfg.history },
		providers: {
			claude: {
				...cfg.providers.claude,
				roots: [...cfg.providers.claude.roots],
				subscription: { ...cfg.providers.claude.subscription }
			},
			codex: { ...cfg.providers.codex, subscription: { ...cfg.providers.codex.subscription } },
			cursor: {
				enabled: cfg.providers.cursor.enabled,
				email: cfg.providers.cursor.email,
				pollSeconds: cfg.providers.cursor.pollSeconds,
				adminApiTokenConfigured: cfg.providers.cursor.adminApiToken.length > 0
			},
			opencode: { ...cfg.providers.opencode },
			pi: { ...cfg.providers.pi }
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
	const normalized = normalizeConfig(cfg);
	const file = configFilePath();
	const dir = join(file, '..');
	await mkdir(dir, { recursive: true, mode: 0o700 });
	// Atomic write: write to a temp file then rename so a crash can't leave a partial config.
	// Only update the in-memory cache once the rename succeeds.
	const tmp = join(dir, `.chaching-${randomBytes(6).toString('hex')}.tmp`);
	try {
		await writeFile(tmp, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 });
		await chmod(tmp, 0o600);
		await rename(tmp, file);
		// Ensure the final file has 0600 (rename may inherit different perms on some FSes).
		await chmod(file, 0o600);
	} catch (err) {
		// Remove the temp file if anything went wrong, then re-throw.
		await unlink(tmp).catch(() => {});
		throw err;
	}
	// Cache is updated only after the write succeeds.
	cache = normalized;
}

/** Invalidate the in-memory config cache (useful after saveConfig in tests or re-init). */
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

/**
 * Parse a per-provider subscription block. Missing/invalid → Corporate $99.
 * `monthlyUsd` is coerced to a non-negative finite number ($0 allowed for Free);
 * a string/negative/NaN/Infinity falls back to the default. Never throws.
 */
function normalizeSubscription(value: unknown): SubscriptionConfig {
	const raw = objectRecord(value);
	const tier =
		typeof raw.tier === 'string' && raw.tier.length > 0 ? raw.tier : DEFAULT_SUBSCRIPTION.tier;
	const monthlyUsd =
		typeof raw.monthlyUsd === 'number' && Number.isFinite(raw.monthlyUsd) && raw.monthlyUsd >= 0
			? raw.monthlyUsd
			: DEFAULT_SUBSCRIPTION.monthlyUsd;
	return { tier, monthlyUsd };
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const strings = value.filter((item) => typeof item === 'string' && item.length > 0);
	return strings.length > 0 ? strings : fallback;
}
