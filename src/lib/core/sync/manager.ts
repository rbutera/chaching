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
import type { FrozenAgg } from '../rollup/rollup';
import type { SessionSummary } from '../../types';

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
		// Configured but unreachable: keep the locally-known identity so the dashboard
		// shows "joined, pool offline" instead of falling back to onboarding (M3).
		return {
			...localSyncStatus(message(cause)),
			enabled: true,
			databaseConfigured: true,
			unreachable: true,
			localIdentity: {
				poolId: cfg.sync.poolId,
				machineId: cfg.sync.machineId,
				machineName: cfg.sync.machineName
			}
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
		assertCursorScopeReady(cfg);
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
		} catch (cause) {
			throw describeSyncFailure(cause);
		} finally {
			await store.close().catch(() => {});
		}
	}

	if (action.action === 'join') {
		if (cfg.sync.enabled) throw new Error('Leave the current sync pool before joining another');
		assertCursorScopeReady(cfg);
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
		} catch (cause) {
			throw describeSyncFailure(cause);
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

/**
 * Driver-level failures that mean "could not talk to PostgreSQL" — network refusal,
 * DNS/host failure, connect timeout, or auth rejection. Domain errors thrown after a
 * successful connect (e.g. "pool does not exist") are deliberately excluded so they
 * keep their own message.
 */
const CONNECTION_ERROR_CODES = new Set([
	'ECONNREFUSED',
	'ENOTFOUND',
	'ETIMEDOUT',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ECONNRESET',
	'EAI_AGAIN',
	'28P01', // invalid_password
	'28000', // invalid_authorization_specification
	'3D000' // invalid_catalog_name (database does not exist)
]);

function isConnectionError(cause: unknown): boolean {
	if (!(cause instanceof Error)) return false;
	const code = (cause as { code?: unknown }).code;
	if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
	return /connection terminated|connect timeout|getaddrinfo|ECONNREFUSED|password authentication|timeout expired/i.test(
		cause.message
	);
}

/**
 * Turn a raw pg connection/auth failure into a one-line actionable error, keeping the
 * driver's own message. Non-connection errors pass through unchanged (M2c).
 */
function describeSyncFailure(cause: unknown): Error {
	if (!isConnectionError(cause)) {
		return cause instanceof Error ? cause : new Error(String(cause));
	}
	const driver = cause instanceof Error ? cause.message : String(cause);
	return new Error(
		`could not reach PostgreSQL at the configured URL: ${driver}; check the URL, that the server is running, and network/Tailscale reachability`
	);
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

/**
 * Cursor spend is a shared cloud-account fact; every machine sees it. Pooled it must be
 * scoped by account (`cursor-account:<email>`) so the pool-wide unique index and insert
 * dedup keep it single-counted. Without an email there is no pool-level scope, so a per-
 * machine fallback would defeat that dedup and double-count across machines (B2). Refuse
 * to create/join a pool with cursor enabled but no email rather than silently mis-scope.
 */
export function assertCursorScopeReady(cfg: chachingConfig): void {
	if (cfg.providers.cursor.enabled && !cfg.providers.cursor.email?.trim()) {
		throw new Error(
			'Cursor + sync needs providers.cursor.email set so pooled cursor spend dedupes across machines. Set it in config, or disable cursor first.'
		);
	}
}

export interface CursorImportPlan {
	aggregates: readonly FrozenAgg[];
	sessions: readonly SessionSummary[];
	sourceScopes: Record<string, string>;
	warning: string | null;
}

/**
 * Decide how frozen cursor history enters the pool. With an email, cursor rows import
 * under the pool-wide `cursor-account:<email>` scope. Without one, cursor rows are
 * SKIPPED (never imported under a per-machine scope, which would double-count — B2) and
 * a warning is surfaced. Non-cursor rows always import unchanged.
 */
export function planCursorImportScope(
	cfg: chachingConfig,
	aggregates: readonly FrozenAgg[],
	sessions: readonly SessionSummary[]
): CursorImportPlan {
	const cursorEmail = cfg.providers.cursor.email?.trim().toLowerCase();
	if (cursorEmail) {
		return { aggregates, sessions, sourceScopes: { cursor: `cursor-account:${cursorEmail}` }, warning: null };
	}
	const hasCursor =
		aggregates.some((aggregate) => aggregate.provider === 'cursor') ||
		sessions.some((session) => session.provider === 'cursor');
	if (!hasCursor) return { aggregates, sessions, sourceScopes: {}, warning: null };
	return {
		aggregates: aggregates.filter((aggregate) => aggregate.provider !== 'cursor'),
		sessions: sessions.filter((session) => session.provider !== 'cursor'),
		sourceScopes: {},
		warning:
			'Pool joined, but cursor history was skipped: set providers.cursor.email so pooled cursor spend dedupes across machines, then re-run import.'
	};
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
		const plan = planCursorImportScope(cfg, history.loadAggregates(), history.loadSessions());
		await store.importFrozenHistory(plan.aggregates, plan.sessions, plan.sourceScopes);
		return plan.warning;
	} catch (cause) {
		return `Pool joined, but existing SQLite history could not be imported: ${message(cause)}`;
	} finally {
		history.close();
	}
}
