/**
 * Install wizard — @clack/prompts interactive provider setup.
 * Wave 3 implementation: provider multiselect + env-first secrets + atomic 0600 config write.
 */

import { intro, multiselect, password, outro, isCancel, cancel, log } from '@clack/prompts';
import { loadConfig, saveConfig, clearConfigCache, type chachingConfig } from '../lib/core/config.js';
import { noArt, wordmark } from './theme/personality.js';

// ── Provider registry ──────────────────────────────────────────────────────────

export const KNOWN_PROVIDERS = ['claude', 'codex', 'opencode', 'cursor'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

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
		const base = await loadConfig();
		const updated = applySelectionToConfig(base, {
			enabled: [...KNOWN_PROVIDERS],
			secrets: {}
		});
		clearConfigCache();
		await saveConfig(updated);
		return updated;
	}

	// Show branded intro unless art is suppressed. Wizard doesn't receive argv,
	// but the env flag (CHACHING_NO_ART) is the reliable signal here.
	const isNoArt = noArt([], process.env);
	const introLabel = isNoArt
		? 'chaching — first-run setup'
		: (wordmark({ noArt: false }) ?? 'chaching') + ' — first-run setup';
	intro(introLabel);

	// Load whatever base config exists (or the default).
	const base = await loadConfig();

	// ── Step 1: provider multiselect ──────────────────────────────────────────

	const selection = await multiselect<KnownProvider>({
		message: 'Which providers would you like to enable?',
		options: KNOWN_PROVIDERS.map((p) => ({
			value: p,
			label: PROVIDER_META[p].label,
			hint: PROVIDER_META[p].hint
		})),
		// All providers pre-ticked by default per spec requirement.
		initialValues: [...KNOWN_PROVIDERS],
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

	const enabledNames = enabledProviders.map((p) => PROVIDER_META[p].label).join(', ');
	outro(
		enabledProviders.length > 0
			? `Config saved. Enabled: ${enabledNames}`
			: 'Config saved with no providers enabled. Run `chaching init` to reconfigure.'
	);

	return updated;
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
