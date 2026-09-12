import { cpSync, mkdirSync, rmSync } from 'node:fs';
const source = new URL('../packages/receipt/assets/fonts/', import.meta.url);
const target = new URL('../apps/web/static/fonts/', import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
