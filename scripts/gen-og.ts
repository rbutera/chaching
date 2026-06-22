// Build-time social card generator. Composes the OG element tree (dark brand
// bg, the Till Stack mark, the wordmark, the honest tagline, a tasteful
// faux-dashboard strip in brand-token colours) and writes static/og.png
// (1200×630) via the shared render pipeline (satori → resvg).
//
// satori constraints: flexbox-only layout, inline styles only, fonts as Buffers.
// Run via `npm run gen:assets`.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPng, type RenderNode } from '../src/lib/brand/render.ts';
import { tokens } from '../src/lib/brand/tokens.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const WIDTH = 1200;
const HEIGHT = 630;

const BG = tokens.surfaces.bg.hex; // #0a0b0f
const SURFACE = tokens.surfaces.surface1.hex;
const BORDER = tokens.surfaces.border.hex;
const ACCENT = tokens.accent.hex; // brass #e0a52f
const FG = tokens.fg.fg.hex;
const MUTED = tokens.fg.muted.hex;
const DIM = tokens.fg.dim.hex;

/** Tiny helper to build a satori node without JSX. */
function h(type: string, props: RenderNode['props']): RenderNode {
	return { type, props };
}

/** The Till Stack mark as an inline svg node, in the brand accent. */
function mark(size: number): RenderNode {
	return h('svg', {
		width: size,
		height: size,
		viewBox: '0 0 24 24',
		fill: ACCENT,
		children: [
			h('path', {
				'fill-rule': 'evenodd',
				d: 'M12 1.5 22 6.1 12 10.7 2 6.1ZM9.2 5.35h5.6v1.5H9.2Z'
			}),
			h('path', { d: 'm2 10.35 10 4.6 10-4.6v3.2l-10 4.6-10-4.6Z' }),
			h('path', { d: 'm2 16.15 10 4.6 10-4.6v3.2L12 23.95 2 19.35Z' })
		]
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

function ogElement(): RenderNode {
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
			// Brand lockup row
			h('div', {
				style: { display: 'flex', alignItems: 'center' },
				children: [
					mark(72),
					h('div', {
						style: {
							display: 'flex',
							fontSize: '64px',
							fontWeight: 600,
							color: FG,
							marginLeft: '20px',
							letterSpacing: '-0.02em'
						},
						children: 'chaching'
					})
				]
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

	const png = await renderPng(ogElement(), {
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
