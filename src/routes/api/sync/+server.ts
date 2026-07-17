import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The route contract is present independently of the optional PostgreSQL driver
// so the web dashboard can always render its local-only setup state. The sync
// service replaces these local fallbacks when the backend is configured.
export const GET: RequestHandler = async () => {
	return json({
		enabled: false,
		databaseConfigured: false,
		pool: null,
		machine: null,
		machines: [],
		subscriptions: [],
		mappings: []
	});
};

export const POST: RequestHandler = async () => {
	return json({ error: 'Chaching Sync backend is not available in this build.' }, { status: 501 });
};
