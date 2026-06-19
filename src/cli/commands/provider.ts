// `chaching provider` — provider management (wave 3).
// Subcommands: add | enable | disable <name>

import { loadConfig, saveConfig, clearConfigCache } from '../../lib/core/config.js';
import { KNOWN_PROVIDERS, collectProviderSecret, type KnownProvider } from '../wizard.js';

const VALID_ACTIONS = ['add', 'enable', 'disable'] as const;
type ProviderAction = (typeof VALID_ACTIONS)[number];

export async function runProvider(args: string[]): Promise<void> {
	const [action, name] = args;

	if (!action) {
		console.log('Usage: chaching provider <add|enable|disable> <provider>');
		console.log('');
		console.log(`Providers: ${KNOWN_PROVIDERS.join(', ')}`);
		return;
	}

	if (!VALID_ACTIONS.includes(action as ProviderAction)) {
		console.error(`chaching provider: unknown action '${action}' (must be add|enable|disable)`);
		process.exit(1);
	}

	if (!name) {
		console.error(`chaching provider ${action}: missing provider name`);
		console.error(`Providers: ${KNOWN_PROVIDERS.join(', ')}`);
		process.exit(1);
	}

	if (!KNOWN_PROVIDERS.includes(name as KnownProvider)) {
		console.error(
			`chaching provider: unknown provider '${name}' (must be one of: ${KNOWN_PROVIDERS.join(', ')})`
		);
		process.exit(1);
	}

	const providerName = name as KnownProvider;
	const cfg = await loadConfig();

	switch (action as ProviderAction) {
		case 'enable':
			await setProviderEnabled(providerName, true, cfg);
			console.log(`${providerName}: enabled.`);
			break;

		case 'disable':
			await setProviderEnabled(providerName, false, cfg);
			console.log(`${providerName}: disabled.`);
			break;

		case 'add': {
			// add = enable + run secret flow if needed
			const secret = await collectProviderSecret(providerName);
			const updated = { ...cfg };
			if (providerName === 'cursor') {
				updated.providers = {
					...cfg.providers,
					cursor: {
						...cfg.providers.cursor,
						enabled: true,
						// Only write the token to config if it came from the prompt (not env).
						adminApiToken:
							secret !== null && !secret.fromEnv
								? secret.value
								: cfg.providers.cursor.adminApiToken
					}
				};
			} else {
				updated.providers = {
					...cfg.providers,
					[providerName]: {
						...cfg.providers[providerName],
						enabled: true
					}
				};
			}
			clearConfigCache();
			await saveConfig(updated);
			console.log(`${providerName}: added and enabled.`);
			break;
		}
	}
}

async function setProviderEnabled(
	providerName: KnownProvider,
	enabled: boolean,
	cfg: Awaited<ReturnType<typeof loadConfig>>
): Promise<void> {
	const updated = {
		...cfg,
		providers: {
			...cfg.providers,
			[providerName]: {
				...cfg.providers[providerName],
				enabled
			}
		}
	};
	clearConfigCache();
	await saveConfig(updated);
}
