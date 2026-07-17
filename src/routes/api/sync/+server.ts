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
	try {
		if (!isLocalManagementRequest(request, getClientAddress)) {
			return json(
				{ error: 'Sync configuration is local-only. Run the command on the Chaching host.' },
				{ status: 403 }
			);
		}
		const action = (await request.json()) as SyncAction;
		if (!action || typeof action !== 'object' || typeof action.action !== 'string')
			return json({ error: 'Invalid sync action' }, { status: 400 });
		const status = await performSyncAction(action);
		resetService();
		return json(status);
	} catch (cause) {
		const error = cause instanceof Error ? cause.message : String(cause);
		return json({ error }, { status: 400 });
	}
};

function isLocalManagementRequest(request: Request, getClientAddress: () => string): boolean {
	const direct = getClientAddress();
	if (!isLoopback(direct)) return false;
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
