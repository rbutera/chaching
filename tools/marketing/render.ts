import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runOnce } from '../../packages/core/src/engine.ts';
import { accountFeesByProvider } from '../../packages/shared/src/accounts.ts';
import { buildReceipt } from '../../packages/receipt/src/receipt/build.ts';
import { renderReceiptPng } from '../../packages/receipt/src/receipt/render-png.ts';
import { buildWrapped } from '../../packages/receipt/src/wrapped/build.ts';
import { renderWrappedPng } from '../../packages/receipt/src/wrapped/render-png.ts';
import { seedFixture, now, month } from './fixture.ts';

const root = mkdtempSync(join(tmpdir(), 'chaching-marketing-'));
try {
  const config = seedFixture(root);
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  process.env.CHACHING_DATABASE_URL = process.env.CHACHING_MARKETING_DATABASE_URL ?? '';
  const snapshot = await runOnce(config, () => now);
  const common = { now, account: 'dev@studio', subscription: accountFeesByProvider(config), footer: 'thank you for your financial sacrifice.' };
  const receipt = buildReceipt(snapshot, { ...common, range: { from: '2026-08-01', to: '2026-08-31' } });
  const wrapped = buildWrapped(snapshot, { ...common, month });
  assert.ok(wrapped.headline.cost > 0);
  assert.equal(receipt.totalBurn, wrapped.headline.cost);
  const output = resolve('apps/site/public/shots');
  mkdirSync(output, { recursive: true });
  const assets = { assetRoot: resolve('packages/receipt/assets') };
  writeFileSync(join(output, 'receipt.png'), await renderReceiptPng(receipt, assets));
  writeFileSync(join(output, 'wrapped.png'), await renderWrappedPng(wrapped, assets));
  writeFileSync(join(root, 'snapshot.json'), JSON.stringify(snapshot));
  console.log(JSON.stringify({ cost: wrapped.headline.cost, receiptTotal: receipt.totalBurn, root }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
