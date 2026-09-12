import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PostgresSyncStore } from './store';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearConfigCache, loadConfig, updateConfig, publicConfig,
	configFilePath,
	defaultConfig,
	type chachingConfig
} from '../config';
import { assertCursorScopeReady, parseIntervalMinutes, setSyncInterval, performSyncAction, getSyncStatus, writePoolAccount } from './manager';

function withCursor(enabled: boolean, email: string | null): chachingConfig {
	const cfg = defaultConfig();
	cfg.providers.cursor = { enabled, adminApiToken: '', email, pollSeconds: 3600 };
	return cfg;
}

describe('assertCursorScopeReady (B2 create/join guard)', () => {
	it('throws when cursor is enabled but no email is configured', () => {
		expect(() => assertCursorScopeReady(withCursor(true, null))).toThrow(/cursor.*email/i);
		expect(() => assertCursorScopeReady(withCursor(true, '   '))).toThrow(/cursor.*email/i);
	});

	it('does not throw when cursor is enabled with an email', () => {
		expect(() => assertCursorScopeReady(withCursor(true, 'me@example.com'))).not.toThrow();
	});

	it('does not throw when cursor is disabled (email irrelevant)', () => {
		expect(() => assertCursorScopeReady(withCursor(false, null))).not.toThrow();
	});
});

describe('parseIntervalMinutes', () => {
	it('accepts whole minutes >= 1 from number or string', () => {
		expect(parseIntervalMinutes(15)).toBe(15);
		expect(parseIntervalMinutes('30')).toBe(30);
		expect(parseIntervalMinutes(' 1 ')).toBe(1);
	});

	it('rejects zero, negatives, fractions, and non-numbers', () => {
		// Pre-change there was no validator at all — a bad value would have silently written a
		// sub-1 or NaN cadence and broken the aligned-burst grid. Each of these must throw now.
		for (const bad of [0, -5, 1.5, Number.NaN, Infinity]) {
			expect(() => parseIntervalMinutes(bad)).toThrow(/minutes >= 1/);
		}
		expect(() => parseIntervalMinutes('abc')).toThrow(/minutes >= 1/);
		expect(() => parseIntervalMinutes('')).toThrow(/minutes >= 1/);
	});
});

describe('setSyncInterval', () => {
	let tmpDir: string;
	let prevXdg: string | undefined;

	beforeEach(async () => {
		prevXdg = process.env.XDG_CONFIG_HOME;
		tmpDir = await mkdtemp(join(tmpdir(), 'chaching-interval-'));
		process.env.XDG_CONFIG_HOME = tmpDir;
		clearConfigCache();
	});

	afterEach(async () => {
		if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = prevXdg;
		clearConfigCache();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it('persists a valid interval to the 0600 config and returns it', async () => {
		// Pre-change setSyncInterval did not exist; there was no way to change the cadence at all.
		const saved = await setSyncInterval(45);
		expect(saved).toBe(45);
		const raw = JSON.parse(await readFile(configFilePath(), 'utf8')) as chachingConfig;
		expect(raw.sync.intervalMinutes).toBe(45);
	});

	it('rejects an invalid interval without touching config', async () => {
		await expect(setSyncInterval(0)).rejects.toThrow(/minutes >= 1/);
	});
});


it.skipIf(!process.env.CHACHING_TEST_DATABASE_URL)('keeps manual Accounts canonical through add, map, status and unmap', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'chaching-manual-account-'));
	const previous = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = directory;
	clearConfigCache();
	const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL!;
	const poolId = randomUUID();
	const machineId = randomUUID();
	const store = new PostgresSyncStore(databaseUrl);
	try {
		await store.createPool({ poolId, poolName: 'manual account fixture', machineId, machineName: 'fixture', hostname: 'fixture' });
		await updateConfig(config => ({ ...config, tokenmaxx: { ...config.tokenmaxx, enabled: false }, sync: {
			...config.sync, enabled: true, databaseUrl, poolId, machineId, machineName: 'fixture'
		} }));
		const add = PostgresSyncStore.prototype.addAccount;
		const interrupted = vi.spyOn(PostgresSyncStore.prototype, 'addAccount').mockImplementationOnce(async function (this: PostgresSyncStore, account) {
			await add.call(this, account);
			throw new Error('Simulated lost acknowledgement after pool insert');
		});
		const offline = vi.spyOn(PostgresSyncStore.prototype, 'open').mockRejectedValueOnce(new Error('Pool offline'));
		const first = await performSyncAction({ action: 'add-account', provider: 'claude', name: 'Manual Claude', account: 'private@example.test', tier: 'max', monthlyUsd: 200 });
		expect(first.unreachable).toBe(true);
		let persisted = await loadConfig();
		expect(persisted.accounts).toEqual([expect.objectContaining({ privateLabel: 'private@example.test', pendingPoolId: poolId })]);
		expect((await store.status()).accounts).toEqual([]);
		offline.mockRestore();
		expect((await getSyncStatus()).unreachable).toBe(true);
		interrupted.mockRestore();
		const added = await getSyncStatus();
		persisted = await loadConfig();
		expect(persisted.accounts[0].pendingPoolId).toBeUndefined();
		const remote = added.accounts.find(account => account.name === 'Manual Claude')!;
		expect(remote.account).toBe('');
		let config = await loadConfig();
		expect(config.accounts).toEqual([expect.objectContaining({ id: remote.id, name: 'Manual Claude', monthlyUsd: 200, privateLabel: 'private@example.test' })]);
		expect(JSON.stringify(publicConfig(config))).not.toContain('private@example.test');
		await updateConfig(async current => ({ ...current, accounts: [await writePoolAccount(current, current.accounts[0], { monthlyUsd: 150 })] }));
		expect((await store.status()).mappings).toEqual([]);
		expect((await loadConfig()).accounts[0]).toMatchObject({ monthlyUsd: 150, privateLabel: 'private@example.test' });
		for (let i = 0; i < 2; i++) await performSyncAction({ action: 'map', machineId, provider: 'claude', accountId: remote.id });
		config = await loadConfig();
		expect(config.providerAccounts.claude).toEqual([remote.id]);
		expect(config.accounts).toHaveLength(1);
		const status = await getSyncStatus();
		expect(status.accounts).toHaveLength(1);
		expect(status.mappings).toContainEqual({ machineId, provider: 'claude', accountId: remote.id });
		expect(JSON.stringify(status)).not.toContain('private@example.test');
		await performSyncAction({ action: 'map', machineId, provider: 'claude', accountId: null });
		config = await loadConfig();
		expect(config.providerAccounts.claude).toEqual([]);
		expect(config.accounts).toHaveLength(1);
		expect((await getSyncStatus()).mappings).toEqual([]);
	} finally {
		vi.restoreAllMocks();
		await store.close();
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
		clearConfigCache();
		await rm(directory, { recursive: true, force: true });
	}
});


it('exposes local Account filters without private identity or unresolved mappings', async () => {
	const cfg = defaultConfig();
	cfg.tokenmaxx.enabled = false;
	cfg.accounts = ['one', 'two'].map(id => ({ id, provider: 'codex', name: id, tier: 'custom', monthlyUsd: 20,
		feeSource: 'explicit', identity: null, privateLabel: 'private@example.test', registrations: ['private-registration'], legacy: false }));
	cfg.accounts[1].pendingLegacyIds = ['old'];
	cfg.providerAccounts = { codex: ['one', 'two', 'missing'], claude: ['one'] };
	const status = await getSyncStatus(cfg);
	expect(status.enabled).toBe(false);
	expect(status.accounts.map(account => account.id)).toEqual(['one', 'two']);
	expect(status.mappings).toEqual([]);
	cfg.accounts[1].pendingLegacyIds = [];
	cfg.providerAccounts.codex = ['one', 'missing'];
	expect((await getSyncStatus(cfg)).mappings).toEqual([{ machineId: expect.any(String), provider: 'codex', accountId: 'one' }]);
	expect(JSON.stringify(status.accounts)).not.toContain('private');
});
