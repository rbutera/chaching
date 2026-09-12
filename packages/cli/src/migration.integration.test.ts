import { runSync } from './commands/sync';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresSyncStore } from '@chaching/core/sync/store';
import { applyPoolAccountDetails, writePoolAccount } from '@chaching/core/sync/manager';
import { defaultConfig } from '@chaching/core/config';
import { accountIdentityKey } from '@chaching/core/providers/tokenmaxx/sqlite';

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('Account schema migration', () => {
	const databaseName = `chaching_migration_${randomUUID().replaceAll('-', '')}`;
	let admin: Pool;
	let db: Pool;
	let url: string;
	let v3: string;
	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE DATABASE ${databaseName}`);
		const target = new URL(databaseUrl!);
		target.pathname = `/${databaseName}`;
		url = target.href;
		db = new Pool({ connectionString: url });
		v3 = await readFile(new URL('../../core/src/sync/fixtures/pool-v3.sql', import.meta.url), 'utf8');
	});
	afterAll(async () => {
		await db?.end();
		await admin?.query(`DROP DATABASE IF EXISTS ${databaseName}`);
		await admin?.end();
	});
	beforeEach(async () => {
		await db.query('DROP SCHEMA IF EXISTS chaching_sync CASCADE');
		await db.query(v3);
		await db.query(`
			INSERT INTO chaching_sync.pool (id, name) VALUES ('pool', 'test');
			INSERT INTO chaching_sync.machine (pool_id, id, name, hostname) VALUES ('pool', 'one', 'one', 'one'), ('pool', 'two', 'two', 'two');
			INSERT INTO chaching_sync.subscription (pool_id, id, provider, name, tier, monthly_usd) VALUES ('pool', 'paid', 'claude', 'Work', 'max-20x', 175), ('pool', 'free', 'codex', 'Free', 'free', 0);
			INSERT INTO chaching_sync.machine_subscription VALUES ('pool', 'one', 'claude', 'paid'), ('pool', 'two', 'claude', 'paid'), ('pool', 'one', 'codex', NULL);
			INSERT INTO chaching_sync.machine_day_agg VALUES ('pool', 'machine:one', 'one', '2026-09-01', 'claude', 'model', 100, 20, 0, 0, 0, 0, 0, 0, 1, 12.5, 0, false, now());
			INSERT INTO chaching_sync.machine_hour_agg VALUES ('pool', 'machine:one', 'one', 123, 'claude', 'model', 100, 20, 0, 0, 1, 12.5, 0, now());
			INSERT INTO chaching_sync.machine_session_agg VALUES ('pool', 'machine:one', 'one', 'claude', 'session', '{"cost":12.5}', now());
		`);
	});

	it('additively upgrades an Account v4 pool without changing retained usage', async () => {
		const first = new PostgresSyncStore(url, 'pool', 'one');
		await first.open(); await first.close();
		await db.query('ALTER TABLE chaching_sync.machine_day_agg DROP COLUMN monetary');
		await db.query('UPDATE chaching_sync.schema_version SET version=4');
		const migrated = new PostgresSyncStore(url, 'pool', 'one');
		try {
			await migrated.open();
			expect(await migrated.readSchemaVersion()).toBe(5);
			expect((await db.query('SELECT cost, monetary FROM chaching_sync.machine_day_agg')).rows).toEqual([{cost:12.5,monetary:null}]);
		} finally {await migrated.close();}
	});

	it('exposes a read-only schema command and explicit repeatable migration without starting sync', async () => {
		const previousUrl = process.env.CHACHING_DATABASE_URL;
		process.env.CHACHING_DATABASE_URL = url;
		try {
			await runSync(['schema']);
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows[0].version).toBe(3);
			await expect(runSync(['schema', '--migrate'])).rejects.toThrow('Stop every client');
			await runSync(['schema', '--migrate', '--clients-stopped']);
			await runSync(['schema', '--migrate', '--clients-stopped']);
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows[0].version).toBe(5);
			expect((await db.query('SELECT count(*) FROM chaching_sync.machine')).rows[0].count).toBe('2');
		} finally {
			if (previousUrl === undefined) delete process.env.CHACHING_DATABASE_URL;
			else process.env.CHACHING_DATABASE_URL = previousUrl;
		}
	});

	it('preserves bills, links and aggregate rows across concurrent migration and rerun', async () => {
		const stores = Array.from({ length: 3 }, () => new PostgresSyncStore(url, 'pool', 'one'));
		const before = await db.query(`SELECT to_jsonb(t) - 'monetary' AS row FROM chaching_sync.machine_day_agg t UNION ALL SELECT to_jsonb(t) FROM chaching_sync.machine_hour_agg t UNION ALL SELECT to_jsonb(t) FROM chaching_sync.machine_session_agg t`);
		try {
			await Promise.all(stores.map(store => store.open()));
			await stores[0].open();
			const status = await stores[0].status();
			expect(status.accounts).toEqual(expect.arrayContaining([
				expect.objectContaining({ id: 'paid', monthlyUsd: 175, feeSource: 'explicit' }),
				expect.objectContaining({ id: 'free', monthlyUsd: 0, feeSource: 'explicit' })
			]));
			expect(status.accounts).toHaveLength(2);
			expect(status.mappings).toHaveLength(2);
			const after = await db.query(`SELECT to_jsonb(t) - 'monetary' AS row FROM chaching_sync.machine_day_agg t UNION ALL SELECT to_jsonb(t) FROM chaching_sync.machine_hour_agg t UNION ALL SELECT to_jsonb(t) FROM chaching_sync.machine_session_agg t`);
			expect(after.rows).toEqual(before.rows);
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows).toEqual([{ version: 5 }]);
		} finally { await Promise.all(stores.map(store => store.close())); }
	});

	it('reads incompatible and missing schemas without migrating', async () => {
		const store = new PostgresSyncStore(url);
		try {
			expect(await store.readSchemaVersion()).toBe(3);
			expect((await db.query("SELECT to_regclass('chaching_sync.subscription') AS old_table")).rows[0].old_table).not.toBeNull();
			await db.query('UPDATE chaching_sync.schema_version SET version = 5');
			expect(await store.readSchemaVersion()).toBe(5);
			await db.query('DROP SCHEMA chaching_sync CASCADE');
			expect(await store.readSchemaVersion()).toBeNull();
			expect((await db.query("SELECT to_regnamespace('chaching_sync') AS schema")).rows[0].schema).toBeNull();
		} finally { await store.close(); }
	});

	it('enforces provider identity, nullable inferred fees and many-to-many links', async () => {
		const store = new PostgresSyncStore(url, 'pool', 'one');
		try {
			await store.open();
			await store.addAccount({ id: 'unknown', provider: 'claude', name: 'Unknown', account: '', tier: 'new', monthlyUsd: null, feeSource: 'inferred', identityKey: 'v1:opaque' });
			await store.linkAccount('one', 'claude', 'unknown');
			await store.linkAccount('one', 'claude', 'unknown');
			expect((await store.allMappings()).filter(row => row.machineId === 'one')).toHaveLength(2);
			expect(await store.mappedAccounts()).toEqual({ claude: null });
			expect((await store.status()).accounts.find(row => row.id === 'unknown')?.monthlyUsd).toBeNull();
			await expect(store.linkAccount('one', 'codex', 'unknown')).rejects.toThrow();
			await expect(store.addAccount({ id: 'duplicate', provider: 'claude', name: 'Duplicate', account: '', tier: 'new', monthlyUsd: 10, identityKey: 'v1:opaque' })).rejects.toThrow();
			await expect(store.addAccount({ id: 'bad', provider: 'claude', name: 'Bad', account: '', tier: 'custom', monthlyUsd: null })).rejects.toThrow();
			await store.mapAccount('one', 'claude', 'paid');
			expect(await store.mappedAccounts()).toEqual({ claude: 'paid' });
		} finally { await store.close(); }
	});

	it('discovers one bill across machines and preserves a migrated explicit fee', async () => {
		const one = new PostgresSyncStore(url, 'pool', 'one');
		const two = new PostgresSyncStore(url, 'pool', 'two');
		try {
			await Promise.all([one.open(), two.open()]);
			const account = { id: 'paid', provider: 'claude', name: 'Discovered', account: '', tier: 'max-20x', monthlyUsd: 200, feeSource: 'inferred', identityKey: 'v1:shared' } satisfies Parameters<typeof one.discoverAccount>[0];
			expect(await one.discoverAccount(account)).toBe('paid');
			const ids = await Promise.all([
				one.discoverAccount(account),
				two.discoverAccount({ ...account, id: 'other-local-id', monthlyUsd: 300, feeSource: 'explicit' })
			]);
			expect(ids).toEqual(['paid', 'paid']);
			const status = await one.status();
			expect(status.accounts.filter(a => a.provider === 'claude')).toEqual([
				expect.objectContaining({ id: 'paid', name: 'Work', monthlyUsd: 175, feeSource: 'explicit', identityKey: 'v1:shared' })
			]);
			expect(status.mappings.filter(m => m.provider === 'claude')).toHaveLength(2);
			const newAccount = { ...account, id: 'new-one', identityKey: 'v1:new', monthlyUsd: null };
			const newIds = await Promise.all([one.discoverAccount(newAccount), two.discoverAccount({ ...newAccount, id: 'new-two' })]);
			expect(new Set(newIds).size).toBe(1);
			await expect(one.discoverAccount({ ...account, identityKey: 'v1:wrong' })).rejects.toThrow('different provider identity');
			expect((await one.status()).accounts.filter(a => a.identityKey === 'v1:new')).toHaveLength(1);
		} finally { await Promise.all([one.close(), two.close()]); }
	});

	it('writes the shared bill and hydrates a peer without publishing private identity', async () => {
		const store = new PostgresSyncStore(url, 'pool', 'one');
		const cfg = defaultConfig();
		cfg.sync = { ...cfg.sync, enabled: true, databaseUrl: url, poolId: 'pool', machineId: 'one' };
		const identity = { accountId: 'private-login', userId: null };
		cfg.accounts = [{ id: 'paid', provider: 'claude', name: 'Edited work', tier: 'custom', monthlyUsd: 145, feeSource: 'explicit', identity, registrations: ['private-alias'], legacy: false }];
		cfg.providerAccounts = { claude: ['paid'] };
		try {
			await writePoolAccount(cfg, cfg.accounts[0]);
			await store.open();
			const status = await store.status();
			expect(status.accounts.find(row => row.id === 'paid')).toMatchObject({ name: 'Edited work', monthlyUsd: 145, identityKey: accountIdentityKey('claude', identity, 'pool') });
			expect(JSON.stringify(status)).not.toMatch(/private-login|private-alias/);
			const peer = { ...cfg, accounts: [{ ...cfg.accounts[0], id: 'peer-local', name: 'Old name', monthlyUsd: 200 }], providerAccounts: { claude: ['peer-local'] } };
			expect(applyPoolAccountDetails(peer, status).accounts[0]).toMatchObject({ id: 'peer-local', name: 'Edited work', monthlyUsd: 145, identity, registrations: ['private-alias'] });
			await writePoolAccount(cfg, { ...cfg.accounts[0], monthlyUsd: 0 });
			expect((await store.status()).accounts.find(row => row.id === 'paid')?.monthlyUsd).toBe(0);
			const renamed = await writePoolAccount(cfg, cfg.accounts[0], { name: 'Renamed only' });
			expect(renamed).toMatchObject({ name: 'Renamed only', monthlyUsd: 0 });
			await expect(store.updateAccountDetails({ ...cfg.accounts[0], monthlyUsd: -1 })).rejects.toThrow();
			expect((await store.status()).accounts.find(row => row.id === 'paid')?.monthlyUsd).toBe(0);
		} finally { await store.close(); }
	});

	it('rejects obsolete writes from an open connection and rolls back a fresh v3 migration', async () => {
		const oldClient = await db.connect();
		const store = new PostgresSyncStore(url, 'pool', 'one');
		try {
			await oldClient.query('SELECT * FROM chaching_sync.subscription');
			await store.open();
			await expect(oldClient.query(`INSERT INTO chaching_sync.subscription (pool_id,id,provider,name,tier,monthly_usd) VALUES ('pool','old','claude','Old','free',0)`)).rejects.toThrow();
			await expect(oldClient.query(`UPDATE chaching_sync.machine_subscription SET subscription_id=NULL`)).rejects.toThrow();
			await oldClient.query('BEGIN');
			await expect(oldClient.query(v3)).rejects.toThrow(/account_schema_min_version/);
			await oldClient.query('ROLLBACK');
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows[0].version).toBe(5);
			expect((await db.query("SELECT to_regclass('chaching_sync.subscription') AS old")).rows[0].old).toBeNull();
		} finally { oldClient.release(); await store.close(); }
	});

	it('rolls back all schema changes when a legacy link conflicts with its provider', async () => {
		await db.query("UPDATE chaching_sync.machine_subscription SET subscription_id='free' WHERE machine_id='one' AND provider='claude'");
		const store = new PostgresSyncStore(url, 'pool', 'one');
		try {
			await expect(store.open()).rejects.toThrow();
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows[0].version).toBe(3);
			expect((await db.query('SELECT count(*)::int AS n FROM chaching_sync.subscription')).rows[0].n).toBe(2);
			expect((await db.query("SELECT to_regclass('chaching_sync.account') AS account")).rows[0].account).toBeNull();
		} finally { await store.close(); }
	});

	it('rejects a future schema without attempting downgrade', async () => {
		await db.query('UPDATE chaching_sync.schema_version SET version=6');
		const store = new PostgresSyncStore(url, 'pool', 'one');
		try {
			await expect(store.open()).rejects.toThrow('Unsupported pool schema version 6');
			expect((await db.query('SELECT version FROM chaching_sync.schema_version')).rows[0].version).toBe(6);
		} finally { await store.close(); }
	});
});
