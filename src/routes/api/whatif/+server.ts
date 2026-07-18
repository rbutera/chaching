// Counterfactual Lab scenario endpoint (task 3.1 server side). Pricing RESOLUTION
// is server-only (cost.ts / modelsdev.ts, node:url file IO), so the web client
// NEVER builds scenarios itself: it derives the window + target model from the
// snapshot it already has and asks this endpoint to reprice. The endpoint runs
// buildScenarios over the SAME live rollup grain the dashboard renders and returns
// the serializable ScenarioResult[] the region renders verbatim (design decision 6
// — one shape, two renderers; the CLI `whatif --json` emits the identical shape).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getService } from '$lib/server/service';
import { buildScenarios } from '$lib/core/whatif/engine';
import { PRICE_ONLY_COUNTERFACTUAL } from '$lib/core/whatif/types';
import { filterDays, sumGrain } from '$lib/core/aggregate';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/whatif?from=YYYY-MM-DD&to=YYYY-MM-DD[&model=<id>]
 *
 * `from`/`to` are the inclusive window the client already computed via
 * `dash.periodWindow(snap)` — passing them (rather than a period name) guarantees
 * the region reprices EXACTLY the window the rest of the dashboard shows, so web
 * and CLI agree for the same window. `model` is the alternate-model reprice target;
 * omitted → the alt-model row is skipped (the client supplies a default from the
 * window's models). no-cache + plan-fit always run.
 */
export const GET: RequestHandler = async ({ url }) => {
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const model = url.searchParams.get('model');

	if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) {
		throw error(400, 'whatif requires from and to as YYYY-MM-DD');
	}
	if (to < from) {
		throw error(400, 'whatif window to must be >= from');
	}

	const service = getService();
	await service.ensureStarted();
	const snapshot = service.snapshot();

	const results = buildScenarios(snapshot.dayModel, {
		window: { from, to },
		targetModel: model && model.length > 0 ? model : null,
		noCache: true,
		planFit: true
	});

	// The window's real recorded bill, the honest anchor the region ranks against
	// (never recomputed from the aggregate — parity with the dashboard hero).
	const windowActual = sumGrain(filterDays(snapshot.dayModel, from, to));

	return json({
		window: { from, to },
		targetModel: model && model.length > 0 ? model : null,
		actual: {
			costUsd: windowActual.cost,
			costUnknownRequests: windowActual.costUnknownRequests
		},
		label: PRICE_ONLY_COUNTERFACTUAL,
		results
	});
};
