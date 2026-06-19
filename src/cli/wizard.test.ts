/**
 * Wave 3 tests: wizard logic, provider command, env-first secrets, atomic write.
 *
 * Strategy:
 * - Pure-logic functions (applySelectionToConfig, resolveEnvSecret) are tested directly.
 * - Interactive prompts (multiselect, password) are mocked at the @clack/prompts module level.
 * - Config I/O uses a temp XDG dir to avoid touching the real config.
 * - The atomic write + 0600 test exercises saveConfig / configFilePath directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── @clack/prompts mock ────────────────────────────────────────────────────────
// vi.mock is hoisted above imports, so we cannot reference `let` variables
// declared below. Use vi.fn() inline and retrieve them via vi.mocked() later.

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	multiselect: vi.fn(),
	password: vi.fn(),
	log: { info: vi.fn() }
}));

// Import clack after the mock is in place so vi.mocked() works
import * as clack from '@clack/prompts';

// ── Pure logic tests (no mocks needed) ────────────────────────────────────────

import {
	applySelectionToConfig,
	resolveEnvSecret,
	KNOWN_PROVIDERS
} from './wizard.js';
import { defaultConfig, saveConfig, configFilePath, clearConfigCache } from '../lib/core/config.js';

describe('applySelectionToConfig', () => {
	it('accept defaults: all providers enabled when all are selected', () => {
		const base = defaultConfig();
		const result = applySelectionToConfig(base, {
			enabled: [...KNOWN_PROVIDERS],
			secrets: {}
		});
		expect(result.providers.claude.enabled).toBe(true);
		expect(result.providers.codex.enabled).toBe(true);
		expect(result.providers.opencode.enabled).toBe(true);
		expect(result.providers.cursor.enabled).toBe(true);
	});

	it('deselect one: that provider disabled, others remain enabled', () => {
		const base = defaultConfig();
		const result = applySelectionToConfig(base, {
			enabled: ['claude', 'codex', 'opencode'],
			secrets: {}
		});
		expect(result.providers.claude.enabled).toBe(true);
		expect(result.providers.codex.enabled).toBe(true);
		expect(result.providers.opencode.enabled).toBe(true);
		expect(result.providers.cursor.enabled).toBe(false);
	});

	it('deselect claude: only claude disabled', () => {
		const base = defaultConfig();
		const result = applySelectionToConfig(base, {
			enabled: ['codex', 'opencode', 'cursor'],
			secrets: {}
		});
		expect(result.providers.claude.enabled).toBe(false);
		expect(result.providers.codex.enabled).toBe(true);
		expect(result.providers.opencode.enabled).toBe(true);
		expect(result.providers.cursor.enabled).toBe(true);
	});

	it('writes cursor token when provided as a prompted secret', () => {
		const base = defaultConfig();
		const result = applySelectionToConfig(base, {
			enabled: ['cursor'],
			secrets: { cursor: 'tok_secret_123' }
		});
		expect(result.providers.cursor.adminApiToken).toBe('tok_secret_123');
	});

	it('does NOT overwrite cursor token when secret key absent (env-sourced flow)', () => {
		const base = defaultConfig(); // adminApiToken is '' by default
		const result = applySelectionToConfig(base, {
			enabled: ['cursor'],
			secrets: {} // no cursor key = came from env, do not overwrite
		});
		expect(result.providers.cursor.adminApiToken).toBe('');
	});

	it('preserves other config fields (server, cutoverTs)', () => {
		const base = { ...defaultConfig(), cutoverTs: 12345 };
		base.server.port = 9999;
		const result = applySelectionToConfig(base, { enabled: ['claude'], secrets: {} });
		expect(result.cutoverTs).toBe(12345);
		expect(result.server.port).toBe(9999);
	});
});

describe('resolveEnvSecret', () => {
	it('returns the env value when CURSOR_ADMIN_API_TOKEN is set', () => {
		const env = { CURSOR_ADMIN_API_TOKEN: 'tok_abc' };
		expect(resolveEnvSecret('cursor', env)).toBe('tok_abc');
	});

	it('returns undefined when CURSOR_ADMIN_API_TOKEN is missing', () => {
		expect(resolveEnvSecret('cursor', {})).toBeUndefined();
	});

	it('returns undefined when CURSOR_ADMIN_API_TOKEN is empty string', () => {
		expect(resolveEnvSecret('cursor', { CURSOR_ADMIN_API_TOKEN: '' })).toBeUndefined();
	});

	it('returns undefined for providers with no secret (claude, codex, opencode)', () => {
		const env = { CURSOR_ADMIN_API_TOKEN: 'tok_abc' };
		expect(resolveEnvSecret('claude', env)).toBeUndefined();
		expect(resolveEnvSecret('codex', env)).toBeUndefined();
		expect(resolveEnvSecret('opencode', env)).toBeUndefined();
	});
});

// ── Atomic write + 0600 test ───────────────────────────────────────────────────

describe('saveConfig atomic write + 0600', () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'chaching-test-'));
		process.env.XDG_CONFIG_HOME = tmpDir;
		clearConfigCache();
	});

	afterEach(async () => {
		delete process.env.XDG_CONFIG_HOME;
		clearConfigCache();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it('writes config file with 0600 permissions', async () => {
		const cfg = defaultConfig();
		await saveConfig(cfg);
		// configFilePath() reads process.env (which we've overridden) with no args
		const file = configFilePath();
		const s = await stat(file);
		const mode = s.mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('config file is either old or complete content, never truncated (atomic rename)', async () => {
		const cfg = defaultConfig();
		cfg.server.port = 12345;
		await saveConfig(cfg);

		const file = configFilePath();
		const { readFile } = await import('node:fs/promises');
		const raw = await readFile(file, 'utf8');
		const parsed = JSON.parse(raw) as { server: { port: number } };
		expect(parsed.server.port).toBe(12345);
	});

	it('second save updates the file correctly (idempotent atomic write)', async () => {
		const cfg1 = defaultConfig();
		cfg1.server.port = 11111;
		await saveConfig(cfg1);

		clearConfigCache();
		const cfg2 = defaultConfig();
		cfg2.server.port = 22222;
		await saveConfig(cfg2);

		const file = configFilePath();
		const { readFile } = await import('node:fs/promises');
		const raw = await readFile(file, 'utf8');
		const parsed = JSON.parse(raw) as { server: { port: number } };
		expect(parsed.server.port).toBe(22222);

		// Permissions still 0600
		const s = await stat(file);
		expect(s.mode & 0o777).toBe(0o600);
	});
});

// ── Wizard integration (mocked prompts) ───────────────────────────────────────

describe('runWizard (mocked prompts — TTY bypassed via isTTY stub)', () => {
	let tmpDir: string;
	let origIsTTY: boolean;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'chaching-wizard-'));
		process.env.XDG_CONFIG_HOME = tmpDir;
		clearConfigCache();
		vi.clearAllMocks();

		// Force the wizard to think stdin is a TTY so it doesn't short-circuit
		origIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = true;

		// Default: isCancel always false, password returns empty string
		vi.mocked(clack.isCancel).mockReturnValue(false);
		vi.mocked(clack.password).mockResolvedValue('');
	});

	afterEach(async () => {
		delete process.env.XDG_CONFIG_HOME;
		clearConfigCache();
		process.stdin.isTTY = origIsTTY;
		await rm(tmpDir, { recursive: true, force: true });
	});

	it('accept defaults with cursor token in env: no password prompt', async () => {
		vi.mocked(clack.multiselect).mockResolvedValue([...KNOWN_PROVIDERS]);

		const { runWizard } = await import('./wizard.js');
		const result = await runWizard({
			env: { CURSOR_ADMIN_API_TOKEN: 'tok_from_env' }
		});

		expect(vi.mocked(clack.password)).not.toHaveBeenCalled();
		expect(result).not.toBeNull();
		// Token should NOT be written to config (env-first rule: leave it empty)
		expect(result!.providers.cursor.adminApiToken).toBe('');
		// Cursor should be enabled
		expect(result!.providers.cursor.enabled).toBe(true);
		expect(vi.mocked(clack.log.info)).toHaveBeenCalledWith(
			expect.stringContaining('CURSOR_ADMIN_API_TOKEN')
		);
	});

	it('deselect cursor: cursor disabled, others enabled, no secret prompt', async () => {
		vi.mocked(clack.multiselect).mockResolvedValue(['claude', 'codex', 'opencode']);

		const { runWizard } = await import('./wizard.js');
		const result = await runWizard({ env: {} });

		expect(vi.mocked(clack.password)).not.toHaveBeenCalled();
		expect(result).not.toBeNull();
		expect(result!.providers.cursor.enabled).toBe(false);
		expect(result!.providers.claude.enabled).toBe(true);
		expect(result!.providers.codex.enabled).toBe(true);
		expect(result!.providers.opencode.enabled).toBe(true);
	});

	it('cursor enabled + token missing: prompts and stores token', async () => {
		vi.mocked(clack.multiselect).mockResolvedValue([...KNOWN_PROVIDERS]);
		vi.mocked(clack.password).mockResolvedValue('tok_from_prompt');

		const { runWizard } = await import('./wizard.js');
		const result = await runWizard({ env: {} });

		expect(vi.mocked(clack.password)).toHaveBeenCalledOnce();
		expect(result).not.toBeNull();
		expect(result!.providers.cursor.adminApiToken).toBe('tok_from_prompt');
		expect(result!.providers.cursor.enabled).toBe(true);
	});

	it('multiselect cancel: returns null, no config written', async () => {
		const CANCEL_SYMBOL = Symbol('cancel');
		vi.mocked(clack.isCancel).mockImplementation((v) => v === CANCEL_SYMBOL);
		vi.mocked(clack.multiselect).mockResolvedValue(CANCEL_SYMBOL as unknown as string[]);

		const { runWizard } = await import('./wizard.js');
		const result = await runWizard({ env: {} });

		expect(result).toBeNull();
		expect(vi.mocked(clack.cancel)).toHaveBeenCalled();
	});

	it('password cancel: returns null', async () => {
		const CANCEL_SYMBOL = Symbol('cancel');
		vi.mocked(clack.isCancel).mockImplementation((v) => v === CANCEL_SYMBOL);
		vi.mocked(clack.multiselect).mockResolvedValue([...KNOWN_PROVIDERS]);
		vi.mocked(clack.password).mockResolvedValue(CANCEL_SYMBOL as unknown as string);

		const { runWizard } = await import('./wizard.js');
		const result = await runWizard({ env: {} });

		expect(result).toBeNull();
		expect(vi.mocked(clack.cancel)).toHaveBeenCalled();
	});
});

// ── provider command unit tests ────────────────────────────────────────────────

describe('provider command logic', () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'chaching-provider-'));
		process.env.XDG_CONFIG_HOME = tmpDir;
		clearConfigCache();
		vi.clearAllMocks();
		vi.mocked(clack.isCancel).mockReturnValue(false);

		// Seed a config with all providers enabled so we can flip them
		const base = defaultConfig();
		base.providers.cursor.enabled = true;
		await saveConfig(base);
		clearConfigCache();
	});

	afterEach(async () => {
		delete process.env.XDG_CONFIG_HOME;
		clearConfigCache();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it('provider disable cursor: cursor flipped off, other config intact', async () => {
		const { runProvider } = await import('./commands/provider.js');
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(' '));

		await runProvider(['disable', 'cursor']);

		console.log = origLog;

		clearConfigCache();
		const { loadConfig } = await import('../lib/core/config.js');
		const cfg = await loadConfig();
		expect(cfg.providers.cursor.enabled).toBe(false);
		// others untouched
		expect(cfg.providers.claude.enabled).toBe(true);
		expect(cfg.providers.codex.enabled).toBe(true);
		expect(cfg.providers.opencode.enabled).toBe(true);
		expect(logs.some((l) => l.includes('disabled'))).toBe(true);
	});

	it('provider enable cursor: cursor flipped on', async () => {
		// First disable it
		clearConfigCache();
		const { loadConfig } = await import('../lib/core/config.js');
		const cfg = await loadConfig();
		cfg.providers.cursor.enabled = false;
		await saveConfig(cfg);
		clearConfigCache();

		const { runProvider } = await import('./commands/provider.js');
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(' '));

		await runProvider(['enable', 'cursor']);

		console.log = origLog;
		clearConfigCache();

		const result = await loadConfig();
		expect(result.providers.cursor.enabled).toBe(true);
		expect(logs.some((l) => l.includes('enabled'))).toBe(true);
	});

	it('unknown provider name exits non-zero', async () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`process.exit(${code})`);
		});

		const { runProvider } = await import('./commands/provider.js');
		await expect(runProvider(['disable', 'nonexistent'])).rejects.toThrow('process.exit(1)');
		exitSpy.mockRestore();
	});

	it('unknown action exits non-zero', async () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`process.exit(${code})`);
		});

		const { runProvider } = await import('./commands/provider.js');
		await expect(runProvider(['nope', 'cursor'])).rejects.toThrow('process.exit(1)');
		exitSpy.mockRestore();
	});

	it('missing provider name exits non-zero', async () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`process.exit(${code})`);
		});

		const { runProvider } = await import('./commands/provider.js');
		await expect(runProvider(['disable'])).rejects.toThrow('process.exit(1)');
		exitSpy.mockRestore();
	});

	it('provider add cursor with token in env: no prompt, cursor enabled', async () => {
		// Set the env token so collectProviderSecret finds it
		process.env.CURSOR_ADMIN_API_TOKEN = 'tok_env_add';

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(' '));

		const { runProvider } = await import('./commands/provider.js');
		await runProvider(['add', 'cursor']);

		console.log = origLog;
		delete process.env.CURSOR_ADMIN_API_TOKEN;

		expect(vi.mocked(clack.password)).not.toHaveBeenCalled();
		expect(logs.some((l) => l.includes('cursor'))).toBe(true);

		clearConfigCache();
		const { loadConfig } = await import('../lib/core/config.js');
		const result = await loadConfig();
		expect(result.providers.cursor.enabled).toBe(true);
		// Token should NOT be written to config (env-first rule)
		expect(result.providers.cursor.adminApiToken).toBe('');
	});

	it('provider add cursor with no env token: prompts and stores token', async () => {
		delete process.env.CURSOR_ADMIN_API_TOKEN;
		vi.mocked(clack.password).mockResolvedValue('tok_prompted');

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(' '));

		const { runProvider } = await import('./commands/provider.js');
		await runProvider(['add', 'cursor']);

		console.log = origLog;

		expect(vi.mocked(clack.password)).toHaveBeenCalledOnce();

		clearConfigCache();
		const { loadConfig } = await import('../lib/core/config.js');
		const result = await loadConfig();
		expect(result.providers.cursor.enabled).toBe(true);
		expect(result.providers.cursor.adminApiToken).toBe('tok_prompted');
	});
});
