import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { expandPath } from '../fs-utils';
import { accountIdentityKey, readTokenmaxxAccounts, type TokenmaxxQuotaSnapshot } from '../providers/tokenmaxx/sqlite';
import { accountQuotaSnapshot, refreshAccountDiscovery } from '../account-discovery';
import type { PrivateAccount } from '@chaching/shared/accounts';
import { reportAccountFees, ACCOUNT_SPEND_FILTER_UNAVAILABLE } from '@chaching/shared/accounts';
import {
	loadConfig,
	updateConfig,
	type chachingConfig,
	type SyncConfig
} from '../config';
import { PostgresSyncStore } from './store';
import type { SyncAction, SyncStatus, SyncAccount, SyncMapping } from '@chaching/shared/sync-types';

export function localSyncStatus(error: string | null = null): SyncStatus {
	return {
		enabled: false,
		databaseConfigured: false,
		pool: null,
		machine: null,
		machines: [],
		accounts: [],
		mappings: [],
		providerQuotas: [],
		error
	};
}

export function localAccountMappings(cfg: chachingConfig): SyncMapping[] {
	return Object.entries(cfg.providerAccounts).filter(([provider]) => !cfg.accounts.some(account =>
		account.provider === provider && account.pendingLegacyIds?.length)).flatMap(([provider, ids]) => ids
		.filter(id => cfg.accounts.some(account => account.id === id && account.provider === provider && !account.pendingLegacyIds?.length))
		.map(accountId => ({ machineId: cfg.sync.machineId ?? hostname(), provider, accountId })));
}

export async function publishDiscoveredAccounts(store: PostgresSyncStore, cfg: chachingConfig): Promise<void> {
	if (!cfg.sync.poolId) return;
	const linked = new Set(Object.values(cfg.providerAccounts).flat());
	for (const account of cfg.accounts) {
		if (account.pendingPoolId === cfg.sync.poolId) {
			await store.addAccount({ ...account, account: '' });
			await updateConfig(current => ({ ...current, accounts: current.accounts.map(row => {
				if (row.id !== account.id || row.pendingPoolId !== account.pendingPoolId) return row;
				const { pendingPoolId: _pending, ...saved } = row;
				return saved;
			}) }));
		}
		if (!linked.has(account.id) || account.pendingLegacyIds?.length) continue;
		await store.discoverAccount({
			id: account.id,
			provider: account.provider,
			name: account.name,
			tier: account.tier,
			monthlyUsd: account.monthlyUsd,
			feeSource: account.feeSource,
			account: '',
			identityKey: account.identity ? accountIdentityKey(account.provider, account.identity, cfg.sync.poolId) : null
		});
	}
}

export async function writePoolAccount(cfg: chachingConfig, account: PrivateAccount,
	fields: Partial<Pick<PrivateAccount, 'name' | 'tier' | 'monthlyUsd' | 'feeSource'>> = account): Promise<PrivateAccount> {
	if (!isConfigured(cfg.sync) || account.pendingLegacyIds?.length) return account;
	const store = new PostgresSyncStore(cfg.sync.databaseUrl, cfg.sync.poolId, cfg.sync.machineId);
	try {
		await store.open();
		const id = await store.discoverAccount({
			id: account.id, provider: account.provider, name: account.name, account: '',
			tier: account.tier, monthlyUsd: account.monthlyUsd, feeSource: account.feeSource,
			identityKey: account.identity ? accountIdentityKey(account.provider, account.identity, cfg.sync.poolId) : null
		}, false);
		await store.updateAccountDetails({ ...fields, id, provider: account.provider });
		const status = await store.status();
		const remote = status.accounts.find(row => row.id === id);
		if (!remote) throw new Error('Account disappeared from the pool after saving');
		return { ...account, name: remote.name, tier: remote.tier, monthlyUsd: remote.monthlyUsd, feeSource: remote.feeSource ?? 'explicit' };
	} finally { await store.close(); }
}

export function applyPoolAccountDetails(cfg: chachingConfig, status: SyncStatus): chachingConfig {
	const poolId = cfg.sync.poolId;
	if (!poolId || status.pool?.id !== poolId) return cfg;
	return { ...cfg, accounts: cfg.accounts.map(account => {
		if (account.pendingLegacyIds?.length) return account;
		const key = account.identity ? accountIdentityKey(account.provider, account.identity, poolId) : null;
		const remote = status.accounts.find(row => row.provider === account.provider &&
			(key && row.identityKey ? row.identityKey === key : row.id === account.id));
		return remote ? { ...account, name: remote.name, tier: remote.tier, monthlyUsd: remote.monthlyUsd, feeSource: remote.feeSource ?? 'explicit' } : account;
	}) };
}

export async function getSyncStatus(config?: chachingConfig): Promise<SyncStatus> {
	const cfg = config ?? (await refreshAccountDiscovery());
	let localQuota: TokenmaxxQuotaSnapshot | null = null;
	try {
		localQuota = accountQuotaSnapshot(cfg, cfg.tokenmaxx.enabled ? readTokenmaxxAccounts(expandPath(cfg.tokenmaxx.dbPath), cfg.sync.poolId || undefined) : []);
	} catch {
		// Quota display is supplementary; token reconciliation reports ingest failures separately.
	}
	const localProviderQuotas = localQuota ? [{
		machineId: cfg.sync.machineId ?? hostname(),
		source: 'tokenmaxx',
		observedAt: localQuota.observedAt,
		accounts: localQuota.accounts
	}] : [];
	// The publish cadence lives only in the local 0600 config, so attach it to every status
	// branch here rather than in the store (which never reads config).
	const intervalMinutes = cfg.sync.intervalMinutes;
	if (!isConfigured(cfg.sync)) {
		return {
			...localSyncStatus(),
			databaseConfigured: cfg.sync.databaseUrl.length > 0,
			intervalMinutes,
			providerQuotas: localProviderQuotas,
			accounts: cfg.accounts.map(account => ({ id: account.id, provider: account.provider, name: account.name,
				account: '', tier: account.tier, monthlyUsd: account.monthlyUsd, feeSource: account.feeSource })),
			mappings: localAccountMappings(cfg)
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
		await publishDiscoveredAccounts(store, cfg);
		const status = await store.status();
		if (!config) await updateConfig(current => {
			if (current.sync.poolId !== cfg.sync.poolId || current.sync.databaseUrl !== cfg.sync.databaseUrl) return current;
			const hydrated = applyPoolAccountDetails(current, status);
			return { ...current, accounts: hydrated.accounts.map(account => {
				const before = cfg.accounts.find(row => row.id === account.id);
				const now = current.accounts.find(row => row.id === account.id);
				return now && JSON.stringify(now) !== JSON.stringify(before) ? now : account;
			}) };
		});
		const remoteQuotas = (status.providerQuotas ?? []).filter((quota) =>
			!localProviderQuotas.some((local) => local.machineId === quota.machineId && local.source === quota.source)
		);
		return { ...status, intervalMinutes, providerQuotas: [...remoteQuotas, ...localProviderQuotas] };
	} catch (cause) {
		// Configured but unreachable: keep the locally-known identity so the dashboard
		// shows "joined, pool offline" instead of falling back to onboarding (M3).
		return {
			...localSyncStatus(message(cause)),
			enabled: true,
			databaseConfigured: true,
			unreachable: true,
			intervalMinutes,
			localIdentity: {
				poolId: cfg.sync.poolId,
				machineId: cfg.sync.machineId,
				machineName: cfg.sync.machineName
			},
			providerQuotas: localProviderQuotas
		};
	} finally {
		await store.close().catch(() => {});
	}
}

export async function getReportAccountContext(scope: Parameters<typeof reportAccountFees>[2] = {}) {
	if (scope.accountIds?.length) throw new Error(ACCOUNT_SPEND_FILTER_UNAVAILABLE);
	const status = await getSyncStatus();
	const config = await loadConfig();
	return { config, status, fees: reportAccountFees(config, status, scope) };
}

export async function performSyncAction(action: SyncAction): Promise<SyncStatus> {
	let cfg = await loadConfig();

	if (action.action === 'leave') {
		await updateConfig(current => ({
			...current,
			sync: {
				...current.sync,
				enabled: false,
				databaseUrl: '',
				poolId: null
			}
		}));
		return localSyncStatus();
	}

	if (action.action === 'create') {
		if (cfg.sync.enabled) throw new Error('Leave the current sync pool before creating another');
		assertCursorScopeReady(cfg);
		const databaseUrl = required(action.databaseUrl, 'Database URL');
		const poolName = required(action.poolName, 'Pool name');
		const machineName = required(action.machineName, 'Machine name');
		const identity = await ensureMachineIdentity();
		cfg = identity.config;
		const pendingPool = await ensurePendingPoolIdentity();
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
			// No history import: a machine simply publishes all its local days on the next engine
			// burst (its rollup already merges frozen history + live), so joining loses nothing.
			await updateConfig(current => withSync(current, {
				enabled: true,
				databaseUrl,
				poolId,
				machineId,
				machineName,
				intervalMinutes: current.sync.intervalMinutes
			}));
			return await store.status();
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
		const identity = await ensureMachineIdentity();
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
			// No history import (see create): the engine publishes this machine's local days on
			// its next burst, so there is nothing to migrate at join time.
			await updateConfig(current => withSync(current, {
				enabled: true,
				databaseUrl,
				poolId,
				machineId,
				machineName,
				intervalMinutes: current.sync.intervalMinutes
			}));
			return await store.status();
		} catch (cause) {
			throw describeSyncFailure(cause);
		} finally {
			await store.close().catch(() => {});
		}
	}

	if (!isConfigured(cfg.sync)) throw new Error('Join or create a sync pool first');
	const poolId = cfg.sync.poolId;
	if (action.action === 'add-account') {
		const monthlyUsd = action.monthlyUsd;
		if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0)
			throw new Error('Monthly USD must be a non-negative number');
		const subscription: SyncAccount = {
			id: randomUUID(),
			provider: required(action.provider, 'Provider'),
			name: required(action.name, 'Account name'),
			account: '',
			tier: required(action.tier, 'Tier'),
			monthlyUsd, feeSource: 'explicit'
		};
		await updateConfig(current => {
			return { ...current, accounts: [...current.accounts, {
				id: subscription.id, provider: subscription.provider, name: subscription.name,
				tier: subscription.tier, monthlyUsd, feeSource: 'explicit', identity: null,
				registrations: [], legacy: false, pendingPoolId: poolId,
				...(action.account.trim() ? { privateLabel: action.account.trim() } : {})
			}] };
		});
		return await getSyncStatus();
	}

	const store = new PostgresSyncStore(
		cfg.sync.databaseUrl,
		cfg.sync.poolId,
		cfg.sync.machineId
	);
	try {
		await store.open();

		const machineId = required(action.machineId, 'Machine ID');
		const provider = required(action.provider, 'Provider');
		if (machineId !== cfg.sync.machineId) {
			await store.mapAccount(machineId, provider, action.accountId);
		} else {
			await updateConfig(async current => {
				if (current.sync.poolId !== poolId || current.sync.machineId !== machineId || current.sync.databaseUrl !== cfg.sync.databaseUrl) throw new Error('Sync settings changed; retry mapping.');
				const remote = action.accountId ? (await store.status()).accounts.find(account => account.id === action.accountId && account.provider === provider) : null;
				if (action.accountId && !remote) throw new Error('Account does not exist in this pool for that provider');
				const existing = remote ? current.accounts.find(account => account.provider === provider &&
					(account.id === remote.id || (account.identity && remote.identityKey === accountIdentityKey(provider, account.identity, poolId)))) : null;
				const account: PrivateAccount | null = remote ? {
					...existing, id: existing?.id ?? remote.id, provider, name: remote.name, tier: remote.tier, monthlyUsd: remote.monthlyUsd,
					feeSource: remote.feeSource ?? 'explicit', identity: existing?.identity ?? null, registrations: existing?.registrations ?? [], legacy: existing?.legacy ?? false
				} : null;
				await store.mapAccount(machineId, provider, action.accountId);
				return { ...current,
					accounts: account ? [...current.accounts.filter(row => row.id !== account.id), account] : current.accounts,
					providerAccounts: { ...current.providerAccounts, [provider]: account ? [account.id] : [] }
				};
			});
		}
		await store.heartbeat(cfg.sync.machineName, hostname());
		return await store.status();
	} finally {
		await store.close().catch(() => {});
	}
}

/**
 * Coerce a user-supplied interval into a valid minute count (integer >= 1) or throw. The
 * cadence is a per-machine serverless-cost knob: higher = fewer PostgreSQL wake windows.
 */
export function parseIntervalMinutes(raw: string | number): number {
	const value = typeof raw === 'number' ? raw : Number(raw.trim());
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1)
		throw new Error('interval must be a whole number of minutes >= 1');
	return value;
}

/** Persist the sync publish cadence (minutes). Validates via parseIntervalMinutes. */
export async function setSyncInterval(minutes: number): Promise<number> {
	const intervalMinutes = parseIntervalMinutes(minutes);
	await updateConfig(cfg => ({ ...cfg, sync: { ...cfg.sync, intervalMinutes } }));
	return intervalMinutes;
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

async function ensureMachineIdentity(): Promise<{ config: chachingConfig; machineId: string; }> {
	let machineId = '';
	const config = await updateConfig(current => {
		machineId = current.sync.machineId ?? randomUUID();
		return { ...current, sync: { ...current.sync, machineId } };
	});
	return { config, machineId };
}

async function ensurePendingPoolIdentity(): Promise<{ config: chachingConfig; poolId: string; }> {
	let poolId = '';
	const config = await updateConfig(current => {
		poolId = current.sync.poolId ?? randomUUID();
		return { ...current, sync: { ...current.sync, poolId } };
	});
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
