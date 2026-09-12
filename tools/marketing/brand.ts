import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tokens } from '../../packages/shared/src/brand/tokens.ts';
const out = 'apps/site/public';
mkdirSync(`${out}/fonts`, { recursive: true });
for (const name of ['space-grotesk-latin-400-normal.woff2', 'space-grotesk-latin-700-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']) {
  copyFileSync(`packages/receipt/assets/fonts/${name}`, `${out}/fonts/${name}`);
}
copyFileSync('packages/shared/src/brand/assets/logo.svg', `${out}/logo.svg`);
copyFileSync('packages/shared/src/brand/assets/mark.svg', `${out}/icon.svg`);
writeFileSync(`${out}/brand.css`, `:root{--ink:${tokens.surfaces.bg.hex};--paper:${tokens.fg.fg.hex};--muted:${tokens.fg.muted.hex};--brass:${tokens.accent.hex};--line:${tokens.surfaces.borderStrong.hex};--surface:${tokens.surfaces.surface1.hex};--good:${tokens.status.good.hex}}\n`);
