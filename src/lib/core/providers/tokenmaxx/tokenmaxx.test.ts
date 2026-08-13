import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTokenmaxxAggregates, readTokenmaxxQuota } from './sqlite';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('readTokenmaxxAggregates', () => {
	it('returns no rows when Tokenmaxx is not installed', () => {
		expect(readTokenmaxxAggregates('/definitely/missing/state.sqlite')).toEqual([]);
	});

	it('groups proxy events by UTC day, provider, and model', async () => {
		const root = await mkdtemp(join(tmpdir(), 'chaching-tokenmaxx-'));
		roots.push(root);
		const dbPath = join(root, 'state.sqlite');
		const db = new DatabaseSync(dbPath);
		db.exec(`
			CREATE TABLE token_events (
				at INTEGER NOT NULL,
				provider TEXT NOT NULL,
				account_id TEXT,
				model TEXT,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				cache_read_tokens INTEGER NOT NULL,
				cache_creation_tokens INTEGER NOT NULL
			)
		`);
		const insert = db.prepare(
			'INSERT INTO token_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		);
		insert.run(Date.parse('2026-08-11T23:59:00Z'), 'anthropic', 'a1', 'claude-opus-5', 1, 2, 3, 4);
		insert.run(Date.parse('2026-08-11T23:59:30Z'), 'anthropic', 'a2', 'claude-opus-5', 10, 20, 30, 40);
		insert.run(Date.parse('2026-08-12T00:00:00Z'), 'openai', 'o1', 'gpt-5.6-sol', 5, 6, 7, 8);
		db.close();

		expect(readTokenmaxxAggregates(dbPath)).toEqual([
			{
				day: '2026-08-11',
				provider: 'claude',
				model: 'claude-opus-5',
				tokens: { input: 11, output: 22, cacheRead: 33, cacheCreation: 44 },
				requests: 2,
				firstTs: Date.parse('2026-08-11T23:59:00Z'),
				lastTs: Date.parse('2026-08-11T23:59:30Z')
			},
			{
				day: '2026-08-12',
				provider: 'codex',
				model: 'gpt-5.6-sol',
				tokens: { input: 5, output: 6, cacheRead: 7, cacheCreation: 8 },
				requests: 1,
				firstTs: Date.parse('2026-08-12T00:00:00Z'),
				lastTs: Date.parse('2026-08-12T00:00:00Z')
			}
		]);
	});

	it('returns sanitized Anthropic quota windows without account identity or ids', async () => {
		const root = await mkdtemp(join(tmpdir(), 'chaching-tokenmaxx-quota-'));
		roots.push(root);
		const dbPath = join(root, 'state.sqlite');
		const db = new DatabaseSync(dbPath);
		db.exec(`
			CREATE TABLE accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, payload TEXT NOT NULL);
			CREATE TABLE usage_snapshots (account_id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, payload TEXT NOT NULL);
		`);
		db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run(
			'internal-account-id',
			'anthropic',
			JSON.stringify({ identity: 'private@example.com', plan: 'default_claude_max_20x' })
		);
		db.prepare('INSERT INTO usage_snapshots VALUES (?, ?, ?)').run(
			'internal-account-id',
			'2026-08-13T22:00:00Z',
			JSON.stringify({
				hardLimitReached: false,
				windows: [{ id: 'weekly_all', label: '7 day · all models', usedPercent: 91, resetAt: '2026-08-15T04:00:00Z' }]
			})
		);
		db.close();

		const quota = readTokenmaxxQuota(dbPath);
		expect(quota).toEqual({
			observedAt: '2026-08-13T22:00:00Z',
			accounts: [{
				label: 'Claude account 1',
				provider: 'claude',
				plan: 'default_claude_max_20x',
				hardLimitReached: false,
				windows: [{ id: 'weekly_all', label: '7 day · all models', usedPercent: 91, resetAt: '2026-08-15T04:00:00Z' }]
			}]
		});
		expect(JSON.stringify(quota)).not.toContain('private@example.com');
		expect(JSON.stringify(quota)).not.toContain('internal-account-id');
	});
});
