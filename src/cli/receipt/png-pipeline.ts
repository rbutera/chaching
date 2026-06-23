// Runtime satori→SVG→resvg→PNG pipeline for `chaching receipt --png`.
//
// IMPORTANT — build-time vs runtime split:
//   - scripts/lib/render.ts is the BUILD-TIME renderer (gen-og), STATICALLY
//     importing satori + @resvg/resvg-js. It ships NOWHERE (devDependencies only)
//     and must never enter the SvelteKit client/server bundle.
//   - THIS module is the RUNTIME renderer for the CLI. It lives under src/cli/ so
//     only the tsup CLI bundle ever imports it (the SvelteKit graph never does),
//     and it LAZY-imports satori + @resvg/resvg-js (optionalDependencies) so the
//     base install stays lean and the native binding isn't forced on every user.
//
// The node shape + the public surface mirror scripts/lib/render.ts on purpose,
// so a receipt template authored against one works against the other.

import type { ReactNode } from 'react';

/** A satori-compatible plain-object element node (no JSX/React runtime needed). */
export interface RenderNode {
	type: string;
	props: {
		style?: Record<string, string | number>;
		children?: RenderChild;
		[key: string]: unknown;
	};
}

export type RenderChild = RenderNode | string | number | RenderChild[] | null | undefined;

export interface RenderFont {
	name: string;
	data: Buffer | ArrayBuffer;
	weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
	style?: 'normal' | 'italic';
}

export interface RenderOptions {
	width: number;
	/**
	 * Optional fixed height. When omitted, satori auto-calculates height from
	 * content (width-only mode) — this is how the receipt tape renders to a tight,
	 * pixel-faithful canvas instead of an over-tall estimate with trailing paper.
	 */
	height?: number;
	fonts: RenderFont[];
}

/**
 * Element tree → PNG Buffer, lazy-loading satori + @resvg/resvg-js at call time.
 * Throws a recognisable error (containing the dep name) when they're absent, so
 * the CLI can print the friendly "install the renderer" message and exit non-zero.
 *
 * Height-handling: when `opts.height` is omitted, satori is given width only and
 * auto-sizes the height to the content (the receipt's natural length); the PNG is
 * then rasterised at the requested width (resvg keeps the satori canvas ratio).
 */
export async function renderPng(node: RenderNode, opts: RenderOptions): Promise<Buffer> {
	const { default: satori } = await import('satori');
	const { Resvg } = await import('@resvg/resvg-js');

	const satoriOpts: {
		width: number;
		height?: number;
		fonts: { name: string; data: Buffer | ArrayBuffer; weight: number; style: 'normal' | 'italic' }[];
	} = {
		width: opts.width,
		fonts: opts.fonts.map((f) => ({
			name: f.name,
			data: f.data,
			weight: f.weight ?? 400,
			style: f.style ?? 'normal'
		}))
	};
	if (opts.height != null) satoriOpts.height = opts.height;

	const svg = await satori(node as unknown as ReactNode, satoriOpts as never);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: opts.width } });
	return resvg.render().asPng();
}

/**
 * Rasterise a raw SVG string to a base64 PNG data-URI, lazy-loading resvg.
 *
 * Load-bearing for embedding SVG marks: satori embeds an `<svg>` data-URI as an
 * `<image href="data:image/svg+xml…">`, but @resvg/resvg-js does NOT render a
 * nested SVG-in-`<image>` (it comes out BLANK). A PNG data-URI rasterises
 * correctly, so we resvg the mark to a crisp PNG first, then hand THAT to satori
 * as an `<img src="data:image/png;base64,…">`. (Mirrors scripts/gen-og.ts.)
 */
export async function svgToPngDataUri(svg: string, width: number): Promise<string> {
	const { Resvg } = await import('@resvg/resvg-js');
	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
	const png = resvg.render().asPng();
	return `data:image/png;base64,${png.toString('base64')}`;
}
