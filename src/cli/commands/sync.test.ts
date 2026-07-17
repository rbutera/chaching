import { describe, expect, it } from 'vitest';
import { parseSyncArgs, syncHelp } from './sync';

describe('sync command routing', () => {
	it('parses create without ever logging or rewriting the database URL', () => {
		const parsed = parseSyncArgs([
			'create',
			'--database-url',
			'postgres://user:secret@tailnet/db',
			'--name',
			'team',
			'--machine=kinto'
		]);
		expect(parsed).toEqual({
			action: 'create',
			subaction: undefined,
			options: {
				'database-url': 'postgres://user:secret@tailnet/db',
				name: 'team',
				machine: 'kinto'
			}
		});
		expect(syncHelp()).not.toContain('user:secret');
	});

	it('parses subscription add and numeric input as an explicit string', () => {
		expect(
			parseSyncArgs([
				'subscription',
				'add',
				'--provider',
				'claude',
				'--name',
				'Corporate',
				'--account',
				'rai@example.com',
				'--tier',
				'corporate',
				'--monthly-usd',
				'99'
			])
		).toMatchObject({
			action: 'subscription',
			subaction: 'add',
			options: { provider: 'claude', 'monthly-usd': '99' }
		});
	});

	it('rejects unknown and valueless options', () => {
		expect(() => parseSyncArgs(['status', '--secret'])).toThrow("unknown option '--secret'");
		expect(() => parseSyncArgs(['join', '--pool'])).toThrow('--pool requires a value');
	});

	it('documents every required sync action and honest non-import', () => {
		const help = syncHelp();
		for (const command of ['create', 'join', 'status', 'leave', 'subscription add', 'map']) {
			expect(help).toContain(command);
		}
		expect(help).toContain('not imported');
	});
});
