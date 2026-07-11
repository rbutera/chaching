import { describe, expect, it } from 'vitest';
import { createCodexLineParser } from './parse';

function line(payload: object): string {
	return JSON.stringify(payload);
}

describe('codex provider parser', () => {
	it('emits last_token_usage deltas with the current turn_context model', () => {
		const parser = createCodexLineParser({ sessionId: 'rollout-1', project: '/Users/rai/project' });
		expect(
			parser.parse(
				line({
					timestamp: '2026-06-13T03:20:32.779Z',
					type: 'turn_context',
					payload: { model: 'gpt-5.5' }
				})
			)
		).toBeNull();

		const rec = parser.parse(
			line({
				timestamp: '2026-06-13T03:20:32.973Z',
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						total_token_usage: {
							input_tokens: 4755982,
							cached_input_tokens: 4301952,
							output_tokens: 21467,
							reasoning_output_tokens: 9770,
							total_tokens: 4777449
						},
						last_token_usage: {
							input_tokens: 93302,
							cached_input_tokens: 89984,
							output_tokens: 1028,
							reasoning_output_tokens: 516,
							total_tokens: 94330
						}
					}
				}
			})
		);

		expect(rec).not.toBeNull();
		expect(rec?.provider).toBe('codex');
		expect(rec?.model).toBe('gpt-5.5');
		expect(rec?.tokens).toEqual({ input: 3318, output: 1544, cacheCreation: 0, cacheRead: 89984 });
	});

	it.each([
		['gpt-5.6-sol', 0.1],
		['gpt-5.6-terra', 0.05],
		['gpt-5.6-luna', 0.02]
	])('prices %s with cached input and reasoning output', (model, expectedCost) => {
		const parser = createCodexLineParser({ sessionId: `rollout-${model}`, project: '/tmp/project' });
		parser.parse(line({ timestamp: '2026-07-11T10:00:00Z', type: 'turn_context', payload: { model } }));
		const rec = parser.parse(
			line({
				timestamp: '2026-07-11T10:00:01Z',
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						last_token_usage: {
							input_tokens: 20_000,
							cached_input_tokens: 10_000,
							output_tokens: 1_000,
							reasoning_output_tokens: 500
						}
					}
				}
			})
		);

		expect(rec?.tokens).toEqual({ input: 10_000, output: 1_500, cacheCreation: 0, cacheRead: 10_000 });
		expect(rec?.cost).toBeCloseTo(expectedCost);
	});

	it('uses total prompt tokens for GPT-5.6 long-context pricing', () => {
		const parser = createCodexLineParser({ sessionId: 'rollout-long', project: '/tmp/project' });
		parser.parse(line({ timestamp: '2026-07-11T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }));
		const rec = parser.parse(
			line({
				timestamp: '2026-07-11T10:00:01Z',
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						last_token_usage: {
							input_tokens: 272_001,
							cached_input_tokens: 200_000,
							output_tokens: 10_000,
							reasoning_output_tokens: 0
						}
					}
				}
			})
		);

		expect(rec?.tokens.cacheCreation).toBe(0);
		expect(rec?.cost).toBeCloseTo(1.37001);
	});
});

describe('readCodexRecords — incremental modifiedSince', () => {
	it('parses only mtime-fresh files when modifiedSince is set, everything otherwise', async () => {
		const { mkdtemp, mkdir, writeFile, utimes, rm } = await import('node:fs/promises');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const { readCodexRecords } = await import('./local');

		const root = await mkdtemp(join(tmpdir(), 'chaching-codex-inc-'));
		try {
			await mkdir(join(root, '2026/07/01'), { recursive: true });
			const usage = (ts: string) =>
				[
					line({ timestamp: ts, type: 'turn_context', payload: { model: 'gpt-5.5' } }),
					line({
						timestamp: ts,
						type: 'event_msg',
						payload: {
							type: 'token_count',
							info: {
								total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 },
								last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 }
							}
						}
					})
				].join('\n');

			const oldFile = join(root, '2026/07/01/rollout-old.jsonl');
			const newFile = join(root, '2026/07/01/rollout-new.jsonl');
			await writeFile(oldFile, usage('2026-07-01T08:00:00.000Z'));
			await writeFile(newFile, usage('2026-07-01T09:00:00.000Z'));
			// backdate the old file well past any margin
			const old = (Date.now() - 3 * 3600_000) / 1000;
			await utimes(oldFile, old, old);

			const full = await readCodexRecords(root);
			expect(full.files.length).toBe(2);
			expect(full.records.length).toBe(2);

			const incremental = await readCodexRecords(root, { modifiedSince: Date.now() - 3600_000 });
			expect(incremental.files).toEqual([newFile]);
			expect(incremental.records.length).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
