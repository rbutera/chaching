import type { Account, PrivateAccount } from './accounts';

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
		cursor: Omit<CursorProviderConfig, 'adminApiToken'> & { adminApiTokenConfigured: boolean; };
		opencode: OpenCodeProviderConfig;
		pi: PiProviderConfig;
	};
}
