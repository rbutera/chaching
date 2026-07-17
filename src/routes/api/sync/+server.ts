import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSyncStatus, performSyncAction } from '$lib/core/sync/manager';
import type { SyncAction } from '$lib/core/sync/types';
import { resetService } from '$lib/server/service';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	return json({
		...(await getSyncStatus()),
		managementAllowed: isLocalManagementRequest(request, getClientAddress)
	});
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!isLocalManagementRequest(request, getClientAddress)) {
		return json(
			{ error: 'Sync configuration is local-only. Run the command on the Chaching host.' },
			{ status: 403 }
		);
	}
	try {
		const action = (await request.json()) as SyncAction;
		if (!action || typeof action !== 'object' || typeof action.action !== 'string')
			return json({ error: 'Invalid sync action' }, { status: 400 });
		const status = await performSyncAction(action);
		return json(status);
	} catch (cause) {
		const error = cause instanceof Error ? cause.message : String(cause);
		return json({ error }, { status: 400 });
	} finally {
		// Reset the singleton engine even when the follow-up status read fails after a
		// committed config mutation, so the next request never runs on stale config.
		resetService();
	}
};

function isLocalManagementRequest(request: Request, getClientAddress: () => string): boolean {
	const direct = getClientAddress();
	if (!isLoopback(direct)) return false;
	// DNS-rebinding defense: SvelteKit's CSRF check doesn't cover JSON bodies, so a page
	// on a hostname that resolves to 127.0.0.1 could POST a `join` here. Require the Host
	// header (when present) to itself be a loopback host, not just the socket address.
	const host = request.headers.get('host');
	if (host && !isLoopbackHost(host)) return false;
	// A local reverse proxy (including Tailscale Serve) connects from loopback but
	// identifies the real remote client here. Do not let it relay sync mutations.
	const forwarded = request.headers.get('x-forwarded-for');
	if (!forwarded) return true;
	return forwarded
		.split(',')
		.map((address) => address.trim())
		.filter(Boolean)
		.every(isLoopback);
}

/** A `Host` header (`name`, `name:port`, or `[::1]:port`) whose host part is loopback. */
function isLoopbackHost(host: string): boolean {
	const trimmed = host.trim().toLowerCase();
	if (trimmed.startsWith('[')) {
		const end = trimmed.indexOf(']');
		if (end === -1) return false;
		return isLoopback(trimmed.slice(1, end));
	}
	// Strip an optional :port from a hostname or IPv4 literal.
	return isLoopback(trimmed.split(':')[0]);
}

function isLoopback(address: string): boolean {
	const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
	return (
		normalized === '::1' ||
		normalized === 'localhost' ||
		normalized === '127.0.0.1' ||
		normalized.startsWith('127.') ||
		normalized.startsWith('::ffff:127.')
	);
}
