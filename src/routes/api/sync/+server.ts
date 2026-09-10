import { isLocalManagementRequest } from '$lib/server/local-management';
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
