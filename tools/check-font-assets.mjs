import { accessSync } from 'node:fs';
for (const family of ['jetbrains-mono', 'space-grotesk']) {
 for (const weight of [400, 700]) accessSync(new URL(`../packages/receipt/assets/fonts/${family}-latin-${weight}-normal.woff`, import.meta.url));
}
