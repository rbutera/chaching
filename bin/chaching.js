#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

process.env.CHACHING_PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const firstArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
await import('../cli/index.js');
// Ink leaves stdin open after one-shot commands.
if (firstArg !== 'serve' && firstArg !== 'mcp') process.exit(0);
