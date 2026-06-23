// `chaching receipt` — render a period's spend as a branded thermal receipt.
//
// Reuses the core engine (runOnce) + aggregation; this command is a *renderer*
// over the same data `stats` produces. Output discipline mirrors stats.ts exactly:
// synchronous stdout writes (no pipe truncation), --json art-free machine output,
// non-TTY → plain pipe-safe text. Redaction is the DEFAULT for terminal AND png;
// --reveal / --no-redact opts in. --png is a runtime feature gated on the brand
// renderer being available (lazy import; satori/resvg are optionalDependencies).

import { writeSync } from 'node:fs';
import { runOnce } from '../../lib/core/engine.js';
import { loadConfig } from '../../lib/core/config.js';
import { getPricingMeta } from '../../lib/core/pricing/cost.js';
import { sumGrain, filterDays } from '../../lib/core/aggregate.js';
import type { Period } from '../../lib/types.js';
import { noArt as resolveNoArt, receiptFooter } from '../theme/personality.js';
import { buildReceipt, periodDayRange } from '../receipt/build.js';
import { redactReceipt } from '../receipt/redact.js';
import { renderReceiptText } from '../receipt/render-text.js';
import type { ReceiptJson } from '../receipt/model.js';

// Synchronous stdout write — see stats.ts for the rationale (the launcher
// force-exits one-shot commands; an async write to a pipe truncates on exit).
function writeStdoutSync(text: string): void {
	const buf = Buffer.from(text, 'utf8');
	let offset = 0;
	while (offset < buf.length) {
		try {
			offset += writeSync(1, buf, offset, buf.length - offset);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EAGAIN') continue;
			throw err;
		}
	}
}

export interface ReceiptFlags {
	period?: Period;
	providers?: string[];
	json?: boolean;
	/** --png present; value is the path (or undefined → default path). */
	png?: boolean;
	pngPath?: string;
	/** --redact: opt IN to scrubbing username/hostname/paths (default shows them). */
	redact?: boolean;
	/** @deprecated --reveal / --no-redact: now a no-op (showing details is the default). */
	reveal?: boolean;
	/** suppress ASCII art + decorative copy. */
	noArt?: boolean;
}

export async function runReceipt(flags: ReceiptFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	const noArt = flags.noArt ?? resolveNoArt();

	// The receipt defaults to THIS MONTH when no `--period` is given (a monthly
	// statement is the natural framing). An explicit `--period all` opts back into
	// all-time; day/week/quarter override as before. Everything downstream reads
	// `period`, so resolve the default here once.
	const period: Period = flags.period ?? 'month';

	// Footer copy comes from personality (never under --json, never under --no-art).
	const footer = noArt || flags.json ? '' : receiptFooter();

	// Pass the per-provider subscription config so the receipt can render the
	// subsidisation footer. Built additively from the (already loaded) config.
	const subscription = {
		claude: {
			enabled: cfg.providers.claude.enabled,
			tier: cfg.providers.claude.subscription.tier,
			monthlyUsd: cfg.providers.claude.subscription.monthlyUsd
		},
		codex: {
			enabled: cfg.providers.codex.enabled,
			tier: cfg.providers.codex.subscription.tier,
			monthlyUsd: cfg.providers.codex.subscription.monthlyUsd
		}
	};

	const model = buildReceipt(snapshot, {
		period,
		providers: flags.providers,
		noArt: noArt || !!flags.json,
		footer,
		subscription
	});

	// Redaction runs BEFORE every render path (text / json / png). OPT-IN: the
	// receipt shows the user's real details unless `--redact` is passed.
	const redacted = redactReceipt(model, { redact: flags.redact });

	// ── --json: machine output only, art-free, pipe-safe ───────────────────────
	if (flags.json) {
		const { from, to } = periodDayRange(period);
		const providerFilter =
			flags.providers && flags.providers.length > 0 ? new Set(flags.providers) : null;
		let grain = filterDays(snapshot.dayModel, from, to);
		if (providerFilter) grain = grain.filter((dm) => providerFilter.has(dm.provider));
		const totals = sumGrain(grain);
		const payload: ReceiptJson = {
			receipt: redacted,
			totals: {
				tokens: totals.tokens,
				cost: totals.cost,
				requests: totals.requests,
				costUnknownRequests: totals.costUnknownRequests
			},
			_pricing: getPricingMeta()
		};
		writeStdoutSync(JSON.stringify(payload) + '\n');
		// If --png is ALSO requested, still write the file (json wins for stdout).
		if (flags.png) {
			await writePng(redacted, flags, period);
		}
		return;
	}

	// ── --png: write a PNG (runtime brand renderer) ────────────────────────────
	if (flags.png) {
		await writePng(redacted, flags, period);
		// Also print the receipt to the terminal unless piped/non-interactive? The
		// design treats --png as the file action; we still echo the text receipt so
		// the user sees what was rendered. Keep it on the TTY only to stay pipe-safe.
		if (process.stdout.isTTY) {
			writeStdoutSync(renderReceiptText(redacted, { noArt }));
		} else {
			writeStdoutSync(`wrote ${lastPngPath}\n`);
		}
		return;
	}

	// ── default: terminal receipt (TTY-aware, pipe-safe) ───────────────────────
	// Non-TTY → no colour (pipe-safe). renderReceiptText already honours NO_COLOR;
	// force noColor when not a TTY so piping to a file never embeds ANSI.
	const text = renderReceiptText(redacted, {
		noArt,
		noColor: !process.stdout.isTTY ? true : undefined
	});
	writeStdoutSync(text);
}

let lastPngPath = '';

/**
 * Render + write the PNG via the runtime brand renderer. Lazy-imports the renderer
 * (which lazy-imports satori + @resvg/resvg-js, the optionalDependencies). When the
 * native renderer isn't installed, prints a friendly message and exits non-zero
 * WITHOUT writing a partial file.
 */
async function writePng(model: import('../receipt/model.js').ReceiptModel, flags: ReceiptFlags, period: Period): Promise<void> {
	const periodTag = period;
	const outPath = flags.pngPath ?? `./chaching-receipt-${periodTag}.png`;
	lastPngPath = outPath;

	let renderReceiptPng: typeof import('../receipt/render-png.js')['renderReceiptPng'];
	try {
		({ renderReceiptPng } = await import('../receipt/render-png.js'));
	} catch (err) {
		failPng(err);
	}

	try {
		const png = await renderReceiptPng(model);
		const { writeFile } = await import('node:fs/promises');
		await writeFile(outPath, png);
	} catch (err) {
		failPng(err);
	}
}

function failPng(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
	// Only treat genuine module-resolution failures as "missing renderer". A
	// satori/resvg RUNTIME error (deps present, e.g. a layout/font error) must NOT
	// tell the user to install deps they already have — route it to the generic
	// render-failed branch instead.
	const missingDep =
		code === 'ERR_MODULE_NOT_FOUND' ||
		code === 'MODULE_NOT_FOUND' ||
		/Cannot find (package|module) '(satori|@resvg\/resvg-js)'|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(
			msg
		);
	process.stderr.write(
		'chaching receipt: PNG export requires the brand renderer.\n' +
			(missingDep
				? 'Your install came without the PNG renderer dependencies. Install them with:\n' +
					'  npm i -g satori @resvg/resvg-js\n' +
					'(or reinstall chaching to pull the optional renderer).\n'
				: `PNG render failed: ${msg}\n`)
	);
	process.exit(1);
}
