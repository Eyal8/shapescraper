// npm run build, then PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/onboarding.test.cjs
// Uses the existing #shots hooks and a local browser; no native builds or external services.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = pathToFileURL(resolve('www/index.html')).href;
let browser;
const errors = [];
before(async () => {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
});
after(async () => { await browser?.close(); assert.deepEqual(errors, [], 'no page errors'); });
async function fixture(seed = {}, options = {}, shots = true) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
  page.setDefaultTimeout(8000);
  await page.addInitScript(seed => {
    if (!localStorage.getItem('_qa_seed')) {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem('_qa_seed', '1');
    }
  }, { ts_muted: 1, ss_haptics: 0, ...seed });
  await page.goto(url + (shots ? '#shots' : ''));
  if (shots) await page.waitForFunction(() => window.__ts);
  return { page, context };
}
const storage = page => page.evaluate(() => ({ ...localStorage }));
const drop = (page, off) => page.evaluate(off => { __ts.setOff(off); __ts.place(); }, off);
async function learn(page) {
  await page.waitForFunction(() => __ts.tutorialPhase === 'slice');
  await drop(page, 0.8);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'perfect');
  for (let i = 0; i < 3; i++) await drop(page, 0.5); // deliberately outside the normal Perfect tolerance
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'grown');
  const before = await page.evaluate(() => ({ score: __ts.score, area: __ts.topArea, moving: __ts.moving.lvl }));
  await page.waitForFunction(() => __ts.tutorialPhase === null);
  assert.deepEqual(await page.evaluate(() => ({ score: __ts.score, area: __ts.topArea, moving: __ts.moving.lvl })), before, 'handoff retains tower, score and next block');
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.equal(await page.locator('#skipBtn').isHidden(), true);
  assert.equal(await page.evaluate(() => __ts.speed), 4 + before.score * 0.14);
}
async function lose(page) {
  await drop(page, 6.9);
  await page.waitForFunction(() => !document.getElementById('offer').hidden || !document.getElementById('over').hidden);
  if (await page.locator('#offer').isVisible()) await page.locator('#offerNo').click();
}

test('fresh launch: existing skippable intro enters tutorial underneath its fade; returning user reaches menu', async () => {
  const { page, context } = await fixture({}, {}, false);
  await page.waitForSelector('#studioIntro:not([hidden])');
  await page.locator('#studioIntro').dispatchEvent('pointerdown');
  assert.equal(await page.locator('#skipBtn').isVisible(), true);
  assert.equal(await page.locator('#menu').isHidden(), true);
  await page.waitForSelector('#studioIntro[hidden]', { state: 'attached' });
  await page.locator('#skipBtn').click();
  await page.reload();
  assert.equal(await page.locator('#studioIntro').isHidden(), true);
  assert.equal(await page.locator('#menu').isVisible(), true);
  assert.equal(await page.locator('#helpBtn').isVisible(), true);
  await context.close();
});

test('first tutorial becomes one real Square run: normal tolerance, score, unlocks and one-time help reveal', async () => {
  const { page, context } = await fixture();
  await page.evaluate(() => __ts.tutorial(false));
  await learn(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('ss_games')), null, 'no phantom loss');
  const area = await page.evaluate(() => __ts.topArea);
  await drop(page, 0.5);
  assert.ok(await page.evaluate(() => __ts.topArea) < area, 'normal Perfect tolerance restored');
  for (let i = 5; i < 21; i++) await drop(page, 0);
  assert.equal(await page.evaluate(() => __ts.score), 21);
  await lose(page);
  const saved = await storage(page);
  assert.equal(saved.ss_games, '1');
  assert.equal(saved.ss_best_endless_square, '21');
  assert.ok(JSON.parse(saved.ss_unlocked).includes('circle'));
  assert.equal(saved.ss_tut_done, '1');
  assert.equal(saved.ss_help_reveal, '"pending"');
  assert.equal(await page.locator('#helpReveal').isHidden(), true, 'results unobstructed');
  await page.locator('#menuBtn').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('ss_help_reveal')), '"done"');
  await page.waitForFunction(() => document.getElementById('helpBtn').classList.contains('beckon'));
  await page.waitForFunction(() => !document.getElementById('helpBtn').classList.contains('beckon'));
  await page.reload();
  assert.equal(await page.locator('#helpReveal').isHidden(), true);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  assert.equal(await page.locator('#helpTip').count(), 0);
  await context.close();
});

for (const mode of ['endless', 'time', 'daily']) test(`? starts the same Square tutorial from ${mode}; replay and practice-again preserve all storage and restore selection`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 6, ss_best_endless_square: 7, ss_modes_unlocked: ['time', 'daily'], ss_intro_daily: 1, ss_mode2: mode, ss_shape: 'octagon', ss_help_reveal: 'done' });
  const before = await storage(page);
  await page.locator('#helpBtn').click(); // real button; catches the previous ordinary-game regression
  assert.deepEqual(await page.evaluate(() => [__ts.practice, __ts.mode, __ts.runShape]), [true, 'endless', 'square']);
  await page.waitForFunction(() => __ts.coach === 'Tap anywhere to drop');
  await learn(page);
  for (let i = 4; i < 24; i++) await drop(page, 0);
  await lose(page);
  assert.equal(await page.locator('#offer').isHidden(), true);
  assert.equal(await page.locator('#newBest').isHidden(), true);
  assert.equal(await page.locator('#againBtn').textContent(), 'Practice again');
  assert.deepEqual(await storage(page), before);
  await page.locator('#againBtn').click();
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'slice');
  assert.equal(await page.evaluate(() => __ts.practice), true);
  await page.locator('#skipBtn').click();
  assert.deepEqual(await page.evaluate(() => [__ts.mode, __ts.shape, __ts.state]), [mode, 'octagon', 'menu']);
  assert.deepEqual(await storage(page), before);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  assert.equal(await page.locator('#helpReveal').isHidden(), true);
  await context.close();
});

test('early misses recover, Skip cancels pending recovery and completion timers without scores or game counts', async () => {
  const { page, context } = await fixture();
  await page.evaluate(() => __ts.tutorial(false));
  await drop(page, 6.9);
  await page.waitForFunction(() => __ts.state === 'playing');
  assert.equal(await page.evaluate(() => __ts.score), 0);
  assert.equal((await storage(page)).ss_games, undefined);
  await drop(page, 6.9);
  await page.locator('#skipBtn').click();
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  assert.equal((await storage(page)).ss_best_endless_square, undefined);
  assert.equal((await storage(page)).ss_games, undefined);
  assert.equal((await storage(page)).ss_help_reveal, undefined);
  await page.locator('#helpBtn').click();
  await drop(page, 0.8);
  for (let i = 0; i < 3; i++) await drop(page, 0);
  await page.locator('#skipBtn').click();
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  assert.equal(await page.locator('#coach').isHidden(), true);
  await context.close();
});

test('reduced motion consumes the one-time reveal without movement or emphasis', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_help_reveal: 'pending' }, { reducedMotion: 'reduce' });
  assert.equal((await storage(page)).ss_help_reveal, '"done"');
  assert.equal(await page.locator('#helpReveal').isHidden(), true);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  await page.locator('#helpBtn').click();
  await learn(page);
  await lose(page);
  await page.locator('#menuBtn').click();
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  await context.close();
});

test('rapid mode changes retain the quarter-turn targets, actual selected shape and game-start alignment', async () => {
  const { page, context } = await fixture({ ss_games: 10, ss_best_endless_square: 30, ss_intro_daily: 1, ss_shape: 'circle' });
  const changes = ['time', 'daily', 'time', 'endless', 'daily'];
  for (const m of changes) await page.evaluate(m => __ts.setMode(m), m);
  await page.waitForFunction(() => !__ts.rotating);
  assert.ok(Math.abs(await page.evaluate(() => __ts.angle) - Math.PI / 2) < 1e-6);
  assert.equal(await page.evaluate(() => __ts.runShape), await page.locator('#dailyShape').textContent().then(s => s.split(' · ')[0].toLowerCase()));
  for (const m of ['endless', 'time', 'daily']) {
    await page.evaluate(m => __ts.setMode(m), m);
    await page.locator(`[data-page="${m}"] [data-play]`).click();
    await page.waitForFunction(() => !__ts.rotating);
    const angle = await page.evaluate(() => __ts.angle);
    assert.ok(Math.abs(angle / (2 * Math.PI) - Math.round(angle / (2 * Math.PI))) < 1e-6);
    assert.equal(await page.evaluate(() => __ts.state), 'playing');
    if (m !== 'daily') assert.equal(await page.evaluate(() => __ts.runShape), 'circle');
    await page.evaluate(() => __ts.menu());
  }
  await context.close();
});

test('small-screen footer links have 44px targets, open separately, and never start gameplay', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 6 });
  await context.route('https://beno74.com/**', r => r.fulfill({ body: '<title>Link target</title>' }));
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 402, height: 874 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => document.fonts.ready);
    for (const link of await page.locator('.menu-footer a').all()) {
      const b = await link.boundingBox();
      assert.ok(b.height >= 44 && b.x >= 0 && b.y >= 0 && b.x + b.width <= size.width && b.y + b.height <= size.height);
      const popupPromise = page.waitForEvent('popup');
      await link.click();
      const popup = await popupPromise;
      await popup.waitForURL('https://beno74.com/**');
      assert.equal(popup.url(), await link.getAttribute('href') === 'https://beno74.com' ? 'https://beno74.com/' : await link.getAttribute('href'));
      await popup.close();
      assert.equal(await page.evaluate(() => __ts.state), 'menu');
    }
  }
  const link = page.getByRole('link', { name: 'Privacy Policy', exact: true });
  await link.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  await (await popupPromise).close();
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  assert.equal(await page.locator('#helpTip').count(), 0);
  await context.close();
});
