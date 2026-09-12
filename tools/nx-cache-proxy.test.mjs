import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';

test('cache proxy round-trips artifacts and preserves existing entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaching-cache-test-'));
  const child = spawn(process.execPath, ['tools/nx-cache-proxy.mjs'], {
    env: { ...process.env, NX_CACHE_PROXY_PORT: '0', NX_CACHE_PROXY_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const [output] = await once(child.stdout, 'data');
    const port = String(output).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port && port !== '0', 'proxy reports its listening port');
    const url = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/v1/cache/missing`)).status, 404);
    assert.equal((await fetch(`${url}/v1/cache/example`, { method: 'PUT', body: 'artifact' })).status, 201);
    assert.equal((await fetch(`${url}/v1/cache/example`, { method: 'PUT', body: 'replacement' })).status, 200);
    assert.equal(await (await fetch(`${url}/v1/cache/example`)).text(), 'artifact');
  } finally {
    child.kill();
    await once(child, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
