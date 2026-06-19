// SSE feed: on connect, ensure the singleton ingestion service has done its cold
// scan, send the current snapshot, then stream deltas. Cleans up on disconnect.

import type { RequestHandler } from './$types';
import { getService } from '$lib/server/service';
import type { SSEMessage } from '$lib/types';

export const GET: RequestHandler = async ({ request }) => {
	const service = getService();
	// kick the cold scan (idempotent); don't block the response on it for the
	// snapshot — but we DO want the first snapshot to reflect the scan, so await.
	await service.ensureStarted();

	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const send = (msg: SSEMessage) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
				} catch {
					cleanup();
				}
			};

			// initial snapshot
			send({ type: 'snapshot', data: service.snapshot() });

			// deltas
			unsubscribe = service.subscribe((delta) => send({ type: 'delta', data: delta }));

			// SSE comment heartbeat to keep proxies from closing the idle connection
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					cleanup();
				}
			}, 25000);
			if (heartbeat.unref) heartbeat.unref();

			const cleanup = () => {
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
				if (heartbeat) {
					clearInterval(heartbeat);
					heartbeat = null;
				}
				try {
					controller.close();
				} catch {
					// already closed
				}
			};

			request.signal.addEventListener('abort', cleanup);
		},
		cancel() {
			if (unsubscribe) unsubscribe();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
