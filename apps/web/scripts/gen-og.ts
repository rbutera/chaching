import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderPng, pngFromSvg, type RenderNode } from './lib/render.ts';
import { tokens } from '@chaching/shared/brand/tokens';

const root = new URL('../../../', import.meta.url);
const asset = (path: string) => readFile(new URL(path, root));
const logo = pngFromSvg((await asset('packages/shared/src/brand/assets/logo.svg')).toString(), { width: 600 });
const receipt = await asset('apps/site/public/shots/receipt.png');
const node: RenderNode = { type: 'div', props: {
  style: { display: 'flex', width: 1200, height: 630, padding: 56, background: tokens.surfaces.bg.hex, color: tokens.fg.fg.hex, fontFamily: 'Space Grotesk', overflow: 'hidden' },
  children: [
    { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: 740 }, children: [
      { type: 'img', props: { src: `data:image/png;base64,${logo.toString('base64')}`, width: 244, height: 48 } },
      { type: 'div', props: { style: { display: 'flex', fontSize: 74, fontWeight: 700, lineHeight: 1.04, marginTop: 66 }, children: 'Quietly setting money on fire.' } },
      { type: 'div', props: { style: { display: 'flex', fontSize: 26, marginTop: 28, color: tokens.fg.muted.hex }, children: 'A local cash register for your coding agents.' } },
      { type: 'div', props: { style: { display: 'flex', fontSize: 28, marginTop: 34, color: tokens.accent.hex }, children: '$ npx chaching' } }
    ] } },
    { type: 'img', props: { src: `data:image/png;base64,${receipt.toString('base64')}`, width: 300, style: { marginTop: 36, marginLeft: 35, transform: 'rotate(3deg)', objectFit: 'contain', objectPosition: 'top' } } }
  ]
} };
const png = await renderPng(node, { width: 1200, height: 630, fonts: await Promise.all(([400, 700] as const).map(async weight => ({ name: 'Space Grotesk', weight, style: 'normal' as const, data: await asset(`packages/receipt/assets/fonts/space-grotesk-latin-${weight}-normal.woff`) }))) });
await writeFile(fileURLToPath(new URL('../static/og.png', import.meta.url)), png);
console.log(`Generated production-receipt social card (${png.length} bytes).`);
