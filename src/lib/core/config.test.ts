import { mkdtemp, rm, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountConfigProblems, accountFeesByProvider } from './accounts';
import { clearConfigCache, configFileMode, configFilePath, defaultConfig, loadConfig, normalizeConfig, publicConfig, updateConfig } from './config';

describe('config', () => {
	it('builds the config path from XDG_CONFIG_HOME when present', () => {
		expect(configFilePath({ env: { XDG_CONFIG_HOME: '/tmp/xdg' }, homeDir: '/home/rai' })).toBe(
			join('/tmp/xdg', 'chaching', 'config.json')
		);
	});

	it('uses process XDG_CONFIG_HOME by default at runtime', () => {
		const previous = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = '/tmp/process-xdg';
		try {
			expect(configFilePath({ homeDir: '/home/rai' })).toBe(join('/tmp/process-xdg', 'chaching', 'config.json'));
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
		}
	});

	it('normalizes provider config while preserving safe defaults', () => {
		const cfg = normalizeConfig({
			cutoverTs: 123,
			server: { host: '127.0.0.1', port: 9999 },
			providers: {
				claude: { enabled: false, roots: ['~/claude-data'] },
				codex: { enabled: true, root: '~/codex-sessions' },
				cursor: { enabled: true, adminApiToken: 'crsr_test', email: 'rai@example.com', pollSeconds: 3600 },
				opencode: { enabled: true, dbPath: '~/opencode.db' }
			}
		});

		expect(cfg.cutoverTs).toBe(123);
		expect(cfg.server).toEqual({ host: '127.0.0.1', port: 9999, origin: '' });
		expect(cfg.providers.claude).toEqual({
			enabled: false,
			roots: ['~/claude-data']
		});
		expect(cfg.providers.codex).toEqual({
			enabled: true,
			root: '~/codex-sessions'
		});
		expect(cfg.providers.cursor).toEqual({
			enabled: true,
			adminApiToken: 'crsr_test',
			email: 'rai@example.com',
			pollSeconds: 3600
		});
		expect(cfg.providers.opencode).toEqual({ enabled: true, dbPath: '~/opencode.db' });
	});

	it('defaults to local file providers and disabled API providers', () => {
		expect(defaultConfig().server.host).toBe('127.0.0.1');
		expect(defaultConfig().providers.claude.enabled).toBe(true);
		expect(defaultConfig().providers.codex.enabled).toBe(true);
		expect(defaultConfig().providers.opencode.enabled).toBe(true);
		expect(defaultConfig().providers.cursor.enabled).toBe(false);
		expect(defaultConfig().providers.pi).toEqual({
			enabled: true,
			roots: ['~/.pi/agent/sessions', '~/.omp/agent/sessions']
		});
	});

	it('normalizes plural and legacy Pi-family session roots without surprising custom configs', () => {
		expect(
			normalizeConfig({ providers: { pi: { roots: ['~/pi-a', '~/omp-b'] } } }).providers.pi.roots
		).toEqual(['~/pi-a', '~/omp-b']);
		expect(
			normalizeConfig({ providers: { pi: { root: '~/.pi/agent/sessions' } } }).providers.pi.roots
		).toEqual(['~/.pi/agent/sessions', '~/.omp/agent/sessions']);
		expect(
			normalizeConfig({ providers: { pi: { root: '/Volumes/archive/pi-sessions' } } }).providers.pi
				.roots
		).toEqual(['/Volumes/archive/pi-sessions']);
	});

	it('prefers a non-empty plural Pi roots array over the legacy singular root', () => {
		const pi = normalizeConfig({
			providers: { pi: { root: '/legacy', roots: ['/explicit'] } }
		}).providers.pi;
		expect(pi.roots).toEqual(['/explicit']);
	});

	it('redacts Cursor admin API token from public config responses', () => {
		const cfg = normalizeConfig({
			providers: {
				cursor: { enabled: true, adminApiToken: 'crsr_secret', email: 'rai@example.com' }
			}
		});

		expect(publicConfig(cfg).providers.cursor).toEqual({
			enabled: true,
			email: 'rai@example.com',
			pollSeconds: 3600,
			adminApiTokenConfigured: true
		});
		expect(JSON.stringify(publicConfig(cfg))).not.toContain('crsr_secret');
	});

	it('redacts the PostgreSQL URL while exposing non-secret sync identity', () => {
		const cfg = normalizeConfig({
			sync: {
				enabled: true,
				databaseUrl: 'postgresql://chaching:secret@kinto:5432/chaching',
				poolId: 'pool-1',
				machineId: 'machine-1',
				machineName: 'kinto',
				providerSubscriptions: { claude: 'work-claude' }
			}
		});

		expect(publicConfig(cfg).sync).toEqual({
			enabled: true,
			poolId: 'pool-1',
			machineId: 'machine-1',
			machineName: 'kinto',
			intervalMinutes: 15,
			databaseConfigured: true
		});
		expect(JSON.stringify(publicConfig(cfg))).not.toContain('secret@kinto');
	});

	it('does not invent a bill for a provider without configured subscription settings', () => {
		const config = normalizeConfig({ providers: { claude: { enabled: true } } });
		expect(config.accounts).toEqual([]);
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBeNull();
	});

	it('preserves mapped IDs and explicit fees, infers known tiers and keeps unknown fees null', () => {
		const config = normalizeConfig({
			sync: { providerSubscriptions: { claude: 'pooled-account' } },
			providers: { claude: { subscription: { tier: 'custom', monthlyUsd: 250 } }, codex: { subscription: { tier: 'mystery' } } }
		});
		expect(config.accounts[0]).toMatchObject({ id: 'pooled-account', monthlyUsd: 250, feeSource: 'explicit', legacy: true });
		expect(config.accounts[1]).toMatchObject({ monthlyUsd: null, feeSource: 'inferred' });
		expect(config.providerAccounts.claude).toEqual(['pooled-account']);
		expect(normalizeConfig(config)).toEqual(config);
		expect(normalizeConfig({ providers: { codex: { subscription: { tier: 'plus' } } } }).accounts[0].monthlyUsd).toBe(20);
		expect(config.providers.claude).not.toHaveProperty('subscription');
	});

	it('counts linked Accounts once and marks partial fee knowledge unavailable', () => {
		const config = normalizeConfig({ providers: { claude: { subscription: { tier: 'custom', monthlyUsd: 100 } } } });
		const first = config.accounts[0];
		config.accounts.push({ ...first, id: 'second', monthlyUsd: 50 }, { ...first, id: 'unlinked', monthlyUsd: 900 });
		config.providerAccounts.claude = [first.id, first.id, 'second'];
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBe(150);
		config.accounts[1].monthlyUsd = null;
		config.accounts[1].feeSource = 'inferred';
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBeNull();
		config.providerAccounts.claude = [first.id, 'missing-private-id'];
		expect(accountFeesByProvider(config).claude.monthlyUsd).toBeNull();
		const problems = accountConfigProblems(config);
		expect(problems).toContain('1 broken Account link(s); repair providerAccounts in config.');
		expect(problems).toContain('1 Account fee(s) unknown; enter monthly fees in Settings.');
		expect(problems.join(' ')).not.toContain('missing-private-id');
	});

	it('migrates once with history disabled, backs up the original privately, and retains edits and aliases', async () => {
		const previous = process.env.XDG_CONFIG_HOME;
		const dir = await mkdtemp(join(tmpdir(), 'chaching-account-migration-'));
		process.env.XDG_CONFIG_HOME = dir;
		clearConfigCache();
		try {
			const original = JSON.stringify({ history: { enabled: false }, providers: { claude: { subscription: { tier: 'free', monthlyUsd: 0 } } } });
			await mkdir(join(dir, 'chaching'));
			await writeFile(configFilePath(), original);
			const configs = await Promise.all([loadConfig(), loadConfig(), loadConfig()]);
			expect(configs[1]).toEqual(configs[0]);
			const config = configs[0];
			const id = config.accounts[0].id;
			expect(config.accounts[0]).toMatchObject({ monthlyUsd: 0, feeSource: 'explicit' });
			expect(config.history.enabled).toBe(false);
			expect(await readFile(`${configFilePath()}.pre-accounts`, 'utf8')).toBe(original);
			expect((await stat(`${configFilePath()}.pre-accounts`)).mode & 0o777).toBe(0o600);
			config.accounts[0] = { ...config.accounts[0], tier: 'unknown', monthlyUsd: null, feeSource: 'inferred', identity: { accountId: 'private-external-id', userId: 'private-user-id' }, registrations: ['retired-registration'] };
			await updateConfig(() => config);
			clearConfigCache();
			const reloaded = await loadConfig();
			expect(reloaded.accounts[0]).toEqual(config.accounts[0]);
			expect(reloaded.providerAccounts.claude).toEqual([id]);
			expect(await configFileMode()).toBe(0o600);
			const publicJson = JSON.stringify(publicConfig(reloaded));
			expect(publicJson).not.toContain('private-external-id');
			expect(publicJson).not.toContain('private-user-id');
			expect(publicJson).not.toContain('retired-registration');
			expect(await readFile(`${configFilePath()}.pre-accounts`, 'utf8')).toBe(original);
		} finally {
			clearConfigCache();
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('gives concurrent processes the same migrated Account IDs', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'chaching-concurrent-config-'));
		try {
			await mkdir(join(dir, 'chaching'));
			await writeFile(join(dir, 'chaching/config.json'), JSON.stringify({ providers: { claude: { subscription: { tier: 'custom', monthlyUsd: 173 } } } }));
			await build({ entry: ['src/lib/core/config.ts'], outDir: join(dir, 'bundle'), format: ['esm'], platform: 'node', silent: true, dts: false, outExtension: () => ({ js: '.mjs' }) });
			const code = `const config = await import(${JSON.stringify(pathToFileURL(join(dir, 'bundle/config.mjs')).href)}); console.log(JSON.stringify(await config.loadConfig()));`;
			const results = await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, XDG_CONFIG_HOME: dir } })));
			const stored = JSON.parse(await readFile(join(dir, 'chaching/config.json'), 'utf8'));
			for (const result of results) expect(JSON.parse(result.stdout)).toEqual(stored);
			expect(stored.accounts).toHaveLength(1);
			expect(stored.accounts[0].monthlyUsd).toBe(173);
			const edit = `const config = await import(${JSON.stringify(pathToFileURL(join(dir, 'bundle/config.mjs')).href)}); await config.loadConfig(); await new Promise(r => setTimeout(r, 100)); await config.updateConfig(current => ({ ...current, cutoverTs: (current.cutoverTs ?? 0) + 1 }));`;
			await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', edit], { env: { ...process.env, XDG_CONFIG_HOME: dir } })));
			const edited = JSON.parse(await readFile(join(dir, 'chaching/config.json'), 'utf8'));
			expect(edited.cutoverTs).toBe(8);
			expect(edited.accounts).toEqual(stored.accounts);
		} finally { await rm(dir, { recursive: true, force: true }); }
	}, 30_000);

	it('rejects future config versions and malformed files without replacing them', async () => {
		const previous = process.env.XDG_CONFIG_HOME;
		const dir = await mkdtemp(join(tmpdir(), 'chaching-future-config-'));
		process.env.XDG_CONFIG_HOME = dir;
		clearConfigCache();
		try {
			await mkdir(join(dir, 'chaching'));
			for (const original of ['{"version":2}', '{broken']) {
				await writeFile(configFilePath(), original);
				await expect(loadConfig()).rejects.toThrow();
				expect(await readFile(configFilePath(), 'utf8')).toBe(original);
			}
		} finally {
			clearConfigCache();
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('writes config files with owner-only permissions', async () => {
		const previous = process.env.XDG_CONFIG_HOME;
		const dir = await mkdtemp(join(tmpdir(), 'chaching-config-test-'));
		process.env.XDG_CONFIG_HOME = dir;
		try {
			await updateConfig(() => defaultConfig());
			expect(await configFileMode()).toBe(0o600);
			const before = await readFile(configFilePath(), 'utf8');
			await expect(updateConfig(async cfg => {
				cfg.cutoverTs = 123;
				throw new Error('Pool write failed');
			})).rejects.toThrow('Pool write failed');
			expect(await readFile(configFilePath(), 'utf8')).toBe(before);
			await updateConfig(async cfg => ({ ...cfg, cutoverTs: 456 }));
			expect((await loadConfig()).cutoverTs).toBe(456);
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});
});
