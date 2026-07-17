import { describe, expect, it } from 'vitest';
import { POST } from './+server';

describe('/api/sync management boundary', () => {
	it('rejects a direct remote client before parsing or mutating config', async () => {
		const response = await POST({
			request: new Request('http://chaching.test/api/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'leave' })
			}),
			getClientAddress: () => '100.64.0.20'
		} as never);
		expect(response.status).toBe(403);
	});

	it('rejects a remote client forwarded by a loopback proxy', async () => {
		const response = await POST({
			request: new Request('http://chaching.test/api/sync', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-forwarded-for': '100.64.0.20'
				},
				body: JSON.stringify({ action: 'leave' })
			}),
			getClientAddress: () => '127.0.0.1'
		} as never);
		expect(response.status).toBe(403);
	});
});
