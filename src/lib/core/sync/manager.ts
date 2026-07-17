import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import {
	clearConfigCache,
	loadConfig,
	saveConfig,
	type chachingConfig,
	type SyncConfig
} from '../config';
import { PostgresSyncStore } from './store';
import type { SyncAction, SyncStatus, SyncSubscription } from './types';
import { HistoryStore } from '../history/store';
import { expandPath } from '../fs-utils';

export function localSyncStatus(error: string | null = null): SyncStatus {
	return {
		enabled: false,
		databaseConfigured: false,
		pool: null,
		machine: null,
		machines: [],
		subscriptions: [],
		mappings: [],
		error
	};
}

export async function getSyncStatus(config?: chachingConfig): Promise<SyncStatus> {
	const cfg = config ?? (await loadConfig());
	if (!isConfigured(cfg.sync)) {
		return {
			...localSyncStatus(),
			databaseConfigured: cfg.sync.databaseUrl.length > 0
		};
	}
	const store = new PostgresSyncStore(
		cfg.sync.databaseUrl,
		cfg.sync.poolId,
		cfg.sync.machineId
	);
	try {
		await store.open();
		await store.heartbeat(cfg.sync.machineName, hostname());
		return await store.status();
	} catch (cause) {
		return {
			...localSyncStatus(message(cause)),
			enabled: true,
			databaseConfigured: true
		};
	} finally {
		await store.close().catch(() => {});
	}
}

export async function performSyncAction(action: SyncAction): Promise<SyncStatus> {
	let cfg = await loadConfig();

	if (action.action === 'leave') {
		const next = {
			...cfg,
			sync: {
				...cfg.sync,
				enabled: false,
				databaseUrl: '',
				poolId: null,
				providerSubscriptions: {}
			}
		};
		clearConfigCache();
		await saveConfig(next);
		return localSyncStatus();
	}

	if (action.action === 'create') {
		if (cfg.sync.enabled) throw new Error('Leave the current sync pool before creating another');
		const databaseUrl = required(action.databaseUrl, 'Database URL');
		const poolName = required(action.poolName, 'Pool name');
		const machineName = required(action.machineName, 'Machine name');
		const identity = await ensureMachineIdentity(cfg);
		cfg = identity.config;
		const pendingPool = await ensurePendingPoolIdentity(cfg);
		cfg = pendingPool.config;
		const poolId = pendingPool.poolId;
		const machineId = identity.machineId;
		const store = new PostgresSyncStore(databaseUrl);
		try {
			await store.createPool({
				poolId,
				poolName,
				machineId,
				machineName,
				hostname: hostname()
			});
			const migrationWarning = await importExistingHistory(store, cfg);
			const next = withSync(cfg, {
				enabled: true,
				databaseUrl,
				poolId,
				machineId,
				machineName,
				providerSubscriptions: {}
			});
			clearConfigCache();
			await saveConfig(next);
			return { ...(await store.status()), error: migrationWarning };
		} finally {
			await store.close().catch(() => {});
		}
	}

	if (action.action === 'join') {
		if (cfg.sync.enabled) throw new Error('Leave the current sync pool before joining another');
		const databaseUrl = required(action.databaseUrl, 'Database URL');
		const poolId = required(action.poolId, 'Pool ID');
		const machineName = required(action.machineName, 'Machine name');
		const identity = await ensureMachineIdentity(cfg);
		cfg = identity.config;
		const machineId = identity.machineId;
		const store = new PostgresSyncStore(databaseUrl);
		try {
			await store.joinPool({
				poolId,
				machineId,
				machineName,
				hostname: hostname()
			});
			const migrationWarning = await importExistingHistory(store, cfg);
			const next = withSync(cfg, {
				enabled: true,
				databaseUrl,
				poolId,
				machineId,
				machineName,
				providerSubscriptions: {}
			});
			clearConfigCache();
			await saveConfig(next);
			return { ...(await store.status()), error: migrationWarning };
		} finally {
			await store.close().catch(() => {});
		}
	}

	if (!isConfigured(cfg.sync)) throw new Error('Join or create a sync pool first');
	const store = new PostgresSyncStore(
		cfg.sync.databaseUrl,
		cfg.sync.poolId,
		cfg.sync.machineId
	);
	try {
		await store.open();
		if (action.action === 'import-history') {
			const warning = await importExistingHistory(store, cfg);
			return { ...(await store.status()), error: warning };
		} else if (action.action === 'add-subscription') {
			const monthlyUsd = action.monthlyUsd;
			if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0)
				throw new Error('Monthly USD must be a non-negative number');
			const subscription: SyncSubscription = {
				id: randomUUID(),
				provider: required(action.provider, 'Provider'),
				name: required(action.name, 'Subscription name'),
				account: action.account.trim(),
				tier: required(action.tier, 'Tier'),
				monthlyUsd
			};
			await store.addSubscription(subscription);
		} else {
			await store.mapSubscription(
				required(action.machineId, 'Machine ID'),
				required(action.provider, 'Provider'),
				action.subscriptionId
			);
			if (action.machineId === cfg.sync.machineId) {
				const next = {
					...cfg,
					sync: {
						...cfg.sync,
						providerSubscriptions: {
							...cfg.sync.providerSubscriptions,
							[action.provider]: action.subscriptionId
						}
					}
				};
				clearConfigCache();
				await saveConfig(next);
			}
		}
		await store.heartbeat(cfg.sync.machineName, hostname());
		return await store.status();
	} finally {
		await store.close().catch(() => {});
	}
}

export function isConfigured(
	sync: SyncConfig
): sync is SyncConfig & { poolId: string; machineId: string } {
	return (
		sync.enabled &&
		sync.databaseUrl.length > 0 &&
		typeof sync.poolId === 'string' &&
		sync.poolId.length > 0 &&
		typeof sync.machineId === 'string' &&
		sync.machineId.length > 0
	);
}

function withSync(cfg: chachingConfig, sync: SyncConfig): chachingConfig {
	return { ...cfg, sync };
}

function required(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

async function ensureMachineIdentity(
	cfg: chachingConfig
): Promise<{ config: chachingConfig; machineId: string }> {
	if (cfg.sync.machineId) return { config: cfg, machineId: cfg.sync.machineId };
	const machineId = randomUUID();
	const config = { ...cfg, sync: { ...cfg.sync, machineId } };
	// Persist before any PostgreSQL side effect. A retry after a crash or config
	// write failure then reuses one identity and one idempotent history import.
	await saveConfig(config);
	return { config, machineId };
}

async function ensurePendingPoolIdentity(
	cfg: chachingConfig
): Promise<{ config: chachingConfig; poolId: string }> {
	if (cfg.sync.poolId) return { config: cfg, poolId: cfg.sync.poolId };
	const poolId = randomUUID();
	const config = { ...cfg, sync: { ...cfg.sync, poolId } };
	await saveConfig(config);
	return { config, poolId };
}

async function importExistingHistory(
	store: PostgresSyncStore,
	cfg: chachingConfig
): Promise<string | null> {
	if (!cfg.history.enabled) return null;
	const dbPath = expandPath(cfg.history.dbPath);
	if (!existsSync(dbPath)) return null;
	const history = new HistoryStore();
	try {
		history.openReadOnly(dbPath);
		const cursorEmail = cfg.providers.cursor.email?.trim().toLowerCase();
		await store.importFrozenHistory(
			history.loadAggregates(),
			history.loadSessions(),
			cursorEmail ? { cursor: `cursor-account:${cursorEmail}` } : {}
		);
		return null;
	} catch (cause) {
		return `Pool joined, but existing SQLite history could not be imported: ${message(cause)}`;
	} finally {
		history.close();
	}
}
