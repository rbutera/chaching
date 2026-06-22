// renderReceiptText — fixed-width thermal-receipt layout for the terminal.
//
// A pure(-ish) string builder over the ReceiptModel. Honours NO_COLOR (no ANSI)
// and --no-art / CHACHING_NO_ART (ASCII rules instead of box-drawing, no
// decorative copy/emoji). The numbers + structure always render; only decoration
// is suppressible. The brass accent is the only colour used, and only on the
// header rule + TOTAL BURN, mirroring the brand.

import { money, compactTokens, providerLabel, int } from '../../lib/format.js';
import { accent, bold, dim, noColor as resolveNoColor, noArt as resolveNoArt } from '../theme/personality.js';
import type { ReceiptModel } from './model.js';

/** Fixed thermal width in columns. */
export const RECEIPT_WIDTH = 42;

export interface RenderTextEnv {
	noArt?: boolean;
	noColor?: boolean;
	env?: NodeJS.ProcessEnv;
}

function resolveEnv(e: RenderTextEnv): { noArt: boolean; noColor: boolean; env: NodeJS.ProcessEnv } {
	const env = e.env ?? process.env;
	return {
		noArt: e.noArt ?? resolveNoArt([], env),
		noColor: e.noColor ?? resolveNoColor(env),
		env
	};
}

const W = RECEIPT_WIDTH;

/** Centre a string within the receipt width. */
function centre(s: string): string {
	if (s.length >= W) return s.slice(0, W);
	const pad = W - s.length;
	const left = Math.floor(pad / 2);
	return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

/** A full-width rule. Solid box rule when art on, ASCII '-' when off. */
function rule(noArt: boolean): string {
	return (noArt ? '-' : '─').repeat(W);
}

/** A dashed/dotted separator. */
function dashRule(noArt: boolean): string {
	return (noArt ? '. ' : '╌ ').repeat(Math.ceil(W / 2)).slice(0, W);
}

/** A label/value row with the value right-aligned to the receipt width. */
function row(label: string, value: string): string {
	const max = W;
	if (label.length + value.length + 1 > max) {
		// truncate the label so the value always fits
		const room = Math.max(0, max - value.length - 1);
		label = label.slice(0, room);
	}
	const gap = max - label.length - value.length;
	return label + ' '.repeat(Math.max(1, gap)) + value;
}

/** An indented sub-row (2-space indent, value right-aligned). */
function subRow(label: string, value: string): string {
	return row('  ' + label, value);
}

/**
 * Render the receipt model to a terminal string. Trailing newline included.
 */
export function renderReceiptText(model: ReceiptModel, e: RenderTextEnv = {}): string {
	const { noArt, noColor, env } = resolveEnv(e);
	const lines: string[] = [];

	const C = {
		accent: (s: string) => (noColor ? s : accent(s, env)),
		bold: (s: string) => (noColor ? s : bold(s, env)),
		dim: (s: string) => (noColor ? s : dim(s, env))
	};

	// ── Header ────────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(C.accent(rule(noArt)));
	// wordmark: strip the emoji when art is off
	const wm = noArt ? 'chaching — AI token spend register' : model.wordmark;
	lines.push(centre(wm));
	const rangeLine =
		model.from && model.to
			? model.from === model.to
				? model.from
				: `${model.from} → ${model.to}`
			: model.periodLabel;
	lines.push(centre(`${model.periodLabel}  ·  ${rangeLine}`));
	if (model.providers && model.providers.length > 0) {
		lines.push(centre(`providers: ${model.providers.join(', ')}`));
	}
	lines.push(C.accent(rule(noArt)));

	if (model.empty) {
		lines.push('');
		lines.push(centre('no receipts yet.'));
		lines.push(centre('run `chaching init` to start.'));
		lines.push('');
		lines.push(C.accent(rule(noArt)));
		lines.push(centre(model.ref));
		lines.push(centre(model.barcode));
		lines.push('');
		return lines.join('\n') + '\n';
	}

	// ── Line items ──────────────────────────────────────────────────────────────
	lines.push('');
	let lastProvider: string | null = null;
	for (const it of model.lineItems) {
		if (it.provider !== lastProvider) {
			lines.push(C.dim(providerLabel(it.provider).toUpperCase()));
			lastProvider = it.provider;
		}
		const note = it.unknownPrice ? ' (price?)' : '';
		const toks = compactTokens(
			it.tokens.input + it.tokens.output + it.tokens.cacheCreation + it.tokens.cacheRead
		);
		lines.push(subRow(`${it.modelLabel}${note}`, money(it.cost)));
		lines.push(C.dim(subRow(`  ${toks} tok · ${int(it.requests)} req`, '')));
	}

	// ── Coupons (cache reads as discounts) ──────────────────────────────────────
	lines.push('');
	lines.push(dashRule(noArt));
	if (model.coupons.length > 0) {
		lines.push(noArt ? 'COUPONS / CACHE DISCOUNTS' : '✁ COUPONS — CACHE DISCOUNTS');
		for (const c of model.coupons) {
			lines.push(subRow(`${c.modelLabel} cache hit`, `-${money(c.saved)}`));
			lines.push(
				C.dim(subRow(`  ${compactTokens(c.cacheReadTokens)} reads @ cache rate`, ''))
			);
		}
		lines.push(row('YOU SAVED', C.bold(`-${money(model.youSaved)}`)));
	} else {
		lines.push(row('CACHE DISCOUNTS', money(0)));
		lines.push(C.dim('  no cache reads in this period'));
	}

	// ── Subtotals ───────────────────────────────────────────────────────────────
	if (model.subtotals.length > 0) {
		lines.push('');
		lines.push(dashRule(noArt));
		for (const s of model.subtotals) {
			const fam = s.family.charAt(0).toUpperCase() + s.family.slice(1);
			lines.push(row(`subtotal ${fam}`, money(s.cost)));
		}
	}

	// ── Total burn ──────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(C.accent(rule(noArt)));
	lines.push(C.bold(C.accent(row('TOTAL BURN', money(model.totalBurn)))));
	lines.push(C.dim(row(`${compactTokens(model.totalTokens)} tokens`, `${int(model.requests)} req`)));
	if (model.costUnknownRequests > 0) {
		lines.push(C.dim(`(${int(model.costUnknownRequests)} req with unknown pricing)`));
	}
	lines.push(C.accent(rule(noArt)));

	// ── Footer flourish + barcode ───────────────────────────────────────────────
	if (!noArt && model.footer) {
		lines.push('');
		lines.push(centre(C.dim(model.footer)));
	}
	lines.push('');
	lines.push(centre(C.dim(`REF ${model.ref}`)));
	lines.push(centre(model.barcode));
	lines.push('');

	return lines.join('\n') + '\n';
}
