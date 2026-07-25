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
	cacheWrite1h?: number;
	cacheWrite5m?: number;
	cttl?: { ephemeral1h?: number; ephemeral5m?: number };
	server?: { webSearch?: number; webFetch?: number };
}

function assistantLine(
	entryId: string,
	opts: {
		provider: string;
		model: string;
		usage: Usage;
		ts?: number;
		iso?: string;
		responseId?: string;
	}
): string {
	const { input, output, cacheRead, cacheWrite, ...extraUsage } = opts.usage;
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
			...(opts.responseId ? { responseId: opts.responseId } : {}),
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite,
				...extraUsage,
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
		expect(rec?.key).toBe('pi:entry:ddd8fc13:1783929600000:zai:glm-5.1');
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
		expect(rec?.key).toBe('pi:entry:e1:1783929600000:zai:glm-5.1');
		expect(rec?.sessionId).toBe('file-fallback');
	});
});

describe('pi provider parser — dedup keys', () => {
	it('uses responseId across forks and stable fallback fields when responseId is absent', () => {
		const fork = (sessionId: string, responseId?: string) => {
			const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
			parser.parse(sessionLine(sessionId));
			return parser.parse(
				assistantLine('persisted-entry', {
					provider: 'anthropic',
					model: 'claude-opus-5',
					responseId,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
				})
			);
		};

		expect(fork('original', 'msg_upstream')?.key).toBe('pi:response:msg_upstream');
		expect(fork('fork', 'msg_upstream')?.key).toBe(fork('original', 'msg_upstream')?.key);
		expect(fork('fork')?.key).toBe(fork('original')?.key);
		expect(fork('fork')?.sessionId).toBe('fork');
	});

	it('keeps distinct entry ids distinct and re-polls deterministically', () => {
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
		// Re-poll determinism lets the engine's DedupSet drop the re-read.
		expect(first.map((r) => r?.key)).toEqual(second.map((r) => r?.key));
	});
});

describe('pi provider parser — OMP usage extensions', () => {
	it('ignores an OMP title slot and maps modern TTL plus server-tool usage', () => {
		const parser = createPiLineParser({ sessionId: 'file-fallback', project: 'pi' });
		expect(parser.parse(line({ type: 'title', title: 'Current title' }))).toBeNull();
		parser.parse(sessionLine('omp-session', '/Users/rai/dev/oh-my-pi'));
		const rec = parser.parse(
			assistantLine('omp-turn', {
				provider: 'anthropic',
				model: 'claude-opus-5',
				usage: {
					input: 0,
					output: 0,
					cacheRead: 1_000_000,
					cacheWrite: 2_000_000,
					cttl: { ephemeral1h: 1_000_000, ephemeral5m: 1_000_000 },
					server: { webSearch: 2, webFetch: 3 }
				}
			})
		);

		expect(rec).toMatchObject({
			sessionId: 'omp-session',
			project: '/Users/rai/dev/oh-my-pi',
			cacheCreation1h: 1_000_000,
			cacheCreation5m: 1_000_000,
			webSearchRequests: 2,
			webFetchRequests: 3
		});
		expect(rec?.cost).toBeCloseTo(16.75);
	});

	it('accepts legacy TTL fields and clamps their sum to total cache writes', () => {
		const parser = createPiLineParser({ sessionId: 'legacy', project: 'pi' });
		const rec = parser.parse(
			assistantLine('legacy-turn', {
				provider: 'anthropic',
				model: 'claude-opus-5',
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 100,
					cacheWrite1h: 80,
					cacheWrite5m: 80
				}
			})
		);
		expect(rec?.cacheCreation1h).toBe(80);
		expect(rec?.cacheCreation5m).toBe(20);
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

	it('prices Opus 5 through the central exact override when models.dev lags it', () => {
		const parser = createPiLineParser({ sessionId: 'f', project: 'pi' });
		const rec = parser.parse(
			assistantLine('opus-5', {
				provider: 'anthropic',
				model: 'claude-opus-5',
				usage: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }
			})
		);
		expect(rec?.cost).toBeCloseTo(30);
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
		const res = await readPiRecords([fixtures]);
		expect(res.filesScanned).toBe(1);
		expect(res.errors).toEqual([]);
		// every assistant turn in the real capture 429'd with all-zero usage -> skipped
		expect(res.records.length).toBe(0);
	});

	it('continues through an available root when another root is missing', async () => {
		const res = await readPiRecords([join(fixtures, 'does-not-exist'), fixtures]);
		expect(res.filesScanned).toBe(1);
		expect(res.records).toEqual([]);
		expect(res.errors).toEqual([]);
	});

	it('deduplicates files discovered through overlapping roots', async () => {
		const res = await readPiRecords([fixtures, join(fixtures, '..', '__fixtures__')]);
		expect(res.filesScanned).toBe(1);
		expect(res.records).toEqual([]);
		expect(res.errors).toEqual([]);
	});

	it('returns empty without throwing when every root is missing', async () => {
		const res = await readPiRecords([join(fixtures, 'missing-a'), join(fixtures, 'missing-b')]);
		expect(res).toEqual({ filesScanned: 0, files: [], records: [], errors: [] });
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

			const full = await readPiRecords([root]);
			expect(full.files.length).toBe(2);
			expect(full.records.length).toBe(2);
			// proves the walker descended into the nested flattened-cwd dir
			expect(full.files.every((f) => f.includes('--Users-rai-focused--'))).toBe(true);

			const incremental = await readPiRecords([root], { modifiedSince: Date.now() - 3600_000 });
			expect(incremental.files).toEqual([newFile]);
			expect(incremental.records.length).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
