import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { firstFreePort, shouldAutoOpen } from './commands/serve';

function occupy(port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.once('error', reject);
		s.listen(port, '127.0.0.1', () => resolve(s));
	});
}

function portOf(server: Server): number {
	const address = server.address();
	assert(address && typeof address !== 'string');
	return address.port;
}

async function close(server: Server): Promise<void> {
	const closed = once(server, 'close');
	server.close();
	await closed;
}

describe('serve free-port selection', () => {
	it('returns the desired port when it is free', async () => {
		const reservation = await occupy(0);
		const start = portOf(reservation);
		await close(reservation);
		const port = await firstFreePort(start, '127.0.0.1');
		expect(port).toBe(start);
	});

	it('walks past an occupied port to the next free one', async () => {
		const blocker = await occupy(0);
		const start = portOf(blocker);
		try {
			const port = await firstFreePort(start, '127.0.0.1');
			expect(port).toBeGreaterThan(start);
		} finally {
			await close(blocker);
		}
	});
});

describe('serve auto-open guard (shouldAutoOpen)', () => {
	// Baseline: interactive TTY, loopback bind, no opt-out, with a display, darwin.
	const ok = (over: Partial<{ host: string; env: NodeJS.ProcessEnv; argv: string[]; isTTY: boolean; os: NodeJS.Platform }> = {}) =>
		shouldAutoOpen(
			over.host ?? '127.0.0.1',
			over.env ?? { DISPLAY: ':0' },
			over.argv ?? [],
			over.isTTY ?? true,
			over.os ?? 'darwin'
		);

	it('opens on an interactive loopback TTY', () => {
		expect(ok()).toBe(true);
		expect(ok({ host: 'localhost' })).toBe(true);
	});

	it('does NOT open when bound for remote (0.0.0.0 / tailnet IP)', () => {
		expect(ok({ host: '0.0.0.0' })).toBe(false);
		expect(ok({ host: '100.64.0.1' })).toBe(false);
		expect(ok({ host: '::' })).toBe(false);
	});

	it('does NOT open in a non-TTY (always-on kinto serve background)', () => {
		expect(ok({ isTTY: false })).toBe(false);
	});

	it('respects --no-open and CHACHING_NO_OPEN opt-out', () => {
		expect(ok({ argv: ['--no-open'] })).toBe(false);
		expect(ok({ env: { DISPLAY: ':0', CHACHING_NO_OPEN: '1' } })).toBe(false);
	});

	it('does NOT open headless (linux no DISPLAY, or SSH session)', () => {
		expect(ok({ os: 'linux', env: {} })).toBe(false);
		expect(ok({ os: 'linux', env: { DISPLAY: ':0' } })).toBe(true);
		expect(ok({ env: { DISPLAY: ':0', SSH_CONNECTION: 'x' } })).toBe(false);
	});
});
