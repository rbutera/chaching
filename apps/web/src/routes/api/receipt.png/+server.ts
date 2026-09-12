import { receiptAssetRoot } from '$lib/server/assets';
// GET /api/receipt.png — stream a branded thermal-receipt PNG of the CURRENT
// dashboard view. SERVER-ONLY (Node): reuses the exact CLI receipt pipeline
// (buildReceipt → redactReceipt → renderReceiptPng, satori + resvg). It lives in
// a `+server.ts` so the Node-only render path (fileURLToPath, satori, resvg) never
// reaches the client bundle (client-bundle grep stays 0).
//
// Query params (all optional):
//   period   day|week|month|quarter|all   — defaults to `month` (matches the CLI)
//   redact   "1"/"true"                    — opt IN to scrubbing PII (default: shown)
//   day      YYYY-MM-DD                     — focused-day pin; scopes to that one day
//   provider <name>[,<name>]               — filter to provider(s)
//
// Redaction is OPT-IN (matches the CLI): the receipt shows the user's real details
// by default; `?redact=1` scrubs username/hostname/paths before sharing. The receipt
// reflects the dashboard's active period/scope because the button forwards the live
// query.

import { ACCOUNT_SPEND_FILTER_UNAVAILABLE } from '@chaching/shared/accounts';
import { error } from '@sveltejs/kit';
import { isCalendarDay } from '@chaching/shared/view-model';
import type { RequestHandler } from './$types';
import { getService } from '../../../lib/server/service';
import { getReportAccountContext } from '@chaching/core/sync/manager';
import { buildReceipt } from '@chaching/receipt/receipt/build';
import {redactReceipt} from '@chaching/receipt/receipt/redact';
import {currentAccount,redactionContext} from '@chaching/receipt/receipt/node-context';
import { receiptFooter } from '@chaching/shared/voice';
import type { Period } from '@chaching/shared/types';

// NOTE: render-png (→ satori + @resvg/resvg-js, a native .node binding) is
// LAZY-imported inside the handler, never at module scope. A static import here
// drags the native binary into the SSR module graph and breaks the adapter-node
// rollup build (it tries to parse the .node file). Lazy import mirrors the CLI
// receipt command's proven pattern and keeps the render path server-runtime-only.

const VALID_PERIODS = new Set<Period>(['day', 'week', 'month', 'quarter', 'all']);

function parsePeriod(raw: string | null): Period {
	if (raw && VALID_PERIODS.has(raw as Period)) return raw as Period;
	// Match the CLI default: an unset/unknown period is "this month".
	return 'month';
}


export const GET: RequestHandler = async ({ url }) => {
	const params = url.searchParams;
	if (params.has('account')) throw error(400, ACCOUNT_SPEND_FILTER_UNAVAILABLE);

	const period = parsePeriod(params.get('period'));
	const redact = ((): boolean => {
		const v = params.get('redact');
		return v === '1' || v === 'true';
	})();

	// Focused-day pin (dashboard drill-in) → a single-day inclusive range that wins
	// over the period's computed range. A present-but-malformed `day` is a 400 (don't
	// silently widen the scope back to the full period — that would show MORE than the
	// caller asked for, which matters now redaction is opt-in).
	const day = params.get('day');
	if (day !== null && !isCalendarDay(day)) {
		throw error(400, `invalid day '${day}' (expected YYYY-MM-DD)`);
	}
	const from = params.get('from');
	const to = params.get('to');
	if ((from !== null || to !== null) && (!from || !to || !isCalendarDay(from) || !isCalendarDay(to) || from > to)) {
		throw error(400, 'invalid date range (expected from and to in YYYY-MM-DD order)');
	}
	const range = day ? { from: day, to: day } : from && to ? { from, to } : undefined;

	// Provider filter (repeatable or comma-separated), mirroring the CLI.
	const providers = params
		.getAll('provider')
		.flatMap((p) => p.split(','))
		.map((s) => s.trim())
		.filter(Boolean);

	const models = params.getAll('model').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);

	const machines = params.getAll('machine').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);

	const service = getService();
	await service.ensureStarted();
	const snapshot = service.snapshot();

	// Per-provider subscription config for the subsidisation footer — built from the
	// persisted config, exactly like the CLI receipt command.
	const { fees: subscription } = await getReportAccountContext({ machines });

	const model = buildReceipt(snapshot, {
		period,
		providers: providers.length > 0 ? providers : undefined,
		models,
		machines,
		range,
		footer: receiptFooter(),
		subscription,
		account: currentAccount()
	});

	// Redaction OPT-IN (matches the CLI): shows real details unless `?redact=1`.
	const redacted = redactReceipt(model, { ...redactionContext(), redact });

	let png: Buffer;
	try {
		const { renderReceiptPng } = await import('@chaching/receipt/receipt/render-png');
		png = await renderReceiptPng(redacted, { assetRoot: receiptAssetRoot() });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw error(500, `receipt render failed: ${msg}`);
	}

	return new Response(new Uint8Array(png), {
		headers: {
			'content-type': 'image/png',
			// A receipt is a point-in-time snapshot; let the browser show it inline.
			'content-disposition': `inline; filename="chaching-receipt-${period}.png"`,
			'cache-control': 'no-store'
		}
	});
};
