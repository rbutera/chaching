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
});
