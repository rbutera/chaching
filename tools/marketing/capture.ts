import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { seedFixture, now } from './fixture.ts';

const browser = await chromium.launch({ channel: 'chrome' });
const root = mkdtempSync(join(tmpdir(), 'chaching-capture-'));
seedFixture(root);
const port = 4319;
const server = spawn(process.execPath, ['--require', resolve('tools/marketing/clock.cjs'), 'apps/web/build/index.js'], {
  env: { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), CHACHING_DATABASE_URL: process.env.CHACHING_MARKETING_DATABASE_URL ?? '',
    CHACHING_PACKAGE_ROOT: resolve('dist/chaching'), TZ: 'UTC', LANG: 'en_US.UTF-8', PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
server.stderr.on('data', data => logs += data);
try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(`${url}/api/snapshot`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, logs);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.clock.install({ time: now });
  await page.addInitScript(() => {
    localStorage.setItem('chaching:theme', 'register-dark');
    Math.random = () => 0.5;
  });
  mkdirSync('apps/site/public/shots', { recursive: true });
  for (const [name, width, height] of [['dashboard', 1440, 1000], ['dashboard-corner', 560, 560], ['dashboard-narrow', 390, 700]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await page.getByText('30d', { exact: true }).first().waitFor();
    if (process.env.CHACHING_MARKETING_DATABASE_URL) await page.getByText('Machines', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /latios|\/Users\/rai/);
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(3000);
    await page.screenshot({ path: `apps/site/public/shots/${name}.png`, animations: 'disabled' });
  }
  console.log('Captured the production dashboard at three sizes.');
} finally {
  await browser.close();
  server.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
}
