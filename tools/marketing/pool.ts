import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PostgresSyncStore, machineScope } from '../../packages/core/src/sync/store.ts';
import { runOnce } from '../../packages/core/src/engine.ts';
import { seedFixture, now } from './fixture.ts';

export const poolId = '10000000-0000-4000-8000-000000000001';
export const studioId = '10000000-0000-4000-8000-000000000002';
const laptopId = '10000000-0000-4000-8000-000000000003';
export async function capturePool() {
  const launched = spawnSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=fictional', '-p', '127.0.0.1::5432', 'postgres:17'], { encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr);
  const container = launched.stdout.trim();
  const root = mkdtempSync(join(tmpdir(), 'chaching-peer-'));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Capture PostgreSQL did not start');
    const address = spawnSync('docker', ['port', container, '5432'], { encoding: 'utf8' }).stdout.trim();
    const databaseUrl = `postgresql://postgres:fictional@${address}/postgres`;
    const store = new PostgresSyncStore(databaseUrl);
    try {
      await store.createPool({ poolId, poolName: 'Personal machines', machineId: studioId, machineName: 'Studio', hostname: 'studio' });
      await store.joinPool({ poolId, machineId: laptopId, machineName: 'Laptop', hostname: 'laptop' });
      const config = seedFixture(root, 0.35);
      for (const account of config.accounts) {
        await store.addAccount({ ...account, account: '' });
        await store.mapAccount(studioId, account.provider, account.id);
        await store.mapAccount(laptopId, account.provider, account.id);
      }
      const snapshot = await runOnce(config, () => now);
      await store.publishDayAggregates({ sourceScope: machineScope(laptopId), machineId: laptopId }, snapshot.dayModel.map(row => ({ ...row,
        cacheCreation1h: 0, cacheCreation5m: row.tokens.cacheCreation, webSearchRequests: 0, webFetchRequests: 0 })));
    } finally { await store.close(); }
    return { databaseUrl, cleanup() { spawnSync('docker', ['stop', container], { stdio: 'ignore' }); rmSync(root, { recursive: true, force: true }); } };
  } catch (error) {
    spawnSync('docker', ['stop', container], { stdio: 'ignore' });
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
