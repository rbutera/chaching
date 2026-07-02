// renderWrappedPng — the runtime PNG template for `chaching wrapped`.
//
// The receipt's fun cousin, on the same cream thermal tape: a Spotify-Wrapped
// monthly recap rendered as a satori element tree and rasterised via the SAME
// runtime pipeline as the receipt (png-pipeline.ts → lazy satori + resvg). It
// reuses the receipt's paper palette + gold mark + deterministic barcode (assets.ts)
// and the vendored JetBrains Mono woffs, so the two share one visual system.
//
// The model handed in is ALREADY redacted by the caller — this template renders it
// verbatim and adds NO env-derived strings, so the PNG can never leak the machine
// name / username / paths.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { money, compactTokens, int } from '../../lib/format.js';
import { renderPng, svgToPngDataUri, type RenderNode } from '../receipt/png-pipeline.js';
import { barWidths, GOLD_MARK_SVG, PAPER } from '../receipt/assets.js';
import type { WrappedModel } from './model.js';

// Scale + derived metrics (mirrors render-png.ts: design px × SCALE, no re-guessing).
const SCALE = 2;
const px = (designPx: number): number => designPx * SCALE;
const ls = (designFontPx: number, em: number): string => `${designFontPx * em * SCALE}px`;

const WIDTH = px(360);
const PAD_Y_TOP = px(26);
const PAD_Y_BOTTOM = px(20);
const PAD_X = px(26);

const SIZE_TITLE = px(13);
const SIZE_SUB = px(11);
const SIZE_SEC = px(10);
const SIZE_BASE = px(13);
const SIZE_HERO = px(22);
const SIZE_TOTAL = px(15);
const SIZE_REF = px(11);
const SIZE_FOOT = px(12);

const MARK = px(34);
const LINE_HEIGHT = 1.5;

function h(type: string, props: RenderNode['props']): RenderNode {
	return { type, props };
}

/** Resolve a vendored mono font, walking up from this module to static/fonts/. */
function resolveFont(name: string): Buffer {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, 'static', 'fonts', name);
		if (existsSync(candidate)) return readFileSync(candidate);
		const built = join(dir, 'build', 'client', 'fonts', name);
		if (existsSync(built)) return readFileSync(built);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const cwdCandidate = join(process.cwd(), 'static', 'fonts', name);
	if (existsSync(cwdCandidate)) return readFileSync(cwdCandidate);
	throw new Error(`wrapped PNG: mono font not found (${name})`);
}

// ── Perforated saw-tooth edges (R1 idiom from render-png.ts) ────────────────────
const TOOTH = px(12);
const EDGE_H = px(8);

function perforationSvg(width: number, height: number, flip: boolean): string {
	const teeth = Math.ceil(width / TOOTH);
	const pts: string[] = [];
	const baseTop = flip ? height : 0;
	const peak = flip ? 0 : height;
	pts.push(`0,${baseTop}`);
	for (let i = 0; i < teeth; i++) {
		const x0 = i * TOOTH;
		pts.push(`${x0 + TOOTH / 2},${peak}`);
		pts.push(`${x0 + TOOTH},${baseTop}`);
	}
	pts.push(`${width},${baseTop}`);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polygon points="${pts.join(' ')}" fill="${PAPER.cream}"/></svg>`;
}

// ── Small node helpers, sized off the design (mirrors render-png.ts) ────────────

function centerLine(
	text: string,
	opts: { size: number; color: string; weight?: number; letterSpacing?: string; marginTop?: number; uppercase?: boolean }
): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			justifyContent: 'center',
			width: '100%',
			fontSize: `${opts.size}px`,
			color: opts.color,
			fontWeight: opts.weight ?? 400,
			...(opts.letterSpacing ? { letterSpacing: opts.letterSpacing } : {}),
			...(opts.marginTop != null ? { marginTop: `${opts.marginTop}px` } : {}),
			lineHeight: LINE_HEIGHT
		},
		children: opts.uppercase ? text.toUpperCase() : text
	});
}

function dashedRule(): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			width: '100%',
			borderTop: `${px(1.5)}px dashed ${PAPER.rule}`,
			marginTop: `${px(14)}px`,
			marginBottom: `${px(14)}px`
		}
	});
}

/** name · dotted leader · right amount (the receipt's `.li` idiom). */
function lineItem(
	name: string,
	amount: string,
	opts: { color?: string; weight?: number; size?: number; uppercase?: boolean; amountWeight?: number } = {}
): RenderNode {
	const size = opts.size ?? SIZE_BASE;
	const color = opts.color ?? PAPER.ink;
	const nm = opts.uppercase ? name.toUpperCase() : name;
	return h('div', {
		style: { display: 'flex', alignItems: 'baseline', gap: `${px(8)}px`, padding: `${px(2)}px 0`, width: '100%' },
		children: [
			h('div', {
				style: {
					display: 'flex',
					flex: '0 1 auto',
					minWidth: '0',
					overflow: 'hidden',
					fontSize: `${size}px`,
					color,
					fontWeight: opts.weight ?? 400,
					...(opts.uppercase ? { letterSpacing: ls(15, 0.04) } : {})
				},
				children: nm
			}),
			h('div', {
				style: {
					display: 'flex',
					flex: '1',
					alignSelf: 'center',
					minHeight: '1px',
					minWidth: `${px(10)}px`,
					borderBottom: `${px(1.5)}px dashed ${PAPER.leader}`
				}
			}),
			h('div', {
				style: {
					display: 'flex',
					flex: '0 0 auto',
					fontSize: `${size}px`,
					color,
					fontWeight: opts.amountWeight ?? opts.weight ?? 400,
					fontVariantNumeric: 'tabular-nums'
				},
				children: amount
			})
		]
	});
}

function sectionLabel(text: string): RenderNode {
	return centerLine(text, { size: SIZE_SEC, color: PAPER.muted, letterSpacing: ls(10, 0.12), uppercase: true, marginTop: px(4) });
}

function markNode(dataUri: string): RenderNode {
	return h('div', {
		style: { display: 'flex', justifyContent: 'center', width: '100%', marginBottom: `${px(8)}px` },
		children: h('img', { src: dataUri, width: MARK, height: MARK, style: { display: 'flex' } })
	});
}

function barcodeNode(): RenderNode {
	const widths = barWidths();
	return h('div', {
		style: {
			display: 'flex',
			height: `${px(46)}px`,
			marginTop: `${px(16)}px`,
			marginBottom: `${px(8)}px`,
			gap: `${px(2)}px`,
			alignItems: 'stretch',
			justifyContent: 'center',
			width: '100%'
		},
		children: widths.map((w) => h('div', { style: { display: 'flex', width: `${w * SCALE}px`, background: PAPER.ink } }))
	});
}

/** Signed percentage, e.g. "+18%". */
function signedPct(frac: number): string {
	const pct = Math.round(frac * 100);
	return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function wrappedElement(model: WrappedModel, markDataUri: string): RenderNode {
	const children: RenderNode[] = [];

	// Header.
	children.push(markNode(markDataUri));
	children.push(centerLine('chaching wrapped', { size: SIZE_TITLE, color: PAPER.ink, weight: 700, letterSpacing: ls(13, 0.04) }));
	children.push(centerLine('your month in tokens', { size: SIZE_SUB, color: PAPER.muted, marginTop: px(3) }));
	const label = model.monthToDate ? `${model.monthLabel} (so far)` : model.monthLabel;
	children.push(centerLine(label, { size: SIZE_SUB, color: PAPER.muted, marginTop: px(2) }));

	if (model.empty) {
		children.push(dashedRule());
		children.push(centerLine('no spend this month.', { size: SIZE_BASE, color: PAPER.ink, marginTop: px(6) }));
		children.push(barcodeNode());
		children.push(centerLine(`REF ${model.ref}`, { size: SIZE_REF, color: PAPER.muted, letterSpacing: ls(11, 0.1) }));
		return wrap(children);
	}

	// The headline — a big hero total (the recap's centrepiece).
	children.push(dashedRule());
	children.push(sectionLabel('the headline'));
	children.push(centerLine(money(model.headline.cost), { size: SIZE_HERO, color: PAPER.ink, weight: 800, marginTop: px(4) }));
	children.push(
		centerLine(`${compactTokens(model.headline.tokens)} tokens · ${int(model.headline.requests)} req`, {
			size: SIZE_SUB,
			color: PAPER.muted,
			marginTop: px(2)
		})
	);

	// Top model.
	children.push(dashedRule());
	children.push(sectionLabel('your top model'));
	if (model.topModel) {
		children.push(lineItem(model.topModel.modelLabel, money(model.topModel.cost), { weight: 700, amountWeight: 700 }));
		children.push(
			lineItem(`${signedPct(model.topModel.share).replace('+', '')} of spend`, `${compactTokens(model.topModel.tokens)} tok`, {
				color: PAPER.muted
			})
		);
	} else {
		children.push(lineItem('no model spend', '', { color: PAPER.muted }));
	}

	// Top project.
	children.push(dashedRule());
	children.push(sectionLabel('your top project'));
	if (model.topProject) {
		children.push(lineItem(model.topProject.display, money(model.topProject.cost), { weight: 700, amountWeight: 700 }));
		// Overlap-rule caveat (whole sessions in window) → no "% of spend" here.
		children.push(lineItem(`${int(model.topProject.sessionCount)} sessions`, 'whole-session totals', { color: PAPER.muted }));
	} else {
		children.push(lineItem('no attributed sessions', '', { color: PAPER.muted }));
	}

	// Biggest day.
	if (model.biggestDay) {
		children.push(dashedRule());
		children.push(sectionLabel('biggest day'));
		children.push(lineItem(model.biggestDay.day, money(model.biggestDay.cost), { weight: 700, amountWeight: 700 }));
	}

	// Cache savings.
	children.push(dashedRule());
	children.push(sectionLabel('cache savings'));
	children.push(lineItem('you saved', `−${money(model.cache.savedVsUncached)}`, { color: PAPER.green, weight: 700, amountWeight: 700 }));
	children.push(lineItem('cache billed', money(model.cache.cacheReadCost + model.cache.cacheWriteCost), { color: PAPER.muted }));

	// Month over month (present only when the build gated a full prior baseline).
	if (model.momDelta) {
		const d = model.momDelta;
		children.push(dashedRule());
		children.push(sectionLabel('vs last month'));
		children.push(lineItem(`vs ${d.priorMonth}`, signedPct(d.deltaPct), { weight: 700, amountWeight: 700, color: PAPER.ink }));
		const sign = d.deltaUsd >= 0 ? '+' : '−';
		children.push(lineItem(`was ${money(d.priorCost)}`, `${sign}${money(Math.abs(d.deltaUsd))}`, { color: PAPER.muted }));
	}

	// Total burn restated as the closing 800-weight line (receipt idiom).
	children.push(dashedRule());
	children.push(
		lineItem('total burn', money(model.headline.cost), {
			color: PAPER.ink,
			weight: 800,
			amountWeight: 800,
			size: SIZE_TOTAL,
			uppercase: true
		})
	);

	// Subscription subsidy.
	if (model.subsidy) {
		const s = model.subsidy;
		children.push(dashedRule());
		children.push(sectionLabel('subscription subsidy'));
		const mult = s.multiple == null ? 'all of it' : `${s.multiple >= 100 ? Math.round(s.multiple) : s.multiple.toFixed(1)}×`;
		children.push(lineItem('this month multiple', mult, { weight: 700, amountWeight: 700, color: PAPER.ink }));
		children.push(lineItem(`${money(s.apiEquivalentUsd)} value`, `for ${money(s.monthlyUsd)} fee`, { color: PAPER.muted }));
		children.push(
			s.netSubsidyUsd >= 0
				? lineItem('net subsidy', `+${money(s.netSubsidyUsd)}`, { color: PAPER.green })
				: lineItem('under-using your plan', money(s.netSubsidyUsd), { color: PAPER.muted })
		);
	}

	// Barcode + REF + footer.
	children.push(barcodeNode());
	children.push(centerLine(`REF ${model.ref}`, { size: SIZE_REF, color: PAPER.muted, letterSpacing: ls(11, 0.1) }));
	if (model.footer) {
		children.push(
			h('div', {
				style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: `${px(6)}px`, width: '100%', marginTop: `${px(14)}px`, fontSize: `${SIZE_FOOT}px`, color: PAPER.footer, lineHeight: LINE_HEIGHT },
				children: [
					h('div', { style: { display: 'flex' }, children: stripTrailingEmoji(model.footer) }),
					h('img', { src: markDataUri, width: px(11), height: px(11), style: { display: 'flex' } })
				]
			})
		);
	}

	return wrap(children);
}

/** Drop a trailing emoji from canned footer copy (the PNG uses a gold mark instead). */
function stripTrailingEmoji(s: string): string {
	return s.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]+\s*$/u, '').trim();
}

function wrap(children: RenderNode[]): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			flexDirection: 'column',
			width: `${WIDTH}px`,
			background: PAPER.cream,
			color: PAPER.ink,
			paddingTop: `${PAD_Y_TOP}px`,
			paddingBottom: `${PAD_Y_BOTTOM}px`,
			paddingLeft: `${PAD_X}px`,
			paddingRight: `${PAD_X}px`,
			fontFamily: 'JetBrains Mono',
			fontSize: `${SIZE_BASE}px`,
			lineHeight: LINE_HEIGHT
		},
		children
	});
}

/** Render the (already-redacted) wrapped model to a cream-paper PNG Buffer. */
export async function renderWrappedPng(model: WrappedModel): Promise<Buffer> {
	const regular = resolveFont('jetbrains-mono-latin-400-normal.woff');
	const bold = resolveFont('jetbrains-mono-latin-700-normal.woff');
	const heavy = resolveFont('jetbrains-mono-latin-800-normal.woff');

	const markDataUri = await svgToPngDataUri(GOLD_MARK_SVG, MARK * 2);
	const topEdge = await svgToPngDataUri(perforationSvg(WIDTH, EDGE_H, false), WIDTH);
	const bottomEdge = await svgToPngDataUri(perforationSvg(WIDTH, EDGE_H, true), WIDTH);

	const tape = wrappedElement(model, markDataUri);

	const tree = h('div', {
		style: { display: 'flex', flexDirection: 'column', width: `${WIDTH}px`, fontFamily: 'JetBrains Mono' },
		children: [
			h('img', { src: topEdge, width: WIDTH, height: EDGE_H, style: { display: 'flex' } }),
			tape,
			h('img', { src: bottomEdge, width: WIDTH, height: EDGE_H, style: { display: 'flex' } })
		]
	});

	return renderPng(tree, {
		width: WIDTH,
		fonts: [
			{ name: 'JetBrains Mono', data: regular, weight: 400, style: 'normal' },
			{ name: 'JetBrains Mono', data: bold, weight: 700, style: 'normal' },
			{ name: 'JetBrains Mono', data: heavy, weight: 800, style: 'normal' }
		]
	});
}
