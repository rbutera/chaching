// Read/write the optional work/personal cutover timestamp.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadConfig, publicConfig, saveConfig } from '$lib/server/config';
import { getService } from '$lib/server/service';

export const GET: RequestHandler = async () => {
	return json(publicConfig(await loadConfig()));
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { cutoverTs?: number | null };
	const cutoverTs = typeof body.cutoverTs === 'number' ? body.cutoverTs : null;
	const cfg = await loadConfig();
	await saveConfig({ ...cfg, cutoverTs });
	getService().setCutover(cutoverTs);
	return json({ cutoverTs });
};
