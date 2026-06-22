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
	height: number;
	fonts: RenderFont[];
}

/**
 * Element tree → PNG Buffer, lazy-loading satori + @resvg/resvg-js at call time.
 * Throws a recognisable error (containing the dep name) when they're absent, so
 * the CLI can print the friendly "install the renderer" message and exit non-zero.
 */
export async function renderPng(node: RenderNode, opts: RenderOptions): Promise<Buffer> {
	const { default: satori } = await import('satori');
	const { Resvg } = await import('@resvg/resvg-js');

	const svg = await satori(node as unknown as ReactNode, {
		width: opts.width,
		height: opts.height,
		fonts: opts.fonts.map((f) => ({
			name: f.name,
			data: f.data,
			weight: f.weight ?? 400,
			style: f.style ?? 'normal'
		}))
	});

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: opts.width } });
	return resvg.render().asPng();
}
