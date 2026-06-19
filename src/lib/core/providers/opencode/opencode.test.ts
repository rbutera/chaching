import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readOpenCodeSessions } from './sqlite';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('opencode SQLite provider', () => {
	it('maps session totals from the local opencode database', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'chaching-opencode-'));
		tempDirs.push(dir);
		const dbPath = join(dir, 'opencode.db');
		const db = new DatabaseSync(dbPath);
		db.exec(`CREATE TABLE session (
			id text PRIMARY KEY,
			path text,
			agent text,
			model text,
			cost real DEFAULT 0 NOT NULL,
			tokens_input integer DEFAULT 0 NOT NULL,
			tokens_output integer DEFAULT 0 NOT NULL,
			tokens_reasoning integer DEFAULT 0 NOT NULL,
			tokens_cache_read integer DEFAULT 0 NOT NULL,
			tokens_cache_write integer DEFAULT 0 NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL
		)`);
		db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			'ses_1',
			'Users/rai/project',
			'Sisyphus',
			JSON.stringify({ id: 'minimax-m3', providerID: 'opencode-go' }),
			0.25,
			100,
			20,
			5,
			300,
			10,
			1781881071000,
			1781881079000
		);
		db.close();

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			key: 'opencode:ses_1',
			provider: 'opencode',
			model: 'opencode-go/minimax-m3',
			sessionId: 'ses_1',
			project: 'Users/rai/project',
			cost: 0.25,
			tokens: { input: 100, output: 25, cacheCreation: 10, cacheRead: 300 }
		});
	});
});
