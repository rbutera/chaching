import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkManifest } from './freshness.mjs';

test('capture gate accepts current assets and rejects stale sources or changed outputs', () => {
  const manifest = JSON.parse(readFileSync('tools/marketing/assets.json'));
  checkManifest(manifest);
  assert.throws(() => checkManifest({ ...manifest, inputs: { ...manifest.inputs, 'packages/core/src/engine.ts': 'stale' } }));
  assert.throws(() => checkManifest({ ...manifest, outputs: { ...manifest.outputs, 'receipt.png': 'changed' } }));
});
