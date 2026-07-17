/**
 * Install wizard — @clack/prompts interactive provider setup.
 * Wave 3 implementation: provider multiselect + env-first secrets + atomic 0600 config write.
 */

import {
	intro,
	multiselect,
	password,
	outro,
	isCancel,
	cancel,
	log,
	note,
	select,
	text
} from '@clack/prompts';
import { loadConfig, saveConfig, clearConfigCache, type chachingConfig } from '../lib/core/config.js';
import { parseIntervalMinutes, performSyncAction } from '../lib/core/sync/manager.js';
import { hostname } from 'node:os';
import { noArt, accent } from './theme/personality.js';
import { bannerLine } from './tui/theme.js';

// ── Provider registry ──────────────────────────────────────────────────────────

export const KNOWN_PROVIDERS = ['claude', 'codex', 'opencode', 'cursor', 'pi'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/**
 * Providers OFF by default in the wizard (opt-in). Cursor needs an admin token, so
 * ticking it is a deliberate choice.
 */
const DEFAULT_OFF: readonly KnownProvider[] = ['cursor'];

interface ProviderMeta {
	label: string;
	hint: string;
	/** Optional env var that holds the provider's secret. */
	secret?: {
		envVar: string;
		configKey: 'adminApiToken';
		promptLabel: string;
	};
}

const PROVIDER_META: Record<KnownProvider, ProviderMeta> = {
	claude: {
		label: 'Claude Code',
		hint: 'reads ~/.claude session JSONL files'
	},
	codex: {
		label: 'Codex',
		hint: 'reads ~/.codex/sessions'
	},
	opencode: {
		label: 'OpenCode',
		hint: 'reads ~/.local/share/opencode/opencode.db'
	},
	cursor: {
		label: 'Cursor',
		hint: 'polls Cursor Admin API (requires CURSOR_ADMIN_API_TOKEN)',
		secret: {
			envVar: 'CURSOR_ADMIN_API_TOKEN',
			configKey: 'adminApiToken',
			promptLabel: 'Cursor Admin API token'
		}
	},
	pi: {
		label: 'Pi',
		hint: 'reads ~/.pi/agent/sessions (also covers the omp fork)'
	}
};

// ── Pure logic (testable without clack) ───────────────────────────────────────

export interface ProviderSelection {
	/** Provider names chosen by the user. */
	enabled: KnownProvider[];
	/** Secrets collected during the wizard (keyed by provider name). */
	secrets: Partial<Record<KnownProvider, string>>;
}

/**
 * Apply a wizard selection onto an existing config, returning the updated config.
 * Pure function — no side effects.
 */
export function applySelectionToConfig(
	base: chachingConfig,
	selection: ProviderSelection
): chachingConfig {
	const enabledSet = new Set(selection.enabled);
	return {
		...base,
		providers: {
			claude: {
				...base.providers.claude,
				enabled: enabledSet.has('claude')
			},
			codex: {
				...base.providers.codex,
				enabled: enabledSet.has('codex')
			},
			opencode: {
				...base.providers.opencode,
				enabled: enabledSet.has('opencode')
			},
			pi: {
				...base.providers.pi,
				enabled: enabledSet.has('pi')
			},
			cursor: {
				...base.providers.cursor,
				enabled: enabledSet.has('cursor'),
				// Only write the token if it was explicitly collected by the wizard.
				// If the token came from the env we leave the stored value unchanged so
				// the engine can pick it up from the environment at runtime.
				adminApiToken:
					selection.secrets.cursor !== undefined
						? selection.secrets.cursor
						: base.providers.cursor.adminApiToken
			}
		}
	};
}

/**
 * Determine whether a Cursor secret prompt is needed.
 * Checks the env variable first; returns the env value if found (caller skips prompt),
 * or undefined (caller should prompt).
 *
 * This is the "env-first" rule from D5.
 */
export function resolveEnvSecret(
	providerName: KnownProvider,
	env: NodeJS.ProcessEnv = process.env
): string | undefined {
	const meta = PROVIDER_META[providerName];
	if (!meta.secret) return undefined;
	const val = env[meta.secret.envVar];
	return typeof val === 'string' && val.length > 0 ? val : undefined;
}

// ── Interactive wizard ─────────────────────────────────────────────────────────

export interface WizardOptions {
	/** Injected process.env for testing / env-first check. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Run the full interactive install wizard.
 * Writes the resulting config to disk.
 * Returns the final config or null when the user cancelled.
 */
export async function runWizard(opts: WizardOptions = {}): Promise<chachingConfig | null> {
	const env = opts.env ?? process.env;

	// Non-interactive environment: skip the interactive prompts entirely.
	// This handles subprocess tests, CI, and piped stdin gracefully.
	if (!process.stdin.isTTY) {
		// Silently write the default config and return — no interactive prompts.
		// Match the interactive default: enable everything EXCEPT Cursor (which is
		// off in the default config and needs an admin token to do anything useful).
		const base = await loadConfig();
		const updated = applySelectionToConfig(base, {
			enabled: KNOWN_PROVIDERS.filter((p) => !DEFAULT_OFF.includes(p)),
			secrets: {}
		});
		clearConfigCache();
		await saveConfig(updated);
		return updated;
	}

	// ── Branded, paced first-run intro ─────────────────────────────────────────
	// A warm welcome before the provider checklist. The register banner sets the
	// tone, then a couple of light, clear lines explain what we're about to do.
	// All of it is suppressed under --no-art / CHACHING_NO_ART (the wizard doesn't
	// receive argv, but the env flag is the reliable signal here). NO_COLOR strips
	// the brass paint but keeps the words.
	const isNoArt = noArt([], process.env);

	if (!isNoArt) {
		const banner = bannerLine(false, process.stdout.columns ?? 80);
		if (banner) {
			// Paint the register wordmark in brass (accent() degrades under NO_COLOR).
			process.stdout.write('\n' + accent(banner) + '\n\n');
		}
	}

	intro(isNoArt ? 'chaching — first-run setup' : 'Welcome to Chaching!');

	if (!isNoArt) {
		note(
			"Let's help you keep track of your token usage.\n" +
				'First, which coding harnesses would you like Chaching to track?',
			'getting set up'
		);
	}

	// Load whatever base config exists (or the default).
	const base = await loadConfig();

	// ── Step 1: provider multiselect ──────────────────────────────────────────
	// Claude / Codex / OpenCode are pre-ticked; Cursor is UNTICKED by default
	// (it needs an admin API token and is off in the default config). Ticking
	// Cursor here is what triggers the token prompt below — never otherwise.
	const DEFAULT_TICKED: KnownProvider[] = KNOWN_PROVIDERS.filter((p) => !DEFAULT_OFF.includes(p));

	const selection = await multiselect<KnownProvider>({
		message: 'Which providers would you like to enable?',
		options: KNOWN_PROVIDERS.map((p) => ({
			value: p,
			label: PROVIDER_META[p].label,
			hint: PROVIDER_META[p].hint
		})),
		initialValues: DEFAULT_TICKED,
		required: false
	});

	if (isCancel(selection)) {
		cancel('Setup cancelled — no changes written.');
		return null;
	}

	const enabledProviders = selection as KnownProvider[];
	const secrets: Partial<Record<KnownProvider, string>> = {};

	// ── Step 2: secret handling (env-first) ───────────────────────────────────

	for (const providerName of enabledProviders) {
		const meta = PROVIDER_META[providerName];
		if (!meta.secret) continue;

		const fromEnv = resolveEnvSecret(providerName, env);
		if (fromEnv !== undefined) {
			// Token is present in the environment — skip the prompt and do NOT write
			// the value into the config (leave it empty so the engine reads from env
			// at runtime, keeping the config free of the secret).
			log.info(
				`${meta.label}: token found in $${meta.secret.envVar} — no prompt needed.`
			);
			// We intentionally do NOT add to secrets here, so applySelectionToConfig
			// leaves adminApiToken as the existing config value (empty by default).
			continue;
		}

		// Secret missing from env — prompt for it.
		const prompted = await password({
			message: `${meta.secret.promptLabel} (will be stored in 0600 config):`
		});

		if (isCancel(prompted)) {
			cancel('Setup cancelled — no changes written.');
			return null;
		}

		secrets[providerName] = prompted as string;
	}

	// ── Step 3: build + write config ─────────────────────────────────────────

	const updated = applySelectionToConfig(base, { enabled: enabledProviders, secrets });
	clearConfigCache();
	await saveConfig(updated);

	// ── Step 4: optional pooled ledger ────────────────────────────────────────
	const ledger = await select({
		message: 'Where should Chaching keep history?',
		options: [
			{ value: 'local', label: 'This machine only', hint: 'local SQLite (default)' },
			{ value: 'create', label: 'Create a sync pool', hint: 'shared PostgreSQL ledger' },
			{ value: 'join', label: 'Join a sync pool', hint: 'use an existing pool ID' }
		],
		initialValue: base.sync.enabled ? 'join' : 'local'
	});
	if (isCancel(ledger)) {
		cancel('Setup cancelled. Provider changes were already saved; sync was not changed.');
		return updated;
	}
	let synced = updated;
	if (ledger === 'create' || ledger === 'join') {
		const databaseUrl = await password({
			message: 'PostgreSQL connection URL (stored in the 0600 config):'
		});
		if (isCancel(databaseUrl)) return updated;
		const machineAnswer = await text({
			message: 'Name this machine:',
			initialValue: base.sync.machineName || hostname()
		});
		if (isCancel(machineAnswer)) return updated;
		// Publish cadence: higher = cheaper on serverless Postgres (Neon free tier), because
		// all machines share fewer wake windows. It only affects how stale PEERS' data is; this
		// machine's own numbers are always live. 15 min keeps a 3-machine pool well inside free.
		const intervalAnswer = await text({
			message: 'Sync interval in minutes (how often machines publish to the pool):',
			initialValue: String(base.sync.intervalMinutes),
			placeholder: '15'
		});
		if (isCancel(intervalAnswer)) return updated;
		const intervalMinutes = parseWizardInterval(String(intervalAnswer), base.sync.intervalMinutes);
		// Persist the interval BEFORE create/join so the action's config write carries it.
		synced = { ...updated, sync: { ...updated.sync, intervalMinutes } };
		clearConfigCache();
		await saveConfig(synced);
		if (ledger === 'create') {
			const poolName = await text({ message: 'Pool name:', placeholder: 'My machines' });
			if (isCancel(poolName)) return synced;
			try {
				const status = await performSyncAction({
					action: 'create',
					databaseUrl: String(databaseUrl),
					poolName: String(poolName),
					machineName: String(machineAnswer)
				});
				if (status.error) note(status.error, 'pool warning');
				// Print the pool ID + a ready-to-paste join hint so machine 2 can onboard
				// from here alone (M1a — matches `chaching sync create`'s CLI output).
				note(
					`pool ${status.pool?.name} (${status.pool?.id})\n` +
						`${status.machine?.name} now publishes aggregates to the pool every ${intervalMinutes} min ` +
						`(local SQLite keeps running).\n\n` +
						`On each other machine, set CHACHING_DATABASE_URL, then run:\n` +
						`chaching sync join --pool ${status.pool?.id} --machine <name>`,
					'sync pool created'
				);
			} catch (cause) {
				return syncSetupFailed(cause, synced);
			}
		} else {
			const poolId = await text({ message: 'Pool ID:' });
			if (isCancel(poolId)) return synced;
			try {
				const status = await performSyncAction({
					action: 'join',
					databaseUrl: String(databaseUrl),
					poolId: String(poolId),
					machineName: String(machineAnswer)
				});
				if (status.error) note(status.error, 'pool warning');
				note(
					`joined pool ${status.pool?.name ?? poolId} as ${status.machine?.name}. ` +
						`This machine publishes to the pool every ${intervalMinutes} min; local SQLite keeps running.`,
					'joined sync pool'
				);
			} catch (cause) {
				return syncSetupFailed(cause, synced);
			}
		}
	}

	const enabledNames = enabledProviders.map((p) => PROVIDER_META[p].label).join(', ');
	outro(
		enabledProviders.length > 0
			? `Config saved. Enabled: ${enabledNames}`
			: 'Config saved with no providers enabled. Run `chaching init` to reconfigure.'
	);

	return synced;
}

/**
 * Coerce the wizard's free-text interval answer into a valid minute count, falling back to
 * the current config value when the entry is blank or non-numeric (the prompt must never
 * hard-fail setup — a bad number just keeps the existing cadence).
 */
export function parseWizardInterval(raw: string, fallback: number): number {
	try {
		return parseIntervalMinutes(raw);
	} catch {
		return fallback;
	}
}

/**
 * Handle a create/join failure inside the wizard gracefully (M2b): surface the
 * actionable message, remind the user their provider settings are already saved, and
 * return the saved config so the wizard exits cleanly instead of crashing mid-init.
 */
function syncSetupFailed(cause: unknown, saved: chachingConfig): chachingConfig {
	const msg = cause instanceof Error ? cause.message : String(cause);
	note(
		`${msg}\n\n` +
			'Your provider settings are already saved. Once PostgreSQL is reachable, run\n' +
			'`chaching sync create` or `chaching sync join` to finish pooling.',
		'could not reach the sync pool'
	);
	return saved;
}

// ── Single-provider secret flow (for `chaching provider add`) ─────────────────

/**
 * Run the secret-collection flow for a single provider that requires a secret.
 * Returns the collected secret, the env value (if sourced from env — caller should
 * NOT write it to config), or null if the user cancelled.
 *
 * `fromEnv` on the return indicates the secret came from the environment and
 * should not be written to config.
 */
export async function collectProviderSecret(
	providerName: KnownProvider,
	env: NodeJS.ProcessEnv = process.env
): Promise<{ value: string; fromEnv: boolean } | null> {
	const meta = PROVIDER_META[providerName];
	if (!meta.secret) return null;

	const fromEnv = resolveEnvSecret(providerName, env);
	if (fromEnv !== undefined) {
		return { value: fromEnv, fromEnv: true };
	}

	const prompted = await password({
		message: `${meta.secret.promptLabel}:`
	});

	if (isCancel(prompted)) {
		cancel('Cancelled.');
		return null;
	}

	return { value: prompted as string, fromEnv: false };
}
