// renderReceiptPng — the runtime PNG receipt template.
//
// Builds a satori element tree from the (already-redacted) ReceiptModel, in the
// brand tokens (brass accent on dark surface), and rasterises it via the RUNTIME
// pipeline (png-pipeline.ts → lazy satori + resvg). The font is the vendored
// JetBrains Mono woff shipped in static/fonts/ (resolved by walking up from this
// module so it works from any cwd and from the bundled dist/cli layout).
//
// The model handed in is ALREADY redacted by the caller — this template renders
// it verbatim and adds no env-derived strings, so the PNG can never leak the
// machine name / username / paths.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokens } from '../../lib/brand/tokens.js';
import { money, compactTokens, providerLabel, int } from '../../lib/format.js';
import { renderPng, type RenderNode } from './png-pipeline.js';
import type { ReceiptModel } from './model.js';

const WIDTH = 720;
const PAD = 48;

const BG = tokens.surfaces.bg.hex;
const SURFACE = tokens.surfaces.surface1.hex;
const BORDER = tokens.surfaces.border.hex;
const ACCENT = tokens.accent.hex; // brass #e0a52f
const FG = tokens.fg.fg.hex;
const MUTED = tokens.fg.muted.hex;
const DIM = tokens.fg.dim.hex;
const GOOD = tokens.status.good.hex;

function h(type: string, props: RenderNode['props']): RenderNode {
	return { type, props };
}

/** Resolve the vendored mono font, walking up from this module to static/fonts/. */
function resolveFont(name: string): Buffer {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, 'static', 'fonts', name);
		if (existsSync(candidate)) return readFileSync(candidate);
		// also try build/client/fonts (adapter-node copies static → build/client)
		const built = join(dir, 'build', 'client', 'fonts', name);
		if (existsSync(built)) return readFileSync(built);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// last resort: cwd-relative
	const cwdCandidate = join(process.cwd(), 'static', 'fonts', name);
	if (existsSync(cwdCandidate)) return readFileSync(cwdCandidate);
	throw new Error(`receipt PNG: mono font not found (${name})`);
}

/** label/value row, value right-aligned via space-between. */
function pngRow(label: RenderNode | string, value: string, opts: { color?: string; bold?: boolean; size?: number } = {}): RenderNode {
	const size = opts.size ?? 22;
	return h('div', {
		style: {
			display: 'flex',
			justifyContent: 'space-between',
			alignItems: 'baseline',
			width: '100%',
			marginBottom: '6px'
		},
		children: [
			typeof label === 'string'
				? h('div', { style: { display: 'flex', fontSize: `${size}px`, color: opts.color ?? FG, fontWeight: opts.bold ? 700 : 400 }, children: label })
				: label,
			h('div', { style: { display: 'flex', fontSize: `${size}px`, color: opts.color ?? FG, fontWeight: opts.bold ? 700 : 400 }, children: value })
		]
	});
}

function ruleNode(color = ACCENT): RenderNode {
	return h('div', {
		style: { display: 'flex', width: '100%', height: '2px', background: color, marginTop: '14px', marginBottom: '14px' }
	});
}

function dashRuleNode(): RenderNode {
	return h('div', {
		style: { display: 'flex', width: '100%', height: '1px', background: BORDER, marginTop: '12px', marginBottom: '12px' }
	});
}

function centre(text: string, opts: { size?: number; color?: string; bold?: boolean } = {}): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			justifyContent: 'center',
			width: '100%',
			fontSize: `${opts.size ?? 22}px`,
			color: opts.color ?? FG,
			fontWeight: opts.bold ? 700 : 400,
			marginBottom: '4px'
		},
		children: text
	});
}

function receiptElement(model: ReceiptModel): RenderNode {
	const children: RenderNode[] = [];

	// Header
	children.push(ruleNode());
	children.push(centre('chaching', { size: 40, color: ACCENT, bold: true }));
	children.push(centre('AI token spend register', { size: 18, color: MUTED }));
	const range =
		model.from && model.to
			? model.from === model.to
				? model.from
				: `${model.from} → ${model.to}`
			: model.periodLabel;
	children.push(centre(`${model.periodLabel}  ·  ${range}`, { size: 18, color: DIM }));
	if (model.providers && model.providers.length > 0) {
		children.push(centre(`providers: ${model.providers.join(', ')}`, { size: 16, color: DIM }));
	}
	children.push(ruleNode());

	if (model.empty) {
		children.push(centre('no receipts yet.', { size: 22, color: MUTED }));
		children.push(centre('run `chaching init` to start.', { size: 18, color: DIM }));
		children.push(ruleNode());
		children.push(centre(`REF ${model.ref}`, { size: 16, color: DIM }));
		children.push(centre(model.barcode, { size: 24, color: FG }));
		return wrap(children);
	}

	// Line items, grouped by provider
	let lastProvider: string | null = null;
	for (const it of model.lineItems) {
		if (it.provider !== lastProvider) {
			children.push(
				h('div', {
					style: { display: 'flex', fontSize: '16px', color: DIM, marginTop: '10px', marginBottom: '4px', letterSpacing: '0.08em' },
					children: providerLabel(it.provider).toUpperCase()
				})
			);
			lastProvider = it.provider;
		}
		const note = it.unknownPrice ? ' (price?)' : '';
		children.push(pngRow(`  ${it.modelLabel}${note}`, money(it.cost)));
		const toks = compactTokens(it.tokens.input + it.tokens.output + it.tokens.cacheCreation + it.tokens.cacheRead);
		children.push(
			h('div', { style: { display: 'flex', fontSize: '15px', color: DIM, marginBottom: '8px' }, children: `    ${toks} tok · ${int(it.requests)} req` })
		);
	}

	// Coupons
	children.push(dashRuleNode());
	if (model.coupons.length > 0) {
		children.push(h('div', { style: { display: 'flex', fontSize: '18px', color: ACCENT, marginBottom: '6px' }, children: '✁ COUPONS — CACHE DISCOUNTS' }));
		for (const c of model.coupons) {
			children.push(pngRow(`  ${c.modelLabel} cache hit`, `-${money(c.saved)}`, { color: GOOD }));
		}
		children.push(pngRow('YOU SAVED', `-${money(model.youSaved)}`, { bold: true, color: GOOD }));
	} else {
		children.push(pngRow('CACHE DISCOUNTS', money(0), { color: DIM }));
	}

	// Cache is BILLED — explicit billed read/write cost (the "cache isn't free" reframe).
	children.push(dashRuleNode());
	children.push(h('div', { style: { display: 'flex', fontSize: '18px', color: ACCENT, marginBottom: '6px' }, children: '⌁ CACHE — BILLED, NOT FREE' }));
	children.push(pngRow('  cache reads (billed)', money(model.cacheCost.cacheReadCost), { color: MUTED }));
	children.push(pngRow('  cache writes (billed)', money(model.cacheCost.cacheWriteCost), { color: MUTED }));

	// Subtotals
	if (model.subtotals.length > 0) {
		children.push(dashRuleNode());
		for (const s of model.subtotals) {
			const fam = s.family.charAt(0).toUpperCase() + s.family.slice(1);
			children.push(pngRow(`subtotal ${fam}`, money(s.cost), { color: MUTED, size: 18 }));
		}
	}

	// Total
	children.push(ruleNode());
	children.push(pngRow('TOTAL BURN', money(model.totalBurn), { bold: true, color: ACCENT, size: 30 }));
	children.push(
		h('div', { style: { display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '15px', color: DIM }, children: [
			h('div', { style: { display: 'flex' }, children: `${compactTokens(model.totalTokens)} tokens` }),
			h('div', { style: { display: 'flex' }, children: `${int(model.requests)} req` })
		] })
	);
	if (model.costUnknownRequests > 0) {
		children.push(h('div', { style: { display: 'flex', fontSize: '14px', color: DIM, marginTop: '4px' }, children: `(${int(model.costUnknownRequests)} req with unknown pricing)` }));
	}
	children.push(ruleNode());

	// Subsidisation footer (flat-fee value framing).
	if (model.subsidisation) {
		const s = model.subsidisation;
		children.push(h('div', { style: { display: 'flex', fontSize: '18px', color: ACCENT, marginTop: '8px', marginBottom: '6px' }, children: '✦ SUBSCRIPTION SUBSIDY' }));
		if (s.monthBasis) {
			const mult = s.multiple == null ? '∞ — all of it' : `${s.multiple >= 100 ? Math.round(s.multiple) : s.multiple.toFixed(1)}×`;
			children.push(pngRow(`${s.periodLabel} multiple`, mult, { bold: true, color: ACCENT, size: 24 }));
			children.push(pngRow(`${money(s.apiEquivalentUsd)} value`, `for ${money(s.monthlyUsd)} fee`, { color: DIM, size: 16 }));
			children.push(
				s.netSubsidyUsd >= 0
					? pngRow('net subsidy', `+${money(s.netSubsidyUsd)}`, { color: GOOD })
					: pngRow('under-using your plan', money(s.netSubsidyUsd), { color: DIM })
			);
		} else {
			children.push(pngRow(`${s.periodLabel} value`, money(s.apiEquivalentUsd), { color: MUTED }));
			children.push(pngRow('flat monthly fee', money(s.monthlyUsd), { color: DIM, size: 16 }));
		}
		children.push(ruleNode());
	}

	if (model.footer) {
		children.push(centre(model.footer, { size: 16, color: DIM }));
	}
	children.push(centre(`REF ${model.ref}`, { size: 15, color: DIM }));
	children.push(centre(model.barcode, { size: 26, color: FG }));

	return wrap(children);
}

function wrap(children: RenderNode[]): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			flexDirection: 'column',
			width: `${WIDTH}px`,
			background: BG,
			padding: `${PAD}px`,
			fontFamily: 'JetBrains Mono'
		},
		children: [
			h('div', {
				style: {
					display: 'flex',
					flexDirection: 'column',
					width: '100%',
					background: SURFACE,
					border: `1px solid ${BORDER}`,
					borderRadius: '8px',
					padding: '32px'
				},
				children
			})
		]
	});
}

/**
 * Render the (already-redacted) receipt model to a PNG Buffer. Height is auto
 * (satori grows the canvas to fit when only width is fixed via a tall bound).
 */
export async function renderReceiptPng(model: ReceiptModel): Promise<Buffer> {
	const regular = resolveFont('jetbrains-mono-latin-400-normal.woff');
	const bold = resolveFont('jetbrains-mono-latin-700-normal.woff');

	// satori requires a fixed height; pick a generous bound and let content flow.
	// Over-tall canvas is fine — resvg trims to the rendered SVG viewport which
	// satori sizes to the fixed width/height. We estimate height from item count.
	const estHeight =
		320 +
		model.lineItems.length * 56 +
		model.coupons.length * 34 +
		model.subtotals.length * 30 +
		(model.empty ? 120 : 0);

	return renderPng(receiptElement(model), {
		width: WIDTH,
		height: Math.max(480, estHeight),
		fonts: [
			{ name: 'JetBrains Mono', data: regular, weight: 400, style: 'normal' },
			{ name: 'JetBrains Mono', data: bold, weight: 700, style: 'normal' }
		]
	});
}
