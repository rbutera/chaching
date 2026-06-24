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

// Assistant row with ALL-ZERO mapped tokens, NO error, but a positive blob cost —
// real billed spend (a subscription/tool round with usage stripped) we must keep.
const TOKENLESS_BILLED = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'worker',
	agent: 'worker',
	path: { cwd: '/Users/dev/x', root: '/' },
	cost: 0.0031,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } },
	modelID: 'gpt-5.5',
	providerID: 'openai',
	time: { created: 1781887200000, completed: 1781887205000 },
	finish: 'stop'
};

// A genuinely-free models.dev model (input:0/output:0 in the snapshot) under the
// `opencode` provider. With blob cost 0 the resolver yields a real $0; with a
// positive blob cost the blob wins over the $0 estimate.
const FREE_ZERO = {
	parentID: 'msg_parent',
	role: 'assistant',
	mode: 'worker',
	agent: 'worker',
	path: { cwd: '/Users/dev/x', root: '/' },
	cost: 0,
	tokens: { input: 1000, output: 500, reasoning: 0, cache: { write: 0, read: 0 } },
	modelID: 'ring-2.6-1t-free',
	providerID: 'opencode',
	time: { created: 1781887300000, completed: 1781887305000 },
	finish: 'stop'
};

const FREE_WITH_BLOB = {
	...FREE_ZERO,
	cost: 0.0009
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

		// cost is the resolver estimate using REAL gpt-5.5 rates from the snapshot
		// (per-million / 1e6): input 5, output 30, cache_read 0.5, no cache_write.
		const inRate = 5 / 1e6;
		const outRate = 30 / 1e6;
		const cacheReadRate = 0.5 / 1e6;
		const expectedCost =
			OPENAI_TOKENS.tokens.input * inRate +
			(OPENAI_TOKENS.tokens.output + OPENAI_TOKENS.tokens.reasoning) * outRate +
			OPENAI_TOKENS.tokens.cache.read * cacheReadRate;
		expect(rec.cost).toBeCloseTo(expectedCost);
	});

	it('prices a zero-cost cursor-acp Anthropic row via the resolver (cost > 0, not 0) (3.3)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_b', session_id: 'ses_2', data: JSON.stringify(CURSOR_ACP_TOKENS) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		const rec = records[0];
		// cursor-acp usage (Opus via the opencode-cursor bridge) is attributed to the
		// `cursor` provider, priced via the resolver's Anthropic catalog.
		expect(rec.provider).toBe('cursor');
		expect(rec.model).toBe('claude-opus-4-8');
		expect(typeof rec.cost).toBe('number');
		expect(rec.cost).toBeGreaterThan(0);
	});

	it('attributes cursor-acp to the cursor provider while openai stays opencode (3 - #3)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_oa', session_id: 'ses_x', data: JSON.stringify(OPENAI_TOKENS) },
			{ id: 'msg_ca', session_id: 'ses_x', data: JSON.stringify(CURSOR_ACP_TOKENS) }
		]);

		const records = await readOpenCodeSessions(dbPath);
		const byKey = new Map(records.map((r) => [r.key, r]));

		expect(byKey.get('opencode:msg_oa')?.provider).toBe('opencode');
		expect(byKey.get('opencode:msg_ca')?.provider).toBe('cursor');
	});

	it('attributes a normalized cursor-acp model (opus-4.6) to cursor with Anthropic pricing (#3)', async () => {
		const OPUS_46 = {
			...CURSOR_ACP_TOKENS,
			modelID: 'opus-4.6',
			tokens: { input: 1000, output: 100, reasoning: 0, cache: { write: 0, read: 0 } }
		};
		const dbPath = await buildDb([
			{ id: 'msg_o46', session_id: 'ses_y', data: JSON.stringify(OPUS_46) }
		]);

		const records = await readOpenCodeSessions(dbPath);
		expect(records).toHaveLength(1);
		const rec = records[0];
		expect(rec.provider).toBe('cursor');
		// Anthropic Opus input rate is $5/Mtok ⇒ 1000·5e-6 + 100·25e-6 = 0.0075.
		expect(rec.cost).toBeCloseTo(1000 * 5e-6 + 100 * 25e-6, 9);
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

	it('keeps an all-zero-token assistant row that carries a positive blob cost (cost === data.cost)', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_billed', session_id: 'ses_billed', data: JSON.stringify(TOKENLESS_BILLED) }
		]);

		const records = await readOpenCodeSessions(dbPath);

		expect(records).toHaveLength(1);
		const rec = records[0];
		expect(rec.key).toBe('opencode:msg_billed');
		expect(rec.cost).toBe(TOKENLESS_BILLED.cost);
	});

	it('prices a free model at $0 when the blob cost is 0, and lets a positive blob cost win', async () => {
		const dbPath = await buildDb([
			{ id: 'msg_free0', session_id: 'ses_free', data: JSON.stringify(FREE_ZERO) },
			{ id: 'msg_freeblob', session_id: 'ses_free', data: JSON.stringify(FREE_WITH_BLOB) }
		]);

		const records = await readOpenCodeSessions(dbPath);
		const byKey = new Map(records.map((r) => [r.key, r]));

		// free model, no blob -> a real $0 estimate (NOT null)
		expect(byKey.get('opencode:msg_free0')?.cost).toBe(0);
		// free model, positive blob -> blob wins over the $0 estimate
		expect(byKey.get('opencode:msg_freeblob')?.cost).toBe(FREE_WITH_BLOB.cost);
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
