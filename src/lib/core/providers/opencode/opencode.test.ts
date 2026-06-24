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

// Real assistant `data` blobs from the kinto OpenCode DB, sanitized to neutral
// paths. The `message` table is (id, session_id, time_created, time_updated, data)
// where data is a JSON text blob.

const OPENAI_TOKENS = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'worker',
	agent: 'worker',
	variant: 'high',
	path: { cwd: '/Users/dev/x', root: '/' },
	cost: 0,
	tokens: { total: 99100, input: 4574, output: 157, reasoning: 161, cache: { write: 0, read: 94208 } },
	modelID: 'gpt-5.5',
	providerID: 'openai',
	time: { created: 1781887102013, completed: 1781887111224 },
	finish: 'stop'
};

const CURSOR_ACP_TOKENS = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'worker',
	agent: 'worker',
	path: { cwd: '/Users/dev/x', root: '/Users/dev/x' },
	cost: 0,
	tokens: { total: 386126, input: 327962, output: 534, reasoning: 0, cache: { write: 0, read: 57630 } },
	modelID: 'claude-opus-4-8',
	providerID: 'cursor-acp',
	time: { created: 1781879747416, completed: 1781879772712 },
	finish: 'stop'
};

const ABORTED = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'explore',
	agent: 'explore',
	path: { cwd: '/Users/dev/x', root: '/' },
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	modelID: 'minimax-m3',
	providerID: 'opencode-go',
	time: { created: 1781881535421, completed: 1781881623536 },
	error: { name: 'MessageAbortedError', data: { message: 'Aborted' } }
};

const BYO_COST = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'explore',
	agent: 'explore',
	path: { cwd: '/Users/dev/x', root: '/' },
	cost: 0.00118114,
	tokens: { total: 52557, input: 143, output: 312, reasoning: 0, cache: { write: 0, read: 52102 } },
	modelID: 'minimax-m3',
	providerID: 'opencode-go',
	time: { created: 1781881530028, completed: 1781881535420 },
	finish: 'tool-calls'
};

interface Insert {
	id: string;
	session_id: string;
	time_created?: number;
	time_updated?: number;
	data: string;
}

async function buildDb(rows: Insert[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'chaching-opencode-'));
	tempDirs.push(dir);
	const dbPath = join(dir, 'opencode.db');
	const db = new DatabaseSync(dbPath);
	db.exec(
		`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)`
	);
	const stmt = db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`);
	for (const r of rows) {
		stmt.run(r.id, r.session_id, r.time_created ?? 0, r.time_updated ?? 0, r.data);
	}
	db.close();
	return dbPath;
}

describe('opencode SQLite provider', () => {
	it('maps an assistant message with reasoning folded into output and cache write/read mapped (3.2)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_a', session_id: 'ses_1', data: JSON.stringify(OPENAI_TOKENS) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		const rec = records[0];
		expect(rec.key).toBe('opencode:msg_a');
		expect(rec.provider).toBe('opencode');
		expect(rec.sessionId).toBe('ses_1');
		expect(rec.model).toBe('gpt-5.5');
		// output === tokens.output + tokens.reasoning
		expect(rec.tokens.output).toBe(OPENAI_TOKENS.tokens.output + OPENAI_TOKENS.tokens.reasoning);
		expect(rec.tokens.input).toBe(OPENAI_TOKENS.tokens.input);
		expect(rec.tokens.cacheCreation).toBe(OPENAI_TOKENS.tokens.cache.write);
		expect(rec.tokens.cacheRead).toBe(OPENAI_TOKENS.tokens.cache.read);
		expect(rec.timestamp).toBe(OPENAI_TOKENS.time.completed);
	});

	it('prices a zero-cost cursor-acp Anthropic row via the resolver (cost > 0, not 0) (3.3)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_b', session_id: 'ses_2', data: JSON.stringify(CURSOR_ACP_TOKENS) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		const rec = records[0];
		// stays provider: opencode (cursor-acp attribution is a later change)
		expect(rec.provider).toBe('opencode');
		expect(rec.model).toBe('claude-opus-4-8');
		expect(typeof rec.cost).toBe('number');
		expect(rec.cost).toBeGreaterThan(0);
	});

	it('skips aborted/zero-token rows and malformed JSON, keeping valid rows (3.4)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_aborted', session_id: 'ses_3', data: JSON.stringify(ABORTED) },
			{ id: 'msg_bad', session_id: 'ses_3', data: '{not valid json' },
			{ id: 'msg_ok', session_id: 'ses_3', data: JSON.stringify(OPENAI_TOKENS) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		expect(records[0].key).toBe('opencode:msg_ok');
	});

	it('returns null cost for an unknown model with cost 0, and falls back to data.cost when positive (3.5)', async () => {
		const unknownZero = {
			...OPENAI_TOKENS,
			modelID: 'totally-unknown-xyz',
			providerID: 'mystery',
			cost: 0
		};
		const unknownPositive = {
			...OPENAI_TOKENS,
			modelID: 'totally-unknown-xyz',
			providerID: 'mystery',
			cost: 0.0042
		};
		const dbPath = await buildDb([
			{ id: 'msg_unk0', session_id: 'ses_4', data: JSON.stringify(unknownZero) },
			{ id: 'msg_unkpos', session_id: 'ses_4', data: JSON.stringify(unknownPositive) }
		]);

		const records = await readOpenCodeSessions(dbPath);
		const byKey = new Map(records.map((r) => [r.key, r]));

		expect(byKey.get('opencode:msg_unk0')?.cost).toBeNull();
		expect(byKey.get('opencode:msg_unkpos')?.cost).toBe(0.0042);
	});

	it('emits per-message records with distinct keys for two messages in one session (3.6)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_one', session_id: 'ses_5', data: JSON.stringify(OPENAI_TOKENS) },
			{ id: 'msg_two', session_id: 'ses_5', data: JSON.stringify(BYO_COST) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(2);
		const keys = records.map((r) => r.key).sort();
		expect(keys).toEqual(['opencode:msg_one', 'opencode:msg_two']);
		expect(records.every((r) => r.sessionId === 'ses_5')).toBe(true);
	});
});
