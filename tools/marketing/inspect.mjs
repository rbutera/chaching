import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.SITE_URL || 'http://127.0.0.1:4320';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  mkdirSync('apps/site/.impeccable/review', { recursive: true });
  for (const width of [1440, 390, 1280, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.locator('video').evaluate(async video => {
      await video.play();
      await new Promise(resolve => video.requestVideoFrameCallback(resolve));
      video.pause();
    });
    assert.ok(await page.locator('video').evaluate(video => video.readyState >= 2), 'Video decoded a frame');
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Overflow at ${width}px`);
    if (width === 1440 || width === 390) await page.screenshot({ path: `apps/site/.impeccable/review/${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true });
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedCommand = text; } } }));
  await page.locator('[data-copy]').first().click();
  assert.equal(await page.evaluate(() => window.copiedCommand), 'npx chaching');
  assert.match(await page.locator('[role=status]').textContent(), /Copied/);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.locator('[data-copy]').last().click();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'npx chaching');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('video').isVisible(), false);
  assert.equal(await page.locator('.motion-fallback').isVisible(), true);
  for (const route of ['/docs/', '/docs/commands/', '/docs/configuration/', '/docs/sync/', '/changelog/', '/licence/']) {
    const response = await page.goto(base + route);
    assert.equal(response.status(), 200, route);
    assert.equal(await page.locator('main h1').count(), 1, route);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320, route);
    for (const id of await page.locator('main a[href^="#"]').evaluateAll(links => links.map(link => link.hash.slice(1)))) assert.ok(await page.evaluate(id => !!document.getElementById(id), id), `Missing anchor ${id}`);
    for (const href of await page.locator('main a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
      assert.equal((await page.request.get(base + href)).status(), 200, href);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Site checks passed: four widths, six document routes, local links, images, copy success/fallback, reduced motion, and browser errors.');
} finally { await browser.close(); }
