import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPiLineParser } from './parse';
import { readPiRecords } from './local';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '__fixtures__');

function line(obj: object): string {
	return JSON.stringify(obj);
}

const HEADER_ID = '019f5a7a-afd8-744b-8000-9c8a810024fd';

function sessionLine(id = HEADER_ID, cwd = '/Users/rai/focused'): string {
	return line({ type: 'session', version: 3, id, timestamp: '2026-07-13T07:56:57.688Z', cwd });
}

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function assistantLine(
	entryId: string,
	opts: { provider: string; model: string; usage: Usage; ts?: number; iso?: string }
): string {
	const { input, output, cacheRead, cacheWrite } = opts.usage;
	return line({
		type: 'message',
		id: entryId,
		parentId: null,
		timestamp: opts.iso ?? '2026-07-13T08:00:00.000Z',
		message: {
			role: 'assistant',
			content: [],
			api: 'openai-completions',
			provider: opts.provider,
			model: opts.model,
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite,
				totalTokens: input + output + cacheRead + cacheWrite,
				cost: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999, total: 999 }
			},
			stopReason: 'stop',
			timestamp: opts.ts ?? 1783929600000
		}
	});
}

describe('pi provider parser — token mapping', () => {
	it('maps tokens WITHOUT cache subtraction (input stays cache-exclusive)', () => {
		const parser = createPiLineParser({ sessionId: 'file-fallback', project: 'pi' });
		expect(parser.parse(sessionLine())).toBeNull();

		const rec = parser.parse(
			assistantLine('ddd8fc13', {
				provider: 'zai',
				model: 'glm-5.1',
				usage: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 50 }
			})
		);

		expect(rec).not.toBeNull();
		expect(rec?.provider).toBe('pi');
		// input is NOT reduced by cacheRead/cacheWrite (the codex reader subtracts; pi must not)
		expect(rec?.tokens).toEqual({ input: 1000, output: 200, cacheCreation: 50, cacheRead: 500 });
		// session id + project come from the header line, not the filename fallback
		expect(rec?.sessionId).toBe(HEADER_ID);
		expect(rec?.project).toBe('/Users/rai/focused');
		// dedup key = pi:<headerId>:<entryId>
		expect(rec?.key).toBe(`pi:${HEADER_ID}:ddd8fc13`);
		// timestamp is message.timestamp (epoch ms), not the ISO line stamp
		expect(rec?.timestamp).toBe(1783929600000);
		expect(rec?.day).toBe('2026-07-13');
	});

	it('falls back to the filename session id when no header line is present', () => {
		const parser = createPiLineParser({ sessionId: 'file-fallback', project: 'pi' });
		const rec = parser.parse(
			assistantLine('e1', {
				provider: 'zai',
				model: 'glm-5.1',
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }
			})
		);
		expect(rec?.key).toBe('pi:file-fallback:e1');
		expect(rec?.sessionId).toBe('file-fallback');
	});
});

describe('pi provider parser — dedup keys', () => {
	it('distinct entry ids -> distinct keys; re-parsing the same file -> identical keys', () => {
		const build = () => {
			const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
			parser.parse(sessionLine());
			return [
				parser.parse(
					assistantLine('aaa', {
						provider: 'zai',
						model: 'glm-5.1',
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
					})
				),
				parser.parse(
					assistantLine('bbb', {
						provider: 'zai',
						model: 'glm-5.1',
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
					})
				)
			];
		};
		const first = build();
		const second = build();
		expect(first[0]?.key).not.toBe(first[1]?.key);
		// re-poll determinism: the same (headerId, entryId) always yields the same key,
		// so the engine's DedupSet drops the re-read.
		expect(first.map((r) => r?.key)).toEqual(second.map((r) => r?.key));
	});
});

describe('pi provider parser — skipped lines (match codex)', () => {
	const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
	parser.parse(sessionLine());

	it('skips non-assistant + control lines', () => {
		expect(parser.parse(sessionLine())).toBeNull();
		expect(
			parser.parse(line({ type: 'model_change', id: 'x', provider: 'zai', modelId: 'glm-5.1' }))
		).toBeNull();
		expect(
			parser.parse(line({ type: 'thinking_level_change', id: 'y', thinkingLevel: 'medium' }))
		).toBeNull();
		expect(
			parser.parse(
				line({
					type: 'message',
					id: 'u1',
					message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 }
				})
			)
		).toBeNull();
		expect(parser.parse('not json at all')).toBeNull();
	});

	it('skips all-zero-usage assistant turns (the 429/errored case)', () => {
		expect(
			parser.parse(
				assistantLine('z1', {
					provider: 'zai',
					model: 'glm-5.1',
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
				})
			)
		).toBeNull();
	});
});

describe('pi provider parser — pricing', () => {
	it('prices known models across catalogs (> 0)', () => {
		const cases = [
			{ provider: 'anthropic', model: 'claude-sonnet-4-5' },
			{ provider: 'openai-codex', model: 'gpt-5.6-sol' },
			{ provider: 'zai', model: 'glm-5.1' },
			{ provider: 'moonshotai', model: 'kimi-k3' },
			{ provider: 'opencode', model: 'kimi-k3' },
			{ provider: 'opencode-go', model: 'kimi-k3' }
		];
		for (const c of cases) {
			const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
			parser.parse(sessionLine());
			const rec = parser.parse(
				assistantLine('e', {
					provider: c.provider,
					model: c.model,
					usage: { input: 10_000, output: 2_000, cacheRead: 1_000, cacheWrite: 100 }
				})
			);
			expect(rec?.cost, `${c.provider}/${c.model}`).not.toBeNull();
			expect(rec?.cost, `${c.provider}/${c.model}`).toBeGreaterThan(0);
		}
	});

	it('resolves an uppercase id via the lowercase retry (MiniMax-M3 -> minimax-m3)', () => {
		const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
		parser.parse(sessionLine());
		const rec = parser.parse(
			assistantLine('e', {
				provider: 'zai',
				model: 'MiniMax-M3',
				usage: { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0 }
			})
		);
		expect(rec?.model).toBe('MiniMax-M3'); // display id preserved
		expect(rec?.cost).not.toBeNull();
		expect(rec?.cost).toBeGreaterThan(0);
	});

	it('keeps tokens but prices unknown models at null (no crash, no faked $0)', () => {
		const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
		parser.parse(sessionLine());
		const rec = parser.parse(
			assistantLine('e', {
				provider: 'whoknows',
				model: 'totally-made-up-model-9000',
				usage: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 }
			})
		);
		expect(rec).not.toBeNull();
		expect(rec?.tokens).toEqual({ input: 500, output: 100, cacheCreation: 0, cacheRead: 0 });
		expect(rec?.cost).toBeNull();
	});
});

describe('readPiRecords — real on-disk fixture', () => {
	it('walks the fixtures dir and handles the real all-zero (429) session with no error + no records', async () => {
		const res = await readPiRecords(fixtures);
		expect(res.filesScanned).toBe(1);
		expect(res.errors).toEqual([]);
		// every assistant turn in the real capture 429'd with all-zero usage -> skipped
		expect(res.records.length).toBe(0);
	});

	it('returns empty (no throw) for a missing sessions root', async () => {
		const res = await readPiRecords(join(fixtures, 'does-not-exist'));
		expect(res.filesScanned).toBe(0);
		expect(res.records).toEqual([]);
		expect(res.errors).toEqual([]);
	});
});

describe('readPiRecords — nested <cwd>/ dir + incremental modifiedSince', () => {
	it('finds logs under the nested flattened-cwd dir and honors modifiedSince', async () => {
		const { mkdtemp, mkdir, writeFile, utimes, rm } = await import('node:fs/promises');
		const { tmpdir } = await import('node:os');

		const root = await mkdtemp(join(tmpdir(), 'chaching-pi-'));
		try {
			// mirror the real layout: sessions/<flattened-cwd>/<ts>_<id>.jsonl
			const nested = join(root, '--Users-rai-focused--');
			await mkdir(nested, { recursive: true });

			const contents = (id: string) =>
				[
					sessionLine(id, '/Users/rai/focused'),
					assistantLine('turn-1', {
						provider: 'zai',
						model: 'glm-5.1',
						usage: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 50 }
					})
				].join('\n');

			const oldFile = join(nested, '2026-07-01T08-00-00-000Z_old.jsonl');
			const newFile = join(nested, '2026-07-13T08-00-00-000Z_new.jsonl');
			await writeFile(oldFile, contents('old-session'));
			await writeFile(newFile, contents('new-session'));
			const old = (Date.now() - 3 * 3600_000) / 1000;
			await utimes(oldFile, old, old);

			const full = await readPiRecords(root);
			expect(full.files.length).toBe(2);
			expect(full.records.length).toBe(2);
			// proves the walker descended into the nested flattened-cwd dir
			expect(full.files.every((f) => f.includes('--Users-rai-focused--'))).toBe(true);

			const incremental = await readPiRecords(root, { modifiedSince: Date.now() - 3600_000 });
			expect(incremental.files).toEqual([newFile]);
			expect(incremental.records.length).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
