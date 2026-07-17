import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearConfigCache, configFileMode, configFilePath, defaultConfig, loadConfig, normalizeConfig, publicConfig, saveConfig } from './config';

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
			roots: ['~/claude-data'],
			subscription: { tier: 'corporate', monthlyUsd: 99 }
		});
		expect(cfg.providers.codex).toEqual({
			enabled: true,
			root: '~/codex-sessions',
			subscription: { tier: 'corporate', monthlyUsd: 99 }
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
			providerSubscriptions: { claude: 'work-claude' },
			databaseConfigured: true
		});
		expect(JSON.stringify(publicConfig(cfg))).not.toContain('secret@kinto');
	});

	it('defaults missing subscription to Corporate $99 (old v1.5.0 config loads unchanged)', () => {
		// A pre-subscription config: claude/codex with no subscription block.
		const cfg = normalizeConfig({
			providers: {
				claude: { enabled: true, roots: ['~/.claude'] },
				codex: { enabled: true, root: '~/.codex/sessions' }
			}
		});
		expect(cfg.providers.claude.subscription).toEqual({ tier: 'corporate', monthlyUsd: 99 });
		expect(cfg.providers.codex.subscription).toEqual({ tier: 'corporate', monthlyUsd: 99 });
	});

	it('round-trip normalize is idempotent and preserves a custom subscription', () => {
		const once = normalizeConfig({
			providers: {
				claude: { enabled: true, roots: ['~/.claude'], subscription: { tier: 'custom', monthlyUsd: 250 } },
				codex: { enabled: true, root: '~/.codex/sessions', subscription: { tier: 'max-5x', monthlyUsd: 100 } }
			}
		});
		const twice = normalizeConfig(once);
		expect(twice).toEqual(once);
		expect(twice.providers.claude.subscription).toEqual({ tier: 'custom', monthlyUsd: 250 });
		expect(twice.providers.codex.subscription).toEqual({ tier: 'max-5x', monthlyUsd: 100 });
	});

	it('clamps an invalid monthlyUsd (string / negative / NaN) without throwing; $0 allowed', () => {
		const fromString = normalizeConfig({
			providers: { claude: { subscription: { tier: 'pro', monthlyUsd: 'not-a-number' } } }
		});
		expect(fromString.providers.claude.subscription.monthlyUsd).toBe(99); // default fee
		expect(fromString.providers.claude.subscription.tier).toBe('pro'); // tier kept

		const negative = normalizeConfig({
			providers: { codex: { subscription: { tier: 'go', monthlyUsd: -5 } } }
		});
		expect(negative.providers.codex.subscription.monthlyUsd).toBe(99);

		const free = normalizeConfig({
			providers: { claude: { subscription: { tier: 'free', monthlyUsd: 0 } } }
		});
		expect(free.providers.claude.subscription.monthlyUsd).toBe(0); // $0 is valid (Free)
	});

	it('cursor and opencode never carry a subscription field', () => {
		const cfg = normalizeConfig({});
		expect('subscription' in cfg.providers.cursor).toBe(false);
		expect('subscription' in cfg.providers.opencode).toBe(false);
	});

	it('subscription survives a save → reload round trip and stays 0600', async () => {
		const previous = process.env.XDG_CONFIG_HOME;
		const dir = await mkdtemp(join(tmpdir(), 'chaching-sub-test-'));
		process.env.XDG_CONFIG_HOME = dir;
		try {
			const cfg = defaultConfig();
			cfg.providers.claude.subscription = { tier: 'max-20x', monthlyUsd: 200 };
			await saveConfig(cfg);
			expect(await configFileMode()).toBe(0o600);
			clearConfigCache();
			const reloaded = await loadConfig();
			expect(reloaded.providers.claude.subscription).toEqual({ tier: 'max-20x', monthlyUsd: 200 });
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('an additive subscription patch (the /api/config merge) preserves cutover + the other provider', async () => {
		// Mirrors the POST /api/config merge: load, splice one provider's subscription,
		// saveConfig. A subscription-only write must not touch cutoverTs or codex.
		const previous = process.env.XDG_CONFIG_HOME;
		const dir = await mkdtemp(join(tmpdir(), 'chaching-patch-test-'));
		process.env.XDG_CONFIG_HOME = dir;
		try {
			const base = defaultConfig();
			base.cutoverTs = 1_700_000_000_000;
			base.providers.codex.subscription = { tier: 'plus', monthlyUsd: 20 };
			await saveConfig(base);
			clearConfigCache();

			const loaded = await loadConfig();
			const patched = {
				...loaded,
				providers: {
					...loaded.providers,
					claude: {
						...loaded.providers.claude,
						subscription: { tier: 'max-20x', monthlyUsd: 200 }
					}
				}
			};
			await saveConfig(patched);
			clearConfigCache();

			const reloaded = await loadConfig();
			expect(reloaded.providers.claude.subscription).toEqual({ tier: 'max-20x', monthlyUsd: 200 });
			expect(reloaded.providers.codex.subscription).toEqual({ tier: 'plus', monthlyUsd: 20 });
			expect(reloaded.cutoverTs).toBe(1_700_000_000_000);
			expect(await configFileMode()).toBe(0o600);
		} finally {
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
			await saveConfig(defaultConfig());
			expect(await configFileMode()).toBe(0o600);
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});
});
