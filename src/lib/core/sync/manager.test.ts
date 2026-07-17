import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearConfigCache,
	configFilePath,
	defaultConfig,
	type chachingConfig
} from '../config';
import { assertCursorScopeReady, parseIntervalMinutes, setSyncInterval } from './manager';

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
