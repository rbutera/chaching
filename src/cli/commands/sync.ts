import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
	clearConfigCache,
	defaultConfig,
	loadConfig,
	saveConfig,
	type chachingConfig
} from '../../lib/core/config.js';
import { PostgresSyncStore } from '../../lib/core/sync/store.js';

export interface ParsedSyncArgs {
	action: string | undefined;
	subaction: string | undefined;
	options: Record<string, string | boolean>;
}

const VALUE_OPTIONS = new Set([
	'database-url',
	'name',
	'machine',
	'pool',
	'provider',
	'subscription',
	'account',
	'tier',
	'monthly-usd'
]);

export function parseSyncArgs(argv: string[]): ParsedSyncArgs {
	const positionals: string[] = [];
	const options: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			positionals.push(arg);
			continue;
		}
		const equal = arg.indexOf('=');
		const name = arg.slice(2, equal === -1 ? undefined : equal);
		if (name === 'json') {
			options.json = true;
			continue;
		}
		if (!VALUE_OPTIONS.has(name)) throw new Error(`unknown option '--${name}'`);
		const value = equal === -1 ? argv[++i] : arg.slice(equal + 1);
		if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
		options[name] = value;
	}
	return { action: positionals[0], subaction: positionals[1], options };
}

export function syncHelp(): string {
	return `Usage:
  chaching sync create --database-url <url> --name <pool> [--machine <name>]
  chaching sync join --database-url <url> --pool <id> [--machine <name>]
  chaching sync status [--json]
  chaching sync leave
  chaching sync subscription add --provider <id> --name <name> --account <account> --tier <tier> --monthly-usd <usd>
  chaching sync map --provider <id> --subscription <id>

PostgreSQL replaces local SQLite history only while sync is enabled.
Existing aggregate-only SQLite history is not imported because it cannot be reconstructed
honestly as raw events. Database credentials are never printed by sync commands.`;
}

export async function runSync(argv: string[]): Promise<void> {
	let parsed: ParsedSyncArgs;
	try {
		parsed = parseSyncArgs(argv);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
		return;
	}
	if (!parsed.action || parsed.action === 'help') {
		console.log(syncHelp());
		return;
	}
	try {
		switch (parsed.action) {
			case 'create':
				await create(parsed.options);
				return;
			case 'join':
				await join(parsed.options);
				return;
			case 'status':
				await status(parsed.options.json === true);
				return;
			case 'leave':
				await leave();
				return;
			case 'subscription':
				if (parsed.subaction !== 'add') throw new Error("expected 'subscription add'");
				await addSubscription(parsed.options);
				return;
			case 'map':
				await mapSubscription(parsed.options);
				return;
			default:
				throw new Error(`unknown sync action '${parsed.action}'`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const databaseUrl = parsed.options['database-url'];
		fail(
			typeof databaseUrl === 'string' && databaseUrl
				? message.replaceAll(databaseUrl, '<redacted database URL>')
				: message
		);
	}
}

async function create(options: Record<string, string | boolean>): Promise<void> {
	const databaseUrl = required(options, 'database-url');
	const poolName = required(options, 'name');
	const machineName = stringOption(options, 'machine') ?? hostname();
	const poolId = randomUUID();
	const machineId = randomUUID();
	const store = new PostgresSyncStore(databaseUrl);
	try {
		await store.migrate();
		await store.createPool({ id: poolId, name: poolName }, { id: machineId, name: machineName });
		await enableSync(databaseUrl, poolId, machineId, machineName);
		console.log(`Created sync pool ${poolId} for machine '${machineName}'.`);
		console.log('Existing SQLite aggregates were not imported; sync starts from honest raw local events.');
	} finally {
		await store.close();
	}
}

async function join(options: Record<string, string | boolean>): Promise<void> {
	const databaseUrl = required(options, 'database-url');
	const poolId = required(options, 'pool');
	const machineName = stringOption(options, 'machine') ?? hostname();
	const machineId = randomUUID();
	const store = new PostgresSyncStore(databaseUrl);
	try {
		await store.migrate();
		await store.joinPool(poolId, { id: machineId, name: machineName });
		await enableSync(databaseUrl, poolId, machineId, machineName);
		console.log(`Joined sync pool ${poolId} as '${machineName}'.`);
		console.log('Existing SQLite aggregates were not imported; sync starts from honest raw local events.');
	} finally {
		await store.close();
	}
}

async function status(json: boolean): Promise<void> {
	const cfg = await loadConfig();
	if (!isConfigured(cfg)) {
		const local = { enabled: false, configured: false };
		console.log(json ? JSON.stringify(local, null, 2) : 'Sync is disabled. Local SQLite history is active.');
		return;
	}
	const store = new PostgresSyncStore(cfg.sync.databaseUrl);
	try {
		await store.migrate();
		const metadata = await store.status(cfg.sync.poolId, cfg.sync.machineId);
		const output = {
			enabled: true,
			databaseUrlConfigured: true,
			machineId: cfg.sync.machineId,
			machineName: cfg.sync.machineName,
			...metadata
		};
		if (json) console.log(JSON.stringify(output, null, 2));
		else {
			console.log(`Sync enabled: ${metadata.pool?.name ?? cfg.sync.poolId} (${cfg.sync.poolId})`);
			console.log(`Machine: ${cfg.sync.machineName} (${cfg.sync.machineId})`);
			console.log(`Machines: ${metadata.machines.length}; subscriptions: ${metadata.subscriptions.length}`);
		}
	} finally {
		await store.close();
	}
}

async function leave(): Promise<void> {
	const cfg = await loadConfig();
	cfg.sync = defaultConfig().sync;
	clearConfigCache();
	await saveConfig(cfg);
	console.log('Sync disabled. Local SQLite history will be used on the next run.');
}

async function addSubscription(options: Record<string, string | boolean>): Promise<void> {
	const cfg = await configuredConfig();
	const monthlyUsd = Number(required(options, 'monthly-usd'));
	if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
		throw new Error('--monthly-usd must be a non-negative number');
	}
	const subscription = {
		id: randomUUID(),
		provider: required(options, 'provider'),
		name: required(options, 'name'),
		account: required(options, 'account'),
		tier: required(options, 'tier'),
		monthlyUsd
	};
	const store = new PostgresSyncStore(cfg.sync.databaseUrl);
	try {
		await store.migrate();
		await store.createSubscription(cfg.sync.poolId, subscription);
		console.log(`Created subscription ${subscription.id} (${subscription.provider}: ${subscription.name}).`);
	} finally {
		await store.close();
	}
}

async function mapSubscription(options: Record<string, string | boolean>): Promise<void> {
	const cfg = await configuredConfig();
	const provider = required(options, 'provider');
	const subscriptionId = required(options, 'subscription');
	const store = new PostgresSyncStore(cfg.sync.databaseUrl);
	try {
		await store.migrate();
		await store.mapMachineProvider(cfg.sync.poolId, cfg.sync.machineId, provider, subscriptionId);
		cfg.sync.providerSubscriptions[provider] = subscriptionId;
		clearConfigCache();
		await saveConfig(cfg);
		console.log(`Mapped ${provider} on ${cfg.sync.machineName} to subscription ${subscriptionId}.`);
	} finally {
		await store.close();
	}
}

async function enableSync(
	databaseUrl: string,
	poolId: string,
	machineId: string,
	machineName: string
): Promise<void> {
	const cfg = await loadConfig();
	cfg.sync = {
		enabled: true,
		databaseUrl,
		poolId,
		machineId,
		machineName,
		providerSubscriptions: {}
	};
	clearConfigCache();
	await saveConfig(cfg);
}

async function configuredConfig(): Promise<
	chachingConfig & {
		sync: chachingConfig['sync'] & { poolId: string; machineId: string; machineName: string };
	}
> {
	const cfg = await loadConfig();
	if (!isConfigured(cfg)) throw new Error('sync is not configured; run sync create or sync join first');
	return cfg;
}

function isConfigured(
	cfg: chachingConfig
): cfg is chachingConfig & {
	sync: chachingConfig['sync'] & { poolId: string; machineId: string; machineName: string };
} {
	return Boolean(
		cfg.sync.enabled &&
			cfg.sync.databaseUrl &&
			cfg.sync.poolId &&
			cfg.sync.machineId &&
			cfg.sync.machineName
	);
}

function required(options: Record<string, string | boolean>, name: string): string {
	const value = options[name];
	if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
	return value;
}

function stringOption(options: Record<string, string | boolean>, name: string): string | undefined {
	const value = options[name];
	return typeof value === 'string' ? value : undefined;
}

function fail(message: string): never {
	console.error(`chaching sync: ${message}`);
	console.error('Run `chaching sync help` for usage.');
	process.exit(1);
}
