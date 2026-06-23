// renderReceiptPng — the runtime PNG receipt template.
//
// A pixel-faithful 1:1 port of the DesignSync "Till Stack" thermal receipt
// (vault: ui_kits/receipt/index.html): cream thermal tape, JetBrains Mono ink, a
// centered gold mark, dotted-leader line items, dashed/dotted rules, a coupon-green
// "coupons / cache discounts" block + green "you saved", an 800-weight uppercase
// "total burn", the design's deterministic LCG barcode, a REF line, and a rotating
// wry footer. Only the dynamic fields (items, coupons, totals, range, REF, footer,
// redaction) come from the real (already-redacted) ReceiptModel; everything else
// matches the design.
//
// Built as a satori element tree and rasterised via the RUNTIME pipeline
// (png-pipeline.ts → lazy satori + resvg). Fonts are the vendored JetBrains Mono
// woffs in static/fonts/ (400 + 700 + 800), resolved by walking up from this
// module so it works from any cwd and the bundled dist/cli layout.
//
// satori is flexbox-only (no ::before/::after, no repeating-linear-gradient): every
// such design feature is reconstructed out of plain flex <div>s + borders + a
// pre-rasterised SVG mark (see the R-row comments + design.md's reconstruction map).
//
// The model handed in is ALREADY redacted by the caller — this template renders it
// verbatim and adds NO env-derived strings, so the PNG can never leak the machine
// name / username / paths. The redacted user·path line is rendered as the design's
// redaction blocks (background swatch, transparent text) unless `--reveal` produced
// plain values upstream.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { money, compactTokens, providerLabel, int } from '../../lib/format.js';
import { renderPng, svgToPngDataUri, type RenderNode } from './png-pipeline.js';
import { barWidths, GOLD_MARK_SVG, RANGE_ARROW_SVG, PAPER } from './assets.js';
import { PLACEHOLDER } from './redact.js';
import type { ReceiptModel } from './model.js';

// ── Scale + derived metrics ───────────────────────────────────────────────────
// The design tape is 360px. We render at ×2 (720px) so the PNG is crisp when
// shared; EVERY metric below is the design's value × SCALE — no per-element
// re-guessing (design.md D3). Change SCALE and the whole receipt scales coherently.
const SCALE = 2;
const px = (designPx: number): number => designPx * SCALE;
/** letter-spacing: design `em` against that element's design font-size → px (×scale). */
const ls = (designFontPx: number, em: number): string => `${designFontPx * em * SCALE}px`;

const WIDTH = px(360); // 720
const PAD_Y_TOP = px(26);
const PAD_Y_BOTTOM = px(20);
const PAD_X = px(26);

// Type sizes (design px → render px).
const SIZE_BASE = px(13);
const SIZE_TITLE = px(13);
const SIZE_SUB = px(11);
const SIZE_SEC = px(10);
const SIZE_TOTAL = px(15);
const SIZE_REF = px(11);
const SIZE_FOOT = px(12);
const SIZE_SMALL = px(11); // .nm small sits at the inherited 13px in the design; keep a touch smaller

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
		// adapter-node copies static → build/client
		const built = join(dir, 'build', 'client', 'fonts', name);
		if (existsSync(built)) return readFileSync(built);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const cwdCandidate = join(process.cwd(), 'static', 'fonts', name);
	if (existsSync(cwdCandidate)) return readFileSync(cwdCandidate);
	throw new Error(`receipt PNG: mono font not found (${name})`);
}

// ── R1: torn perforated edges ───────────────────────────────────────────────
// The design draws ::before/::after saw-tooth strips with crossed
// repeating-linear-gradients. satori has neither pseudo-elements nor repeating
// gradients, so we draw a single inline-SVG saw-tooth strip (cream teeth over the
// page bg), pre-rasterised to a PNG data-URI (satori SVG-in-<image> → blank under
// resvg). The bottom strip is the mirrored (scaleY(-1)) path.
const TOOTH = px(12); // gradient pitch in the design (6px on + 6px off → ~12px tooth)
const EDGE_H = px(8);

function perforationSvg(width: number, height: number, flip: boolean): string {
	const teeth = Math.ceil(width / TOOTH);
	// Build a zig-zag polygon of cream teeth biting into transparent. flip mirrors
	// vertically so the bottom edge points the other way (design's scaleY(-1)).
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

// ── Small node helpers, all sized off the design ──────────────────────────────

/** Centered single line (header title / subs / sec-labels / ref / footer). */
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
		// R11: uppercase is applied in TS (satori ignores text-transform).
		children: opts.uppercase ? text.toUpperCase() : text
	});
}

// R5: rules — full-width div with a dashed/dotted top border (design .rule / .rule.dot).
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
// R5 fallback: satori only allows solid|dashed borders (NOT dotted), so the
// design's `2px dotted` rule is drawn as a clipped full-width row of `·` glyphs in
// the rule colour — a faithful dotted line that rasterises reliably under resvg.
function dottedRule(): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			width: '100%',
			height: `${px(2) * LINE_HEIGHT * 6}px`,
			overflow: 'hidden',
			color: PAPER.rule,
			fontSize: `${px(11)}px`,
			letterSpacing: `${px(2)}px`,
			marginTop: `${px(12)}px`,
			marginBottom: `${px(12)}px`
		},
		children: '·'.repeat(140)
	});
}

// R4 + the .li layout: name (+ dim small) · dotted leader · right amount.
function lineItem(
	name: string,
	sub: string | null,
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
					// shrinkable so a long token/req sub never pushes the amount off
					// the tape; the leader (flex:1) takes the remaining slack.
					flex: '0 1 auto',
					minWidth: '0',
					overflow: 'hidden',
					fontSize: `${size}px`,
					color,
					fontWeight: opts.weight ?? 400,
					...(opts.uppercase ? { letterSpacing: ls(15, 0.04) } : {})
				},
				children: sub
					? [
							h('div', { style: { display: 'flex', flex: '0 0 auto' }, children: nm }),
							h('div', { style: { display: 'flex', flexShrink: 0, whiteSpace: 'nowrap', color: PAPER.subSmall, fontSize: `${SIZE_SMALL}px`, marginLeft: `${px(6)}px` }, children: sub })
						]
					: nm
			}),
			// R4 dotted leader. satori forbids `dotted` borders (solid|dashed only),
			// so the flex-grow leader uses a `dashed` bottom border in the leader
			// colour — a satori-legal dotted-style leader that fills the gap and
			// rasterises reliably (the design's 1.5px dotted reads the same at scale).
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
					// R9: tabular-nums (JetBrains Mono is monospace so columns align regardless).
					fontVariantNumeric: 'tabular-nums'
				},
				children: amount
			})
		]
	});
}

// R7: centered gold mark (pre-rasterised PNG data-URI — NOT a raw SVG node).
function markNode(dataUri: string): RenderNode {
	return h('div', {
		style: { display: 'flex', justifyContent: 'center', width: '100%', marginBottom: `${px(8)}px` },
		children: h('img', { src: dataUri, width: MARK, height: MARK, style: { display: 'flex' } })
	});
}

// R8: redaction block — a background swatch with transparent text (so its width
// matches the hidden string). When the value is the redaction sentinel, render the
// block; otherwise (revealed) render plain ink text.
function redactableSpan(value: string): RenderNode {
	const redacted = value === PLACEHOLDER || value.includes(PLACEHOLDER);
	if (!redacted) {
		return h('div', { style: { display: 'flex', color: PAPER.muted }, children: value });
	}
	return h('div', {
		style: {
			display: 'flex',
			background: PAPER.redaction,
			color: 'transparent',
			borderRadius: `${px(2)}px`,
			padding: `0 ${px(4)}px`
		},
		children: value
	});
}

// R6: barcode — a flex row of bar divs, exact per-bar widths from the ported LCG.
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
		children: widths.map((w) =>
			h('div', { style: { display: 'flex', width: `${w * SCALE}px`, background: PAPER.ink } })
		)
	});
}

/** Header block: mark + title + period·range sub + redacted user·path sub. */
function header(model: ReceiptModel, markDataUri: string, arrowDataUri: string): RenderNode[] {
	const hasRange = !!(model.from && model.to) && model.from !== model.to;

	// The design's user·path line. `model.account` carries the real "user@host" the
	// receipt was cut on (supplied by the Node callers). It's shown verbatim by
	// DEFAULT; on opt-in redaction the caller has already scrubbed it upstream to a
	// placeholder-bearing string, so `redactableSpan` renders it as a redaction block.
	// We never read env here. Fall back to the wordmark's "@host" (legacy) then the
	// PLACEHOLDER sentinel so a caller that supplies no identity still gets a block.
	const hostPart = model.wordmark.includes('@') ? model.wordmark.split('@').pop()!.trim() : '';
	const userVal = (model.account && model.account.trim()) || hostPart || PLACEHOLDER;

	const nodes: RenderNode[] = [
		markNode(markDataUri),
		centerLine('chaching — token spend register', { size: SIZE_TITLE, color: PAPER.ink, weight: 700, letterSpacing: ls(13, 0.04) })
	];
	// period · range — the "→" arrow (U+2192) is tofu in the latin mono subset, so
	// it's rendered as a small inline PNG arrow (R-row glyph-fallback discipline).
	if (hasRange) {
		nodes.push(
			h('div', {
				style: { display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: `${px(5)}px`, width: '100%', fontSize: `${SIZE_SUB}px`, color: PAPER.muted, marginTop: `${px(3)}px`, lineHeight: LINE_HEIGHT },
				children: [
					h('div', { style: { display: 'flex' }, children: `${model.periodLabel} · ${model.from}` }),
					h('img', { src: arrowDataUri, width: px(12), height: px(8), style: { display: 'flex', alignSelf: 'center' } }),
					h('div', { style: { display: 'flex' }, children: `${model.to}` })
				]
			})
		);
	} else {
		const single = model.from && model.to ? model.from : model.periodLabel;
		nodes.push(centerLine(`${model.periodLabel} · ${single}`, { size: SIZE_SUB, color: PAPER.muted, marginTop: px(3) }));
	}
	// user · path line (redaction blocks unless revealed).
	nodes.push(
		h('div', {
			style: { display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: `${px(5)}px`, width: '100%', fontSize: `${SIZE_SUB}px`, marginTop: `${px(3)}px`, lineHeight: LINE_HEIGHT },
			children: [redactableSpan(userVal), h('div', { style: { display: 'flex', color: PAPER.muted }, children: '·' }), redactableSpan(model.providers && model.providers.length > 0 ? model.providers.join(', ') : PLACEHOLDER)]
		})
	);
	if (model.providers && model.providers.length > 0) {
		// already shown on the user·path line; nothing extra.
	}
	return nodes;
}

function receiptElement(model: ReceiptModel, markDataUri: string, arrowDataUri: string): RenderNode {
	const children: RenderNode[] = [];

	children.push(...header(model, markDataUri, arrowDataUri));

	if (model.empty) {
		children.push(dashedRule());
		children.push(centerLine('no receipts yet.', { size: SIZE_BASE, color: PAPER.ink, marginTop: px(6) }));
		children.push(centerLine('run `chaching init` to start.', { size: SIZE_SUB, color: PAPER.muted, marginTop: px(2) }));
		children.push(dashedRule());
		children.push(barcodeNode());
		children.push(centerLine(`REF ${model.ref}`, { size: SIZE_REF, color: PAPER.muted, letterSpacing: ls(11, 0.1) }));
		return wrap(children);
	}

	// ── Line items (dashed rule, then one .li per provider/model) ────────────
	children.push(dashedRule());
	for (const it of model.lineItems) {
		const note = it.unknownPrice ? ' (price?)' : '';
		const toks = compactTokens(it.tokens.input + it.tokens.output + it.tokens.cacheCreation + it.tokens.cacheRead);
		// design small = the compact token figure only (short, single line like
		// "8.1M tok"); the request count lives in the totals, not each .li small.
		children.push(lineItem(`${providerLabel(it.provider)} · ${it.modelLabel}${note}`, `${toks} tok`, money(it.cost)));
	}

	// ── Coupons / cache discounts (dotted rule, green block) ─────────────────
	children.push(dottedRule());
	children.push(centerLine('coupons / cache discounts', { size: SIZE_SEC, color: PAPER.muted, letterSpacing: ls(10, 0.12), uppercase: true, marginTop: px(4) }));
	if (model.coupons.length > 0) {
		for (const c of model.coupons) {
			children.push(lineItem(`${c.modelLabel} cache hit`, null, `−${money(c.saved)}`, { color: PAPER.green }));
		}
		children.push(lineItem('you saved', null, `−${money(model.youSaved)}`, { color: PAPER.green, weight: 700, amountWeight: 700 }));
	} else {
		children.push(lineItem('cache discounts', null, money(0), { color: PAPER.muted }));
	}

	// ── Cache is BILLED (preserved v1.6.0 section, dashed-rule idiom) ─────────
	children.push(dashedRule());
	children.push(centerLine('cache — billed, not free', { size: SIZE_SEC, color: PAPER.muted, letterSpacing: ls(10, 0.12), uppercase: true, marginTop: px(2) }));
	children.push(lineItem('cache reads (billed)', null, money(model.cacheCost.cacheReadCost)));
	children.push(lineItem('cache writes (billed)', null, money(model.cacheCost.cacheWriteCost)));

	// ── Subtotals ────────────────────────────────────────────────────────────
	if (model.subtotals.length > 0) {
		children.push(dashedRule());
		for (const s of model.subtotals) {
			const fam = s.family.charAt(0).toUpperCase() + s.family.slice(1);
			children.push(lineItem(`subtotal ${fam}`, null, money(s.cost), { color: PAPER.muted }));
		}
	}

	// ── Total burn (solid-ish dashed rule, then the 800-weight uppercase total) ─
	children.push(dashedRule());
	children.push(
		lineItem('total burn', null, money(model.totalBurn), {
			color: PAPER.ink,
			weight: 800,
			amountWeight: 800,
			size: SIZE_TOTAL,
			uppercase: true
		})
	);
	if (model.costUnknownRequests > 0) {
		children.push(centerLine(`(${int(model.costUnknownRequests)} req with unknown pricing)`, { size: SIZE_SUB, color: PAPER.muted, marginTop: px(2) }));
	}

	// ── Subsidisation footer (preserved v1.6.0 section) ──────────────────────
	if (model.subsidisation) {
		const s = model.subsidisation;
		children.push(dashedRule());
		children.push(centerLine('subscription subsidy', { size: SIZE_SEC, color: PAPER.muted, letterSpacing: ls(10, 0.12), uppercase: true, marginTop: px(2) }));
		if (s.monthBasis) {
			// "∞" (U+221E) is tofu in the latin mono subset → spell it.
			const mult = s.multiple == null ? 'all of it' : `${s.multiple >= 100 ? Math.round(s.multiple) : s.multiple.toFixed(1)}×`;
			children.push(lineItem(`${s.periodLabel} multiple`, null, mult, { weight: 700, amountWeight: 700, color: PAPER.ink }));
			children.push(lineItem(`${money(s.apiEquivalentUsd)} value`, null, `for ${money(s.monthlyUsd)} fee`, { color: PAPER.muted }));
			children.push(
				s.netSubsidyUsd >= 0
					? lineItem('net subsidy', null, `+${money(s.netSubsidyUsd)}`, { color: PAPER.green })
					: lineItem('under-using your plan', null, money(s.netSubsidyUsd), { color: PAPER.muted })
			);
		} else {
			children.push(lineItem(`${s.periodLabel} value`, null, money(s.apiEquivalentUsd), { color: PAPER.muted }));
			children.push(lineItem('flat monthly fee', null, money(s.monthlyUsd), { color: PAPER.muted }));
		}
	}

	// ── Barcode + REF + footer ────────────────────────────────────────────────
	children.push(barcodeNode());
	children.push(centerLine(`REF ${model.ref}`, { size: SIZE_REF, color: PAPER.muted, letterSpacing: ls(11, 0.1) }));
	if (model.footer) {
		// R13: the design's footer ends with 💸. JetBrains Mono has no emoji glyph
		// (tofu) and no emoji font is embedded, so the wry copy ends with a small
		// gold mark PNG (the R13 fallback ladder's final rung — a mark, not tofu).
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

/** Drop a trailing emoji from canned footer copy (the PNG uses a gold ✦ instead). */
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

/**
 * Render the (already-redacted) receipt model to a cream-paper PNG Buffer.
 *
 * R2 (paper vignette, radial-gradient at <3% alpha) is intentionally omitted —
 * satori can't draw it and the loss is imperceptible at share size.
 *
 * Height auto-sizes from content (width-only satori) so the tape is tight, not an
 * over-tall estimate. R1 perforated edges bracket the tape via pre-rasterised
 * saw-tooth strips.
 */
export async function renderReceiptPng(model: ReceiptModel): Promise<Buffer> {
	const regular = resolveFont('jetbrains-mono-latin-400-normal.woff');
	const bold = resolveFont('jetbrains-mono-latin-700-normal.woff');
	const heavy = resolveFont('jetbrains-mono-latin-800-normal.woff');

	const markDataUri = await svgToPngDataUri(GOLD_MARK_SVG, MARK * 2);
	const arrowDataUri = await svgToPngDataUri(RANGE_ARROW_SVG, px(12) * 2);
	const topEdge = await svgToPngDataUri(perforationSvg(WIDTH, EDGE_H, false), WIDTH);
	const bottomEdge = await svgToPngDataUri(perforationSvg(WIDTH, EDGE_H, true), WIDTH);

	const tape = receiptElement(model, markDataUri, arrowDataUri);

	// Bracket the tape with the saw-tooth edges (R1), on a column the tape's width.
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
