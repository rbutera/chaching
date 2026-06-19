// Plain JSON snapshot of the current rollup. Triggers the cold scan if needed.
// Handy for curl/verification and as a non-SSE fallback.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getService } from '$lib/server/service';
import { getPricingMeta } from '$lib/core/pricing/cost';

export const GET: RequestHandler = async () => {
	const service = getService();
	await service.ensureStarted();
	return json({
		snapshot: service.snapshot(),
		pricing: getPricingMeta(),
		service: service.stats
	});
};
