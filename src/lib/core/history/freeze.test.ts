// Engine-level freeze-past-days invariants: no double-count, survives pruning,
// today is never frozen. Drives runOnce over a temp Claude root + temp history DB
// with an injected "today" clock so assertions don't depend on the wall clock.

import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runOnce } from '../engine';
import { HistoryStore } from './store';
import { DEFAULT_SUBSCRIPTION, type chachingConfig } from '../config';

const roots: string[] = [];

afterEach(async () => {
	while (roots.length > 0) {
		const d = roots.pop();
		if (d) await rm(d, { recursive: true, force: true });
	}
});

interface DayLine {
	day: string; // YYYY-MM-DD UTC
	model?: string;
	tokens?: { input: number; output: number };
}

/** Build one assistant JSONL line for the given UTC day at 12:00:00Z. */
function line(d: DayLine, idx: number): string {
	const model = d.model ?? 'claude-opus-4-8';
	const tokens = d.tokens ?? { input: 1000, output: 200 };
	return JSON.stringify({
		type: 'assistant',
		timestamp: `${d.day}T12:00:0${idx % 10}.000Z`,
		requestId: `req-${d.day}-${idx}`,
		sessionId: `sess-${d.day}`,
		message: {
			id: `msg-${d.day}-${idx}`,
			model,
			usage: {
				input_tokens: tokens.input,
				output_tokens: tokens.output,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0
			}
		}
	});
}

/** Create a temp Claude root whose projects/proj/transcript.jsonl contains `days`. */
async function makeRoot(days: DayLine[]): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'chaching-freeze-'));
	roots.push(root);
	const projectDir = join(root, 'projects', '-proj');
	await mkdir(projectDir, { recursive: true });
	const body = days.map((d, i) => line(d, i)).join('\n') + '\n';
	await writeFile(join(projectDir, 'transcript.jsonl'), body, 'utf8');
	return root;
}

function cfg(root: string, dbPath: string): chachingConfig {
	return {
		cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' },
		history: { enabled: true, dbPath },
		providers: {
			claude: { enabled: true, roots: [root], subscription: { ...DEFAULT_SUBSCRIPTION } },
			codex: { enabled: false, root: '', subscription: { ...DEFAULT_SUBSCRIPTION } },
			cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600 },
			opencode: { enabled: false, dbPath: '' },
			pi: { enabled: false, root: '' }
		}
	};
}

/** A clock fixed at 12:00:00Z on `day`. */
function clockAt(day: string): () => number {
	return () => Date.parse(`${day}T12:00:00.000Z`);
}

function totalRequests(dayModel: { requests: number }[]): number {
	return dayModel.reduce((a, d) => a + d.requests, 0);
}

describe('engine freeze-past-days invariants', () => {
	it('freezes past days into the DB but never today', async () => {
		// D1, D2 are past; D3 is today. 2 requests each.
		const root = await makeRoot([
			{ day: '2026-06-01' },
			{ day: '2026-06-01' },
			{ day: '2026-06-02' },
			{ day: '2026-06-02' },
			{ day: '2026-06-03' },
			{ day: '2026-06-03' }
		]);
		const dbDir = await mkdtemp(join(tmpdir(), 'chaching-freezedb-'));
		roots.push(dbDir);
		const dbPath = join(dbDir, 'history.db');

		const snap = await runOnce(cfg(root, dbPath), clockAt('2026-06-03'));
		// snapshot still has all three days, 6 requests total — single counted.
		expect(totalRequests(snap.dayModel)).toBe(6);

		const store = new HistoryStore();
		store.open(dbPath);
		const frozen = [...store.frozenDays()].sort();
		store.close();
		// only the two PAST days are frozen; today (D3) is not.
		expect(frozen).toEqual(['2026-06-01', '2026-06-02']);
	});

	it('does not double-count across two runs over the same logs', async () => {
		const root = await makeRoot([
			{ day: '2026-06-01' },
			{ day: '2026-06-01' },
			{ day: '2026-06-02' },
			{ day: '2026-06-02' },
			{ day: '2026-06-03' } // today
		]);
		const dbDir = await mkdtemp(join(tmpdir(), 'chaching-freezedb2-'));
		roots.push(dbDir);
		const dbPath = join(dbDir, 'history.db');

		const run1 = await runOnce(cfg(root, dbPath), clockAt('2026-06-03'));
		const total1 = totalRequests(run1.dayModel);

		// Run 2: SAME logs still present (D1, D2 not pruned). Frozen days must be skipped
		// from the scan and served from the DB — total stays single-counted, not doubled.
		const run2 = await runOnce(cfg(root, dbPath), clockAt('2026-06-03'));
		const total2 = totalRequests(run2.dayModel);

		expect(total1).toBe(5);
		expect(total2).toBe(5);
		// Per-day requests are identical run-to-run (no day doubled to 4).
		for (const dm of run2.dayModel) expect(dm.requests).toBe(dm.day === '2026-06-03' ? 1 : 2);
	});

	it('keeps a frozen day in the snapshot after it is pruned from the logs', async () => {
		// Run 1: D1 (past) + D2 (today) present; D1 gets frozen.
		const root1 = await makeRoot([{ day: '2026-06-01' }, { day: '2026-06-02' }]);
		const dbDir = await mkdtemp(join(tmpdir(), 'chaching-freezedb3-'));
		roots.push(dbDir);
		const dbPath = join(dbDir, 'history.db');
		await runOnce(cfg(root1, dbPath), clockAt('2026-06-02'));

		// Run 2: D1 has been PRUNED from the logs (only D2 remains), advanced to a later today.
		const root2 = await makeRoot([{ day: '2026-06-02' }]);
		const snap = await runOnce(cfg(root2, dbPath), clockAt('2026-06-05'));

		const days = snap.dayModel.map((d) => d.day).sort();
		// D1 survives from the DB even though it is no longer in the logs.
		expect(days).toContain('2026-06-01');
		expect(days).toContain('2026-06-02');
	});

	it('does not freeze when the cold scan had a read error (a day may be partial)', async () => {
		const root = await makeRoot([{ day: '2026-06-01' }, { day: '2026-06-02' }]);
		// Add an unreadable .jsonl so the cold scan records an error and refuses to freeze.
		const projectDir = join(root, 'projects', '-proj');
		const bad = join(projectDir, 'unreadable.jsonl');
		await writeFile(bad, '{"type":"assistant"}\n', 'utf8');
		await chmod(bad, 0o000);

		const dbDir = await mkdtemp(join(tmpdir(), 'chaching-freezedb5-'));
		roots.push(dbDir);
		const dbPath = join(dbDir, 'history.db');

		try {
			await runOnce(cfg(root, dbPath), clockAt('2026-06-05'));
		} finally {
			await chmod(bad, 0o600); // restore so afterEach can clean up
		}

		const store = new HistoryStore();
		store.open(dbPath);
		const frozen = [...store.frozenDays()];
		store.close();
		// Nothing frozen this run despite past days present — partial-scan guard held.
		expect(frozen).toEqual([]);
	});

	it('disabled history: no DB written, snapshot still produced', async () => {
		const root = await makeRoot([{ day: '2026-06-01' }, { day: '2026-06-02' }]);
		const dbDir = await mkdtemp(join(tmpdir(), 'chaching-freezedb4-'));
		roots.push(dbDir);
		const dbPath = join(dbDir, 'history.db');
		const disabled: chachingConfig = { ...cfg(root, dbPath), history: { enabled: false, dbPath } };

		const snap = await runOnce(disabled, clockAt('2026-06-03'));
		expect(totalRequests(snap.dayModel)).toBe(2);

		// The DB file must not have been created.
		const store = new HistoryStore();
		let opened = true;
		try {
			store.open(dbPath);
		} catch {
			opened = false;
		}
		// open() creates the file if missing, so instead assert it had no frozen days
		// (i.e. nothing was ever written by the disabled run).
		if (opened) {
			expect([...store.frozenDays()]).toEqual([]);
			store.close();
		}
	});
});
