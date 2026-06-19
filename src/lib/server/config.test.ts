import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFileMode, configFilePath, defaultConfig, normalizeConfig, publicConfig, saveConfig } from './config';

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
		expect(cfg.server).toEqual({ host: '127.0.0.1', port: 9999 });
		expect(cfg.providers.claude).toEqual({ enabled: false, roots: ['~/claude-data'] });
		expect(cfg.providers.codex).toEqual({ enabled: true, root: '~/codex-sessions' });
		expect(cfg.providers.cursor).toEqual({
			enabled: true,
			adminApiToken: 'crsr_test',
			email: 'rai@example.com',
			pollSeconds: 3600
		});
		expect(cfg.providers.opencode).toEqual({ enabled: true, dbPath: '~/opencode.db' });
	});

	it('defaults to local file providers and disabled API providers', () => {
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
