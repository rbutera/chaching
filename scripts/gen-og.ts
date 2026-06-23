// Build-time social card generator. Composes the OG element tree (dark brand
// bg, the full "Chaching!" lockup, the honest tagline, a tasteful faux-dashboard
// strip in brand-token colours) and writes static/og.png (1200×630) via the
// shared render pipeline (satori → resvg).
//
// satori constraints: flexbox-only layout, inline styles only, fonts as Buffers.
// The brand lockup is embedded as a base64 data-URI <img> sourced verbatim from
// static/logo.svg, so the OG card can never drift from the canonical wordmark.
// Run via `npm run gen:assets`.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPng, pngFromSvg, type RenderNode } from './lib/render.ts';
import { tokens } from '../src/lib/brand/tokens.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const WIDTH = 1200;
const HEIGHT = 630;

const BG = tokens.surfaces.bg.hex; // ink-950 #0e0d0b
const SURFACE = tokens.surfaces.surface1.hex;
const BORDER = tokens.surfaces.border.hex;
const ACCENT = tokens.accent.hex; // brass / register gold #eba92c
const FG = tokens.fg.fg.hex;
const MUTED = tokens.fg.muted.hex;
const DIM = tokens.fg.dim.hex;

// Natural lockup dimensions (viewBox 244×48) → drawn at LOGO_HEIGHT, keeping ratio.
const LOGO_NATURAL_W = 244;
const LOGO_NATURAL_H = 48;
const LOGO_HEIGHT = 76;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * LOGO_NATURAL_W) / LOGO_NATURAL_H);

/** Tiny helper to build a satori node without JSX. */
function h(type: string, props: RenderNode['props']): RenderNode {
	return { type, props };
}

/**
 * The canonical "Chaching!" lockup, embedded as a base64 data-URI <img>. We read
 * static/logo.svg (which already declares `color` = the brass accent, so its
 * `currentColor` paths paint brass) and pre-rasterize it to a PNG via resvg.
 *
 * The pre-rasterize step is load-bearing: satori embeds an SVG data-URI as an
 * `<image href="data:image/svg+xml…">`, but resvg-js does NOT render a nested
 * SVG-in-`<image>` (it comes out blank). A PNG data-URI rasterizes correctly, so
 * we resvg the logo to a crisp 2× PNG first, then hand that to satori.
 */
async function lockupImg(): Promise<RenderNode> {
	const svg = await readFile(join(root, 'static', 'logo.svg'), 'utf8');
	const logoPng = pngFromSvg(svg, { width: LOGO_WIDTH * 2 }); // 2× for crisp downscale
	const dataUri = `data:image/png;base64,${logoPng.toString('base64')}`;
	return h('img', {
		src: dataUri,
		width: LOGO_WIDTH,
		height: LOGO_HEIGHT,
		style: { display: 'flex' }
	});
}

/** A single faux-dashboard stat block (label + figure + accent bar). */
function statBlock(label: string, figure: string, barColor: string, barFrac: number): RenderNode {
	return h('div', {
		style: {
			display: 'flex',
			flexDirection: 'column',
			flex: '1',
			padding: '24px',
			borderRadius: '14px',
			background: SURFACE,
			border: `1px solid ${BORDER}`,
			marginRight: '20px'
		},
		children: [
			h('div', { style: { fontSize: '20px', color: DIM, marginBottom: '12px' }, children: label }),
			h('div', {
				style: { fontSize: '40px', fontWeight: 600, color: FG, marginBottom: '18px' },
				children: figure
			}),
			h('div', {
				style: {
					display: 'flex',
					height: '8px',
					borderRadius: '4px',
					background: '#181b24'
				},
				children: h('div', {
					style: {
						display: 'flex',
						width: `${Math.round(barFrac * 100)}%`,
						borderRadius: '4px',
						background: barColor
					}
				})
			})
		]
	});
}

async function ogElement(): Promise<RenderNode> {
	const lockup = await lockupImg();
	return h('div', {
		style: {
			display: 'flex',
			flexDirection: 'column',
			width: `${WIDTH}px`,
			height: `${HEIGHT}px`,
			background: BG,
			padding: '64px',
			fontFamily: 'Inter'
		},
		children: [
			// Brand lockup row — the canonical "Chaching!" wordmark
			h('div', {
				style: { display: 'flex', alignItems: 'center' },
				children: [lockup]
			}),
			// Honest tagline
			h('div', {
				style: { display: 'flex', fontSize: '34px', color: MUTED, marginTop: '20px' },
				children: 'local AI token spend'
			}),
			h('div', {
				style: { display: 'flex', fontSize: '24px', color: DIM, marginTop: '10px' },
				children: 'Claude Code · Codex · OpenCode · Cursor'
			}),
			// Faux-dashboard strip
			h('div', {
				style: { display: 'flex', marginTop: 'auto', width: '100%' },
				children: [
					statBlock('this month', '$248.10', tokens.providers.claude.hex, 0.82),
					statBlock('tokens', '94.2M', tokens.providers.codex.hex, 0.55),
					statBlock('cache hits', '71%', tokens.status.good.hex, 0.71),
					h('div', {
						style: {
							display: 'flex',
							flexDirection: 'column',
							flex: '1',
							padding: '24px',
							borderRadius: '14px',
							background: SURFACE,
							border: `1px solid ${BORDER}`
						},
						children: [
							h('div', {
								style: { fontSize: '20px', color: DIM, marginBottom: '12px' },
								children: 'today'
							}),
							h('div', {
								style: { fontSize: '40px', fontWeight: 600, color: ACCENT },
								children: '$12.40'
							})
						]
					})
				]
			})
		]
	});
}

async function main() {
	const fontDir = join(root, 'node_modules', '@fontsource', 'inter', 'files');
	const [regular, semibold] = await Promise.all([
		readFile(join(fontDir, 'inter-latin-400-normal.woff')),
		readFile(join(fontDir, 'inter-latin-600-normal.woff'))
	]);

	const png = await renderPng(await ogElement(), {
		width: WIDTH,
		height: HEIGHT,
		fonts: [
			{ name: 'Inter', data: regular, weight: 400, style: 'normal' },
			{ name: 'Inter', data: semibold, weight: 600, style: 'normal' }
		]
	});

	await writeFile(join(root, 'static', 'og.png'), png);
	console.log(`[gen-og] wrote static/og.png (${png.length} bytes, ${WIDTH}×${HEIGHT})`);
}

main().catch((err) => {
	console.error('[gen-og] failed:', err);
	process.exit(1);
});
