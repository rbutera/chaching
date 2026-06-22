// Shared PNG render pipeline: satori (element tree → SVG) + @resvg/resvg-js
// (SVG → PNG). This is the canonical brand raster pipeline; the sibling
// `chaching-receipt` change reuses it, so the surface is kept small and generic.
//
// Constraints inherited from satori: flexbox-only layout, inline styles only,
// real font bytes passed as Buffers (no system-font fallback). It lives under
// `scripts/lib/` — NOT under `$lib` — so it can only be imported from Node-side
// scripts, never the SvelteKit client/server graph. That import isolation (not
// just Vite's `ssr.external`) is what keeps the native `@resvg/resvg-js` binding
// out of the browser bundle.

import type { ReactNode } from 'react';
import satori, { type SatoriOptions } from 'satori';
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';

/**
 * A satori-compatible element node. satori accepts a React-element-shaped tree;
 * here we build it with plain objects (no JSX/React runtime needed). `type` is a
 * tag name (`'div'`, `'span'`, `'svg'`, …), `props` carries `style` (inline,
 * flexbox-only) and `children`.
 */
export interface RenderNode {
	type: string;
	props: {
		style?: Record<string, string | number>;
		children?: RenderChild;
		[key: string]: unknown;
	};
}

export type RenderChild = RenderNode | string | number | RenderChild[] | null | undefined;

/** A single embedded font: raw bytes plus the metadata satori needs. */
export interface RenderFont {
	name: string;
	data: Buffer | ArrayBuffer;
	weight?: SatoriOptions['fonts'][number]['weight'];
	style?: SatoriOptions['fonts'][number]['style'];
}

/** Options for {@link svgFromElement} / {@link renderPng}: canvas size + fonts. */
export interface RenderOptions {
	width: number;
	height: number;
	fonts: RenderFont[];
}

/** Render a satori element tree to an SVG string. Flexbox-only, inline styles. */
export async function svgFromElement(node: RenderNode, opts: RenderOptions): Promise<string> {
	return satori(node as unknown as ReactNode, {
		width: opts.width,
		height: opts.height,
		fonts: opts.fonts.map((f) => ({
			name: f.name,
			data: f.data,
			weight: f.weight ?? 400,
			style: f.style ?? 'normal'
		}))
	} satisfies SatoriOptions);
}

/** Rasterise an SVG string to a PNG Buffer at a fixed output width. */
export function pngFromSvg(svg: string, opts?: { width?: number }): Buffer {
	const renderOptions = {
		fitTo: opts?.width ? { mode: 'width', value: opts.width } : { mode: 'original' }
	} satisfies ResvgRenderOptions;
	const resvg = new Resvg(svg, renderOptions);
	return resvg.render().asPng();
}

/** Convenience: element tree → PNG Buffer in one call (satori then resvg). */
export async function renderPng(node: RenderNode, opts: RenderOptions): Promise<Buffer> {
	const svg = await svgFromElement(node, opts);
	return pngFromSvg(svg, { width: opts.width });
}
