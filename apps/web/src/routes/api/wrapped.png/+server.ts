import { error } from '@sveltejs/kit';
import { receiptAssetRoot } from '$lib/server/assets';
import { yearlyRecap } from '$lib/server/wrapped';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const recap = await yearlyRecap(url);
	try {
		const { renderYearlyWrappedPng } = await import('@chaching/receipt/wrapped/yearly-png');
		const png = await renderYearlyWrappedPng(recap, receiptAssetRoot());
		return new Response(new Uint8Array(png), { headers: {
			'content-type': 'image/png', 'cache-control': 'no-store',
			'content-disposition': `inline; filename="chaching-wrapped-${recap.year}.png"`
		} });
	} catch {
		throw error(503, 'Image export is unavailable. Install the optional PNG renderer to export your recap.');
	}
};
