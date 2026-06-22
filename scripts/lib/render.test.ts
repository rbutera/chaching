/**
 * Render-pipeline smoke tests for the shared satori → resvg PNG path
 * (src/lib/brand/render.ts). The sibling `chaching-receipt` change reuses this
 * surface, so we assert the contract here:
 *
 *  - svgFromElement turns a flexbox element tree + a real font into a non-empty
 *    SVG at the requested size.
 *  - renderPng produces a valid PNG Buffer (PNG magic bytes) at the requested
 *    width.
 *
 * Fonts are loaded as Buffers from @fontsource/inter (a devDep) — satori needs
 * real font bytes, with no system-font fallback.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { svgFromElement, renderPng, type RenderNode, type RenderFont } from './render.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fontPath = join(here, '..', '..', '..', 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-400-normal.woff');

async function inter(): Promise<RenderFont> {
	const data = await readFile(fontPath);
	return { name: 'Inter', data, weight: 400, style: 'normal' };
}

const node: RenderNode = {
	type: 'div',
	props: {
		style: {
			display: 'flex',
			width: '200px',
			height: '100px',
			background: '#0a0b0f',
			color: '#e0a52f',
			fontFamily: 'Inter'
		},
		children: 'chaching'
	}
};

describe('render', () => {
	it('svgFromElement renders a non-empty SVG at the requested size', async () => {
		const svg = await svgFromElement(node, { width: 200, height: 100, fonts: [await inter()] });
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('width="200"');
		expect(svg).toContain('height="100"');
	});

	it('renderPng produces a valid PNG Buffer', async () => {
		const png = await renderPng(node, { width: 200, height: 100, fonts: [await inter()] });
		expect(png.length).toBeGreaterThan(0);
		// PNG magic: 89 50 4E 47 ("‰PNG").
		expect(png.subarray(0, 4).toString('binary')).toBe('\x89PNG');
	});
});
