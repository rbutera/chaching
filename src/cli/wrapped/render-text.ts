// renderWrappedText — fixed-width thermal-receipt layout for `chaching wrapped`.
//
// The receipt's fun cousin: same tape width, same brass accent, same ALL-CAPS
// section heads and dividers as receipt/render-text.ts, but the body reads like a
// Spotify-Wrapped monthly recap ("your month in tokens") rather than an itemised
// bill. Honours NO_COLOR (no ANSI) and --no-art (ASCII rules, no decorative copy).
// The numbers + structure always render; only decoration is suppressible.

import { money, compactTokens, int } from '../../lib/format.js';
import { accent, bold, dim, noColor as resolveNoColor, noArt as resolveNoArt } from '../theme/personality.js';
import { RECEIPT_WIDTH } from '../receipt/render-text.js';
import type { WrappedModel } from './model.js';

const W = RECEIPT_WIDTH;

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

/** Centre a string within the tape width. */
function centre(s: string): string {
	if (s.length >= W) return s.slice(0, W);
	const pad = W - s.length;
	const left = Math.floor(pad / 2);
	return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

/** A full-width rule (box rule when art on, ASCII '-' when off). */
function rule(noArt: boolean): string {
	return (noArt ? '-' : '─').repeat(W);
}

/** A dashed/dotted separator. */
function dashRule(noArt: boolean): string {
	return (noArt ? '. ' : '╌ ').repeat(Math.ceil(W / 2)).slice(0, W);
}

/** A label/value row with the value right-aligned to the tape width. */
function row(label: string, value: string): string {
	if (label.length + value.length + 1 > W) {
		const room = Math.max(0, W - value.length - 1);
		label = label.slice(0, room);
	}
	const gap = W - label.length - value.length;
	return label + ' '.repeat(Math.max(1, gap)) + value;
}

/** An indented sub-row (2-space indent, value right-aligned). */
function subRow(label: string, value: string): string {
	return row('  ' + label, value);
}

/** ALL-CAPS section head, centred like the receipt's `.sec-label`. */
function sectionHead(text: string): string {
	return centre(text.toUpperCase());
}

/** Signed percentage, e.g. "+18%" / "-4%". */
function signedPct(frac: number): string {
	const pct = Math.round(frac * 100);
	return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * Render the wrapped model to a terminal string. Trailing newline included.
 */
export function renderWrappedText(model: WrappedModel, e: RenderTextEnv = {}): string {
	const { noArt, noColor, env } = resolveEnv(e);
	const lines: string[] = [];

	const C = {
		accent: (s: string) => (noColor ? s : accent(s, env)),
		bold: (s: string) => (noColor ? s : bold(s, env)),
		dim: (s: string) => (noColor ? s : dim(s, env))
	};

	// ── Header ──────────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(C.accent(rule(noArt)));
	lines.push(centre('chaching wrapped'));
	lines.push(centre('your month in tokens'));
	const rangeLine =
		model.from && model.to
			? model.from === model.to
				? model.from
				: `${model.from} -> ${model.to}` // ASCII arrow: pipe-safe, no tofu
			: model.monthLabel;
	const label = model.monthToDate ? `${model.monthLabel} (so far)` : model.monthLabel;
	const combined = `${label}  ·  ${rangeLine}`;
	// centre() hard-slices at the paper width — split rather than truncate the date.
	if (combined.length <= W) {
		lines.push(centre(combined));
	} else {
		lines.push(centre(label));
		lines.push(centre(rangeLine));
	}
	const hostPart = (model.account && model.account.trim()) || '';
	if (hostPart) lines.push(centre(hostPart));
	lines.push(C.accent(rule(noArt)));

	if (model.empty) {
		lines.push('');
		lines.push(centre('no spend this month.'));
		lines.push(centre('come back when the agents have been busy.'));
		lines.push('');
		lines.push(C.accent(rule(noArt)));
		lines.push(centre(`REF ${model.ref}`));
		lines.push(centre(model.barcode));
		lines.push('');
		return lines.join('\n') + '\n';
	}

	// ── The headline ──────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(sectionHead('the headline'));
	lines.push(C.bold(C.accent(row('total burn', money(model.headline.cost)))));
	lines.push(
		C.dim(row(`${compactTokens(model.headline.tokens)} tokens`, `${int(model.headline.requests)} req`))
	);
	if (model.headline.costUnknownRequests > 0) {
		lines.push(C.dim(`(${int(model.headline.costUnknownRequests)} req with unknown pricing)`));
	}

	// ── Top model ───────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(dashRule(noArt));
	lines.push(sectionHead('your top model'));
	if (model.topModel) {
		lines.push(row(model.topModel.modelLabel, money(model.topModel.cost)));
		lines.push(
			C.dim(
				subRow(
					`${signedPct(model.topModel.share).replace('+', '')} of spend`,
					`${compactTokens(model.topModel.tokens)} tok`
				)
			)
		);
	} else {
		lines.push(C.dim(centre('no model spend')));
	}

	// ── Top project ─────────────────────────────────────────────────────────────
	lines.push('');
	lines.push(sectionHead('your top project'));
	if (model.topProject) {
		if (model.topProject.exceedsHeadline) {
			// Whole-session cost beats the calendar-month headline (a session straddling
			// the boundary) — a sub-item bigger than the total is not a shareable claim,
			// so show the name + session count and skip the dollar figure.
			lines.push(row(model.topProject.display, `${int(model.topProject.sessionCount)} sessions`));
			lines.push(C.dim(subRow('sessions span beyond this month', '')));
		} else {
			lines.push(row(model.topProject.display, money(model.topProject.cost)));
			// Overlap-rule caveat (whole sessions in window) → no "% of spend" here.
			lines.push(
				C.dim(subRow(`${int(model.topProject.sessionCount)} sessions`, 'whole-session totals'))
			);
		}
	} else {
		lines.push(C.dim(centre('no attributed sessions')));
	}

	// ── Biggest day ─────────────────────────────────────────────────────────────
	if (model.biggestDay) {
		lines.push('');
		lines.push(sectionHead('biggest day'));
		lines.push(row(model.biggestDay.day, money(model.biggestDay.cost)));
	}

	// ── Cache savings ───────────────────────────────────────────────────────────
	lines.push('');
	lines.push(dashRule(noArt));
	lines.push(sectionHead('cache savings'));
	lines.push(row('you saved', C.bold(money(model.cache.savedVsUncached))));
	if (model.cache.cacheReadTokens > 0) {
		lines.push(
			C.dim(subRow(`${compactTokens(model.cache.cacheReadTokens)} reads @ cache rate`, ''))
		);
	} else {
		lines.push(C.dim('  no cache reads this month'));
	}
	lines.push(C.dim(subRow('cache billed', money(model.cache.cacheReadCost + model.cache.cacheWriteCost))));

	// ── Month over month ────────────────────────────────────────────────────────
	// Rendered ONLY when the prior calendar month is a full baseline (build gate).
	if (model.momDelta) {
		lines.push('');
		lines.push(dashRule(noArt));
		lines.push(sectionHead('vs last month'));
		const d = model.momDelta;
		const vsLabel = d.likeForLike ? `vs same point in ${d.priorMonth}` : `vs ${d.priorMonth}`;
		lines.push(C.accent(C.bold(row(vsLabel, signedPct(d.deltaPct)))));
		const sign = d.deltaUsd >= 0 ? '+' : '-';
		lines.push(C.dim(row(`was ${money(d.priorCost)}`, `${sign}${money(Math.abs(d.deltaUsd))}`)));
	}

	// ── Subscription subsidy ────────────────────────────────────────────────────
	if (model.subsidy) {
		const s = model.subsidy;
		lines.push('');
		lines.push(dashRule(noArt));
		lines.push(C.dim(noArt ? 'SUBSCRIPTION SUBSIDY' : '✦ SUBSCRIPTION SUBSIDY'));
		const mult =
			s.multiple == null
				? '∞ — all of it'
				: `${s.multiple >= 100 ? Math.round(s.multiple) : s.multiple.toFixed(1)}×`;
		lines.push(C.accent(C.bold(row('this month multiple', mult))));
		lines.push(C.dim(row(`${money(s.apiEquivalentUsd)} value`, `for ${money(s.monthlyUsd)} fee`)));
		if (s.netSubsidyUsd >= 0) {
			lines.push(row('net subsidy', `+${money(s.netSubsidyUsd)}`));
		} else {
			lines.push(C.dim(row('under-using your plan', money(s.netSubsidyUsd))));
		}
	}

	// ── Footer flourish + barcode ─────────────────────────────────────────────────
	lines.push('');
	lines.push(C.accent(rule(noArt)));
	if (!noArt && model.footer) {
		lines.push(centre(C.dim(model.footer)));
	}
	lines.push(centre(C.dim(`REF ${model.ref}`)));
	lines.push(centre(model.barcode));
	lines.push('');

	return lines.join('\n') + '\n';
}
