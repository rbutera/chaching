import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { firstFreePort } from './commands/serve.js';

function occupy(port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.once('error', reject);
		s.listen(port, '127.0.0.1', () => resolve(s));
	});
}

describe('serve free-port selection', () => {
	it('returns the desired port when it is free', async () => {
		const start = 53120;
		const port = await firstFreePort(start, '127.0.0.1');
		expect(port).toBe(start);
	});

	it('walks past an occupied port to the next free one', async () => {
		const start = 53210;
		const blocker = await occupy(start);
		try {
			const port = await firstFreePort(start, '127.0.0.1');
			expect(port).toBeGreaterThan(start);
		} finally {
			blocker.close();
		}
	});
});
