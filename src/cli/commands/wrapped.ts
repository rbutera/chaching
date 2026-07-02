// `chaching wrapped` — a Spotify-Wrapped-style MONTHLY recap in the thermal-receipt
// voice. The receipt's fun cousin: same engine (runOnce), same PNG plumbing, same
// personality voice + redaction semantics, but the body is a shareable "your month
// in tokens" recap instead of an itemised bill.
//
// Output discipline mirrors receipt.ts exactly: synchronous stdout writes (no pipe
// truncation), --json art-free machine output, non-TTY → plain pipe-safe text.
// Redaction is OPT-IN (--redact). --png is gated on the runtime brand renderer
// being available (lazy import; satori/resvg are optionalDependencies).

import { writeSync } from 'node:fs';
import { runOnce } from '../../lib/core/engine.js';
import { loadConfig } from '../../lib/core/config.js';
import { getPricingMeta } from '../../lib/core/pricing/cost.js';
import { noArt as resolveNoArt, receiptFooter } from '../theme/personality.js';
import { buildWrapped } from '../wrapped/build.js';
import { redactWrapped } from '../wrapped/redact.js';
import { currentAccount } from '../receipt/redact.js';
import { renderWrappedText } from '../wrapped/render-text.js';
import type { WrappedJson } from '../wrapped/model.js';

// Synchronous stdout write — see receipt.ts/stats.ts for the rationale (the
// launcher force-exits one-shot commands; an async write to a pipe truncates).
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

export interface WrappedFlags {
	/** target calendar month, ISO `YYYY-MM`; default = current month-to-date. */
	month?: string;
	json?: boolean;
	/** --png present; value is the path (or undefined → default path). */
	png?: boolean;
	pngPath?: string;
	/** --redact: opt IN to scrubbing username/hostname/paths (default shows them). */
	redact?: boolean;
	/** suppress ASCII art + decorative copy. */
	noArt?: boolean;
}

export async function runWrapped(flags: WrappedFlags): Promise<void> {
	const cfg = await loadConfig();
	const snapshot = await runOnce(cfg);

	const noArt = flags.noArt ?? resolveNoArt();
	const now = new Date();

	// Footer copy comes from personality (never under --json, never under --no-art).
	const footer = noArt || flags.json ? '' : receiptFooter();

	// Per-provider subscription config → enables the subsidy block (mirrors receipt).
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

	const model = buildWrapped(snapshot, {
		month: flags.month,
		noArt: noArt || !!flags.json,
		footer,
		subscription,
		account: currentAccount(),
		now: now.getTime()
	});

	// Redaction runs BEFORE every render path (text / json / png). OPT-IN.
	const redacted = redactWrapped(model, { redact: flags.redact });

	// ── --json: machine output only, art-free, pipe-safe ───────────────────────
	if (flags.json) {
		const payload: WrappedJson = { wrapped: redacted, _pricing: getPricingMeta() };
		writeStdoutSync(JSON.stringify(payload) + '\n');
		if (flags.png) await writePng(redacted, flags);
		return;
	}

	// ── --png: write a PNG (runtime brand renderer) ────────────────────────────
	if (flags.png) {
		await writePng(redacted, flags);
		if (process.stdout.isTTY) {
			writeStdoutSync(renderWrappedText(redacted, { noArt }));
		} else {
			writeStdoutSync(`wrote ${lastPngPath}\n`);
		}
		return;
	}

	// ── default: terminal recap (TTY-aware, pipe-safe) ─────────────────────────
	const text = renderWrappedText(redacted, {
		noArt,
		noColor: !process.stdout.isTTY ? true : undefined
	});
	writeStdoutSync(text);
}

let lastPngPath = '';

/**
 * Render + write the PNG via the runtime brand renderer. Lazy-imports the renderer
 * (which lazy-imports satori + @resvg/resvg-js). When the native renderer isn't
 * installed, prints a friendly message and exits non-zero WITHOUT a partial file.
 * Copies the receipt command's exact missing-dep vs render-failed handling.
 */
async function writePng(model: import('../wrapped/model.js').WrappedModel, flags: WrappedFlags): Promise<void> {
	const outPath = flags.pngPath ?? `./chaching-wrapped-${model.month}.png`;
	lastPngPath = outPath;

	let renderWrappedPng: typeof import('../wrapped/render-png.js')['renderWrappedPng'];
	try {
		({ renderWrappedPng } = await import('../wrapped/render-png.js'));
	} catch (err) {
		failPng(err);
	}

	try {
		const png = await renderWrappedPng(model);
		const { writeFile } = await import('node:fs/promises');
		await writeFile(outPath, png);
	} catch (err) {
		failPng(err);
	}
}

function failPng(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
	const missingDep =
		code === 'ERR_MODULE_NOT_FOUND' ||
		code === 'MODULE_NOT_FOUND' ||
		/Cannot find (package|module) '(satori|@resvg\/resvg-js)'|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(msg);
	process.stderr.write(
		'chaching wrapped: PNG export requires the brand renderer.\n' +
			(missingDep
				? 'Your install came without the PNG renderer dependencies. Install them with:\n' +
					'  npm i -g satori @resvg/resvg-js\n' +
					'(or reinstall chaching to pull the optional renderer).\n'
				: `PNG render failed: ${msg}\n`)
	);
	process.exit(1);
}
