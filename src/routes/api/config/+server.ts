// Read/write the optional work/personal cutover timestamp.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadConfig, publicConfig, saveConfig, type chachingConfig } from '$lib/core/config';
import { getService } from '$lib/server/service';

export const GET: RequestHandler = async () => {
	return json(publicConfig(await loadConfig()));
};

interface ConfigPatch {
	/** existing cutover write (unchanged behaviour) */
	cutoverTs?: number | null;
	/** additive subscription write for one subsidised provider */
	provider?: 'claude' | 'codex';
	subscription?: { tier?: unknown; monthlyUsd?: unknown };
}

/**
 * POST handles two INDEPENDENT, additive patches (both optional):
 *   1. `cutoverTs` — the work/personal cutover (existing behaviour).
 *   2. `{ provider, subscription }` — merge a per-provider subscription block.
 * Whichever keys are present are applied; absent keys are left untouched. The
 * merged config is persisted via saveConfig (atomic, 0600) and normalizeConfig
 * clamps any out-of-range subscription value, so the write is always safe.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as ConfigPatch;
	const cfg = await loadConfig();
	let next: chachingConfig = cfg;

	// 1. cutover (only when the key is present in the body, so a subscription-only
	//    POST does not silently clear an existing cutover).
	let cutoverChanged = false;
	let cutoverTs = cfg.cutoverTs;
	if ('cutoverTs' in body) {
		cutoverTs = typeof body.cutoverTs === 'number' ? body.cutoverTs : null;
		next = { ...next, cutoverTs };
		cutoverChanged = true;
	}

	// 2. subscription patch for one provider (additive; normalizeConfig clamps).
	if ((body.provider === 'claude' || body.provider === 'codex') && body.subscription) {
		const provider = body.provider;
		const tier =
			typeof body.subscription.tier === 'string' && body.subscription.tier.length > 0
				? body.subscription.tier
				: next.providers[provider].subscription.tier;
		const monthlyUsd =
			typeof body.subscription.monthlyUsd === 'number' &&
			Number.isFinite(body.subscription.monthlyUsd) &&
			body.subscription.monthlyUsd >= 0
				? body.subscription.monthlyUsd
				: next.providers[provider].subscription.monthlyUsd;
		next = {
			...next,
			providers: {
				...next.providers,
				[provider]: { ...next.providers[provider], subscription: { tier, monthlyUsd } }
			}
		};
	}

	await saveConfig(next);
	if (cutoverChanged) getService().setCutover(cutoverTs);
	return json(publicConfig(next));
};
