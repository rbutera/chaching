// Build-time favicon / PWA asset generator.
//
// Reads static/icon.svg (the brass Till Stack mark) and emits, to static/:
//   - favicon.ico         32×32 (legacy fallback; modern browsers prefer the svg)
//   - apple-touch-icon.png 180×180 on the brand dark bg with safe padding
//   - icon-192.png         192×192 maskable (PWA)
//   - icon-512.png         512×512 maskable (PWA)
//   - manifest.webmanifest the web app manifest referencing the above
//
// All raster output is generated, committed to static/, and served as static
// files — it never enters the runtime JS bundle. Run via `npm run gen:assets`.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');

// Brand dark background (tokens.surfaces.bg). iOS does not honour transparency
// on the apple-touch-icon, so it is composited onto this.
const BG = '#0a0b0f';

/** Render the icon SVG onto a square transparent canvas at `size`. */
async function renderMark(svg: Buffer, size: number, padding: number): Promise<Buffer> {
	const inner = Math.round(size * (1 - padding * 2));
	const mark = await sharp(svg, { density: 384 })
		.resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	return sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
		.composite([{ input: mark, gravity: 'center' }])
		.png()
		.toBuffer();
}

/**
 * Wrap a single square PNG in a minimal .ico container. The ICO format permits a
 * PNG payload per entry (supported by all modern browsers), so no BMP encoding is
 * needed — just the 6-byte ICONDIR + 16-byte ICONDIRENTRY header.
 */
function pngToIco(png: Buffer, size: number): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: 1 = icon
	header.writeUInt16LE(1, 4); // image count

	const entry = Buffer.alloc(16);
	entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 ⇒ 256)
	entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
	entry.writeUInt8(0, 2); // palette
	entry.writeUInt8(0, 3); // reserved
	entry.writeUInt16LE(1, 4); // color planes
	entry.writeUInt16LE(32, 6); // bits per pixel
	entry.writeUInt32LE(png.length, 8); // payload size
	entry.writeUInt32LE(6 + 16, 12); // payload offset

	return Buffer.concat([header, entry, png]);
}

/** Render the mark onto an opaque brand-dark square (for apple-touch / maskable). */
async function renderOnBg(svg: Buffer, size: number, padding: number): Promise<Buffer> {
	const mark = await renderMark(svg, size, padding);
	return sharp({
		create: { width: size, height: size, channels: 4, background: BG }
	})
		.composite([{ input: mark, gravity: 'center' }])
		.png()
		.toBuffer();
}

async function main() {
	const iconPath = join(staticDir, 'icon.svg');
	const svg = await readFile(iconPath);

	// favicon.ico — 32×32, on the brand dark bg (legacy contexts ignore alpha).
	const ico32 = await renderOnBg(svg, 32, 0.06);
	await writeFile(join(staticDir, 'favicon.ico'), pngToIco(ico32, 32));

	// apple-touch-icon — 180×180 opaque on brand dark, safe padding.
	await writeFile(join(staticDir, 'apple-touch-icon.png'), await renderOnBg(svg, 180, 0.16));

	// Maskable PWA pair — opaque, generous padding for the safe zone.
	await writeFile(join(staticDir, 'icon-192.png'), await renderOnBg(svg, 192, 0.2));
	await writeFile(join(staticDir, 'icon-512.png'), await renderOnBg(svg, 512, 0.2));

	const manifest = {
		name: 'chaching',
		short_name: 'chaching',
		description: 'Local, multi-provider AI token spend — Claude Code, Codex, OpenCode, Cursor.',
		theme_color: BG,
		background_color: BG,
		display: 'standalone',
		icons: [
			{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
			{ src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'maskable' },
			{ src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' }
		]
	};
	await writeFile(join(staticDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, '\t') + '\n');

	console.log('[gen-favicons] wrote favicon.ico, apple-touch-icon.png, icon-192/512.png, manifest.webmanifest');
}

main().catch((err) => {
	console.error('[gen-favicons] failed:', err);
	process.exit(1);
});
