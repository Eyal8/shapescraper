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
async function fixture(seed = {}, options = {}, shots = true, native = null, clockTime = null) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, ...options });
  const page = await context.newPage();
  if (clockTime) await page.clock.install({ time: clockTime });
  page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
  page.setDefaultTimeout(8000);
  await page.addInitScript(seed => {
    if (!localStorage.getItem('_qa_seed')) {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem('_qa_seed', '1');
    }
  }, { ts_muted: 1, ss_haptics: 0, ...seed });
  if (native) await page.addInitScript(config => {
    // Exercise the real Capacitor JS facade with a controlled native transport, not real SDK UI.
    window.__nativeCalls = [];
    window.__setupMessages = [];
    document.addEventListener('DOMContentLoaded', () => {
      const setup = document.getElementById('privacySetup');
      new MutationObserver(() => { if (!setup.hidden) __setupMessages.push(setup.textContent); }).observe(setup, { attributes: true, childList: true });
    });
    const pending = {};
    const listeners = {};
    window.__resolveNative = (key, value) => pending[key](value);
    const info = { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true, privacyOptionsRequirementStatus: 'REQUIRED' };
    window.CapacitorCustomPlatform = { name: config.platform || 'ios' };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'AdMob', methods: [...['requestConsentInfo', 'showConsentForm', 'showPrivacyOptionsForm', 'initialize', 'prepareRewardVideoAd', 'prepareInterstitial', 'showRewardVideoAd', 'removeListener'].map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] },
        { name: 'NativePurchases', methods: ['addListener', 'getPurchases', 'getProducts'].map(name => ({ name, rtype: 'promise' })) },
        { name: 'SplashScreen', methods: [{ name: 'hide', rtype: 'promise' }] }
      ],
      nativeCallback: (plugin, method, options, callback) => {
        listeners[options.eventName] = callback;
        return options.eventName;
      },
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'NativePurchases') return { purchases: config.purchases || [], products: [] };
        if (method === 'removeListener') { delete listeners[options.eventName]; return; }
        window.__nativeCalls.push(plugin + '.' + method);
        if (method === 'hide') {
          window.__launchFrame = { launch: !document.getElementById('launchSurface').hidden, canvas: document.getElementById('c').width, menu: !document.getElementById('menu').hidden };
          return;
        }
        if (method === 'requestConsentInfo') {
          if (config.offline) throw Error('offline');
          return config.infoPending ? new Promise(r => { pending.info = r; }) : { ...info, ...config.info };
        }
        if (method === 'showConsentForm') return new Promise(r => { pending.form = r; });
        if (method === 'showPrivacyOptionsForm') return new Promise(r => { pending.privacy = r; });
        if (method === 'initialize' && config.initializePending) return new Promise(r => { pending.initialize = r; });
        if (method === 'prepareRewardVideoAd') {
          if (config.noFill) throw Error('no fill');
          if (config.loadPending && !pending.load) return new Promise(r => { pending.load = r; });
        }
        if (method === 'showRewardVideoAd') {
          if (config.showFailure) throw Error('ad expired');
          if (config.rewardEarned !== false) listeners.onRewardedVideoAdReward?.({ amount: 1 });
          listeners.onRewardedVideoAdDismissed?.({});
          return { amount: config.rewardEarned === false ? 0 : 1 };
        }
      }
    };
  }, native);
  await page.goto(url + (shots ? '#shots' : ''));
  if (shots) await page.waitForFunction(() => window.__ts);
  if (shots && !native) await page.waitForFunction(() => !document.querySelector('.hud').inert);
  return { page, context };
}
const storage = page => page.evaluate(() => ({ ...localStorage }));
const drop = (page, off) => page.evaluate(off => { __ts.setOff(off); __ts.place(); }, off);
// Pause before any run so particle counts and the Continue deadline are deterministic.
async function polishFixture(options = {}, seed = {}) {
  const f = await fixture({ ss_tut_done: 1, ss_games: 6, ss_best_endless_square: 100, ...seed }, options, true, null, '2026-11-11T12:00:00Z');
  await f.page.clock.pauseAt('2026-11-11T12:01:00Z');
  return f;
}
async function polishRun(page, score) {
  await page.evaluate(n => {
    __ts.start('endless', 'square');
    for (let i = 0; i < n; i++) { __ts.setOff(0); __ts.place(); }
  }, score);
  await page.clock.runFor(4000); // Existing in-play unlock / New Best particles finish first.
  await drop(page, 6.9);
  await page.clock.runFor(650);
}

test('polish: all confetti boundaries wait for final results and share one celebration with unlock/New Best', async () => {
  const { page, context } = await polishFixture();
  for (const [score, particles, delayedWaves] of [[0, 0, 0], [9, 0, 0], [10, 8, 0], [24, 8, 0], [25, 24, 0], [49, 24, 0], [50, 32, 1], [99, 32, 1], [100, 52, 2], [104, 52, 2]]) {
    await polishRun(page, score);
    if (score >= 10) {
      assert.equal(await page.locator('#offer').getAttribute('hidden'), null);
      assert.equal(await page.evaluate(() => __ts.particles), 0, 'failure / Continue does not celebrate');
      await page.locator('#offerNo').dispatchEvent('click');
    }
    assert.equal(await page.locator('#finalScore').textContent(), String(score));
    assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [particles, delayedWaves], 'single score-tier celebration');
    await page.clock.runFor(840);
    assert.ok(await page.evaluate(() => __ts.particles) <= 156, 'bounded result particles');
    await page.locator('#menuBtn').dispatchEvent('click');
    await page.clock.runFor(900);
    assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [0, 0], 'leaving results clears remaining waves');
  }
  await context.close();
});

test('polish: Continue keeps its five-second timer and buyer reward, and final failure celebrates once', async () => {
  const { page, context } = await polishFixture({}, { ss_noads: 1 });
  assert.equal(await page.locator('#noAdsBtn').textContent(), 'Ad-free ✓');
  assert.equal(await page.locator('#noAdsBtn').isDisabled(), true);
  assert.equal(await page.locator('.menu-footer a').count(), 2);
  await polishRun(page, 50);
  assert.equal(await page.locator('#offerCount').textContent(), '5');
  assert.equal(await page.locator('#offerScore').textContent(), 'Score 50');
  assert.equal(await page.locator('#offerTip span').textContent(), 'Get a wider block.');
  await page.locator('#offerYes').dispatchEvent('click');
  await page.clock.runFor(0);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.equal(await page.evaluate(() => __ts.particles), 0);
  await drop(page, 6.9);
  await page.clock.runFor(650);
  assert.equal(await page.locator('#offer').getAttribute('hidden'), '');
  assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [32, 1]);
  await page.locator('#menuBtn').dispatchEvent('click');
  await polishRun(page, 25);
  await page.clock.runFor(4900);
  assert.equal(await page.locator('#over').getAttribute('hidden'), '');
  await page.clock.runFor(100);
  assert.equal(await page.locator('#over').getAttribute('hidden'), null, 'offer expires after five seconds');
  assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [24, 0]);
  await context.close();
});

test('polish: score 104 with both New Best and a fresh shape has only three colorful result waves', async () => {
  const { page, context } = await polishFixture({}, { ss_best_endless_square: 5 });
  await polishRun(page, 104);
  await page.locator('#offerNo').dispatchEvent('click');
  assert.equal(await page.locator('#newBest').getAttribute('hidden'), null);
  assert.equal(await page.locator('#unlockCard').getAttribute('hidden'), null);
  assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [52, 2]);
  await page.clock.runFor(840);
  assert.equal(await page.evaluate(() => __ts.particles), 156);
  const clear = await page.evaluate(() => {
    const c = document.getElementById('fx');
    const d = c.width / innerWidth;
    return [...document.querySelectorAll('#over .card, #toggles')].every(el => {
      const r = el.getBoundingClientRect();
      const pixels = c.getContext('2d').getImageData(Math.ceil(r.x * d), Math.ceil(r.y * d), Math.floor(r.width * d), Math.floor(r.height * d)).data;
      return pixels.every((v, i) => i % 4 !== 3 || v === 0);
    });
  });
  assert.equal(clear, true, 'confetti never draws over the result score or controls');
  await context.close();
});

test('polish: quick failures clear in-play milestone particles at final results; Daily keeps its own celebration', async () => {
  const { page, context } = await polishFixture({}, { ss_best_endless_square: 5 });
  for (const score of [9, 20]) {
    await page.evaluate(n => {
      __ts.start('endless', 'square');
      for (let i = 0; i < n; i++) { __ts.setOff(0); __ts.place(); }
    }, score);
    assert.ok(await page.evaluate(() => __ts.particles) > 0, 'existing in-play milestone celebrates');
    await drop(page, 6.9);
    await page.clock.runFor(650);
    if (score >= 10) await page.locator('#offerNo').dispatchEvent('click');
    assert.equal(await page.evaluate(() => __ts.particles), score < 10 ? 0 : 8, 'final tier replaces earlier particles');
    await page.locator('#menuBtn').dispatchEvent('click');
  }
  await page.evaluate(() => {
    __ts.playDate('2026-11-11');
    for (let i = 0; i < 40 && __ts.state === 'playing'; i++) { __ts.setOff(0); __ts.place(); }
  });
  assert.equal(await page.evaluate(() => __ts.state), 'over');
  assert.equal(await page.evaluate(() => __ts.particles), 200, 'Daily still gets its existing completion burst');
  await page.clock.runFor(1900);
  assert.equal(await page.locator('#celebrate').getAttribute('hidden'), null);
  assert.equal(await page.evaluate(() => __ts.resultWaves), 0, 'no additional score-tier waves after Daily completion');
  assert.ok(await page.evaluate(() => __ts.particles) <= 360, 'shared particle cap');
  await context.close();
});

test('polish: Reduced Motion suppresses particles and UI motion, including preference changes mid-celebration', async () => {
  const { page, context } = await polishFixture({ reducedMotion: 'reduce' });
  await polishRun(page, 104);
  await page.locator('#offerNo').dispatchEvent('click');
  assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [0, 0]);
  assert.deepEqual(await page.locator('#over').evaluate(e => [getComputedStyle(e).animationName, getComputedStyle(e).transitionDuration]), ['none', '0s']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#menuBtn').dispatchEvent('click');
  await polishRun(page, 104);
  await page.locator('#offerNo').dispatchEvent('click');
  assert.equal(await page.evaluate(() => __ts.particles), 52);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(1000);
  assert.deepEqual(await page.evaluate(() => [__ts.particles, __ts.resultWaves]), [0, 0]);
  await context.close();
});

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

for (const mode of ['endless', 'time', 'daily']) test(`launch: ${mode} cold colors are stable without replacing saved selection`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 10, ss_best_endless_square: 100, ss_mode2: mode, ss_shape: 'circle', ss_intro_daily: 1 });
  let first;
  for (let i = 0; i < 3; i++) {
    if (i) { await page.reload(); await page.waitForFunction(() => window.__ts && !document.querySelector('.hud').inert); }
    const current = await page.evaluate(() => ({ mode: __ts.mode, shape: __ts.shape, runShape: __ts.runShape, hue: __ts.hue, tower: __ts.towerColor, background: document.body.style.background }));
    assert.equal(current.mode, mode); assert.equal(current.shape, 'circle');
    assert.ok(current.background.includes('--launch-sky'));
    if (first) assert.deepEqual(current, first); else first = current;
    assert.equal((await storage(page)).ss_shape, '"circle"');
  }
  if (mode === 'daily') {
    await page.evaluate(() => __ts.start('daily'));
    assert.equal(await page.evaluate(() => __ts.hue), first.hue, 'Daily keeps its date-derived hue');
    assert.equal(await page.evaluate(() => __ts.runShape), first.runShape);
  } else {
    assert.equal(first.hue, 205);
    await page.locator(`[data-page="${mode}"] [data-shape="square"][data-copy="1"]`).click();
    await page.waitForFunction(() => __ts.shape === 'square');
    assert.equal(await page.evaluate(() => document.body.style.background), '', 'shape selection releases the startup sky');
  }
  await context.close();
});

test('launch: new runs retain random hue variation and stacking retains the hue cycle', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 10, ss_best_endless_square: 100 });
  const colors = await page.evaluate(() => {
    const original = Math.random;
    Math.random = () => .1; __ts.start('endless', 'circle'); const first = __ts.hue;
    Math.random = () => .9; __ts.start('endless', 'circle'); const second = __ts.hue;
    Math.random = original;
    const tower = [__ts.towerColor];
    for (let i = 0; i < 2; i++) { __ts.setOff(0); __ts.place(); tower.push(__ts.towerColor); }
    return { first, second, tower, background: document.body.style.background };
  });
  assert.equal(colors.second - colors.first, 40);
  assert.equal(new Set(colors.tower).size, 3);
  assert.equal(colors.background, '');
  await context.close();
});

for (const reducedMotion of ['no-preference', 'reduce']) test(`owner QA: tutorial grow is visible and resumes in 1.1 seconds; readiness stays readable (${reducedMotion})`, async () => {
  const { page, context } = await fixture({}, { reducedMotion }, true, null, '2026-11-12T12:00:00Z');
  await page.clock.pauseAt('2026-11-12T12:01:00Z');
  await page.evaluate(() => __ts.tutorial(false));
  const full = await page.evaluate(() => __ts.topArea);
  await drop(page, .07); // Even a tiny valid teaching cut must have a readable rebuild.
  for (let i = 0; i < 2; i++) await drop(page, 0);
  const before = await page.evaluate(() => __ts.topArea);
  await drop(page, 0);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'grown');
  const grow = await page.evaluate(() => ({ area: __ts.topArea, nextVisible: __ts.moving.mesh.visible }));
  assert.ok(grow.area > before);
  assert.ok(Math.abs(grow.area - full) < 1e-8, 'teaching restores the complete original footprint');
  assert.equal(await page.evaluate(() => __ts.topScale), reducedMotion === 'reduce' ? 1 : .82);
  assert.equal(grow.nextVisible, false, 'next block does not hang frozen during the grow moment');
  await page.clock.runFor(1099);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'grown');
  await page.clock.runFor(1);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), null);
  assert.equal(await page.evaluate(() => __ts.moving.mesh.visible), true);
  await page.clock.runFor(200);
  assert.equal(await page.locator('#coach b').textContent(), "You're ready! Keep stacking!");
  const off = await page.evaluate(() => __ts.moving.off);
  await page.clock.runFor(2000);
  assert.equal(await page.locator('#coach').evaluate(e => e.classList.contains('show')), true);
  assert.notEqual(await page.evaluate(() => __ts.moving.off), off, 'gameplay is already moving during readiness copy');
  await page.clock.runFor(600);
  assert.equal(await page.locator('#coach').evaluate(e => e.classList.contains('show')), false);
  await context.close();
});

test('owner QA: Daily has a short solid intro, an inline streak helper and no repeat popup', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 6 });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => __ts.setMode('daily'));
  assert.equal(await page.locator('#intro').isVisible(), true);
  assert.equal(await page.locator('#introTitle').textContent(), 'Daily challenge');
  assert.deepEqual(await page.locator('#introBody p').allTextContents(), ['A new shape every day.', "Hit today's Perfect target."]);
  assert.equal(await page.locator('#intro .card').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(36, 40, 61)');
  const card = await page.locator('#intro .card').boundingBox();
  assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= 320 && card.y + card.height <= 568);
  await page.locator('#introGo').click();
  assert.equal(await page.locator('#dailyHelper').textContent(), 'Come back daily to build your streak.');
  await page.evaluate(() => { __ts.setMode('endless'); __ts.setMode('daily'); });
  assert.equal(await page.locator('#intro').getAttribute('hidden'), '');
  await context.close();
});

for (const reducedMotion of ['no-preference', 'reduce']) test(`launch: fresh install reveals the prepared tutorial immediately (${reducedMotion})`, async () => {
  const { page, context } = await fixture({}, { reducedMotion }, false, { infoPending: true });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.waitForSelector('#launchSurface[hidden]', { state: 'attached' });
  assert.equal(await page.locator('#menu').isHidden(), true);
  assert.equal(await page.locator('#skipBtn').isVisible(), true);
  assert.equal(await page.locator('#studioIntro').count(), 0);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  const frame = await page.evaluate(() => __launchFrame);
  assert.equal(frame.launch, true);
  assert.equal(frame.menu, false);
  await page.locator('#skipBtn').click();
  assert.equal(await page.locator('#score').textContent(), '0');
  assert.equal(await page.locator('#tip b').textContent(), "You're playing for real!");
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.equal(await page.locator('#menu').isVisible(), true);
  assert.equal(await page.locator('#skipBtn').isHidden(), true);
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
  assert.equal(await page.locator('#helpReveal').count(), 0, 'results unobstructed');
  await page.locator('#menuBtn').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('ss_help_reveal')), '"done"');
  await page.waitForFunction(() => document.getElementById('helpBtn').classList.contains('beckon'));
  await page.waitForFunction(() => !document.getElementById('helpBtn').classList.contains('beckon'));
  await page.reload();
  assert.equal(await page.locator('#helpReveal').count(), 0);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  assert.equal(await page.locator('#helpTip').count(), 0);
  await context.close();
});

for (const mode of ['endless', 'time', 'daily']) test(`? starts the same Square tutorial from ${mode}; replay and practice-again preserve all storage and restore selection`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 6, ss_best_endless_square: 7, ss_modes_unlocked: ['time', 'daily'], ss_intro_daily: 1, ss_mode2: mode, ss_shape: 'octagon', ss_help_reveal: 'done' });
  const before = await storage(page);
  await page.locator('#helpBtn').click(); // real button; catches the previous ordinary-game regression
  assert.equal(await page.locator('#skipBtn').textContent(), 'EXIT PRACTICE');
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
  assert.equal(await page.locator('#tip').evaluate(e => e.classList.contains('show')), false);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  assert.equal(await page.locator('#helpReveal').count(), 0);
  await context.close();
});

for (const phase of ['slice', 'recovery', 'grown']) test(`first-time Skip during ${phase} discards teaching progress and immediately starts a fresh real run`, async () => {
  const { page, context } = await fixture();
  const before = await storage(page);
  await page.evaluate(() => __ts.tutorial(false));
  assert.equal(await page.locator('#skipBtn').textContent(), 'SKIP TUTORIAL');
  const fullArea = await page.evaluate(() => __ts.topArea);
  if (phase === 'slice') {
    // Reach the unlock threshold without advancing the teaching sequence.
    for (let i = 0; i < 22; i++) await drop(page, 0);
  } else {
    await drop(page, 0.8);
    if (phase === 'recovery') await drop(page, 6.9);
    else for (let i = 0; i < 3; i++) await drop(page, 0);
  }
  assert.deepEqual(await storage(page), before, 'no tutorial score, miss or unlock persisted');
  await page.locator('#skipBtn').click();
  assert.deepEqual(await page.evaluate(() => [__ts.state, __ts.mode, __ts.runShape, __ts.tutorialPhase, __ts.practice, __ts.score, __ts.perfects, __ts.speed]),
    ['playing', 'endless', 'square', null, false, 0, 0, 4]);
  assert.equal(await page.evaluate(() => __ts.topArea), fullArea);
  assert.equal(await page.evaluate(() => __ts.moving.lvl), 1);
  assert.equal(await page.locator('#coach').isHidden(), true);
  assert.equal(await page.locator('#popup').evaluate(e => e.classList.contains('show')), false);
  assert.equal(await page.locator('#skipBtn').isHidden(), true);
  assert.equal(await page.locator('#menu').isHidden(), true);
  assert.equal(await page.locator('#tip b').textContent(), "You're playing for real!");
  assert.equal(await page.locator('#tip span').textContent(), 'ENDLESS · SQUARE');
  assert.equal(await page.locator('#tip').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
  assert.deepEqual(await storage(page), { ...before, ss_tut_done: '1', ss_help_reveal: '"armed"' });
  if (phase === 'slice') {
    // A real pointer tap works while the message is visible; 0.5 must slice at normal tolerance.
    await page.evaluate(() => __ts.setOff(0.5));
    await page.mouse.click(180, 320);
    assert.equal(await page.evaluate(() => __ts.score), 1);
    assert.equal(await page.evaluate(() => __ts.perfects), 0);
    assert.ok(await page.evaluate(() => __ts.topArea) < fullArea);
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#tip').evaluate(e => e.classList.contains('show')), true);
    await page.waitForFunction(() => !document.getElementById('tip').classList.contains('show'), null, { timeout: 1800 });
    for (let i = 1; i < 21; i++) await drop(page, 0);
    await lose(page);
    const saved = await storage(page);
    assert.equal(saved.ss_best_endless_square, '21', 'only the fresh real run score is saved');
    assert.equal(saved.ss_games, '1', 'abandoned teaching misses/counts are excluded');
    assert.ok(JSON.parse(saved.ss_unlocked).includes('circle'), 'real-run progression works');
    await page.locator('#menuBtn').click();
    assert.equal((await storage(page)).ss_help_reveal, '"done"');
    assert.equal(await page.locator('#helpReveal').count(), 0);
    await page.waitForFunction(() => !document.getElementById('helpBtn').classList.contains('beckon'));
  } else {
    const movingId = await page.evaluate(() => __ts.moving.mesh.uuid);
    await page.waitForTimeout(2600); // pending recovery and growth-completion callbacks must be cancelled
    assert.equal(await page.evaluate(() => __ts.moving.mesh.uuid), movingId);
    assert.equal(await page.evaluate(() => __ts.score), 0);
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), null);
    assert.equal(await page.locator('#coach').isHidden(), true);
    assert.equal(await page.locator('#tip').evaluate(e => e.classList.contains('show')), false);
    assert.deepEqual(await storage(page), { ...before, ss_tut_done: '1', ss_help_reveal: '"armed"' });
  }
  await context.close();
});

test('successful first tutorial completion commits deferred teaching unlocks', async () => {
  const { page, context } = await fixture();
  const before = await storage(page);
  await page.evaluate(() => __ts.tutorial(false));
  for (let i = 0; i < 22; i++) await drop(page, 0);
  assert.deepEqual(await storage(page), before);
  await learn(page);
  assert.ok(JSON.parse((await storage(page)).ss_unlocked).includes('circle'));
  await lose(page);
  assert.equal((await storage(page)).ss_best_endless_square, '26');
  assert.equal((await storage(page)).ss_games, '1');
  assert.equal((await storage(page)).ss_help_reveal, '"pending"');
  await context.close();
});

test('reduced motion consumes the one-time reveal without movement or emphasis', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 1, ss_help_reveal: 'pending' }, { reducedMotion: 'reduce' });
  assert.equal((await storage(page)).ss_help_reveal, '"done"');
  assert.equal(await page.locator('#helpReveal').count(), 0);
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
  const link = page.getByRole('link', { name: 'Privacy', exact: true });
  await link.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  await (await popupPromise).close();
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  assert.equal(await page.locator('#helpTip').count(), 0);
  await context.close();
});

for (const initial of ['slice', 'perfect']) test(`miss during ${initial} preserves the objective and resets the consecutive streak`, async () => {
  const { page, context } = await fixture();
  await page.evaluate(() => __ts.tutorial(false));
  if (initial === 'perfect') { await drop(page, 0.8); await drop(page, 0); await drop(page, 0); }
  await drop(page, 6.9);
  await page.waitForFunction(() => __ts.coach === 'Missed the tower!');
  assert.equal(await page.locator('#coach span').textContent(), 'In a normal run, that ends the game. Try again!');
  assert.equal(await page.locator('#coach .dots').count(), 0);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), initial);
  assert.equal((await storage(page)).ss_games, undefined);
  await page.waitForFunction(() => __ts.state === 'playing');
  if (initial === 'slice') await drop(page, 0.8);
  else {
    assert.equal(await page.locator('#coach .pips3 i.on').count(), 0);
    await drop(page, 0); // 1; previous two Perfects must not complete this challenge
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'perfect');
    await drop(page, 1.5); // slice also resets the streak
  }
  for (let i = 0; i < 2; i++) await drop(page, 0);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'perfect');
  await drop(page, 0);
  assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'grown');
  await page.waitForFunction(() => __ts.tutorialPhase === null);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  await context.close();
});

for (const entry of ['complete', 'skip']) test(`${entry}: fresh progression unlocks Circle exactly at 20, preserves its celebration, offers Circle and reveals help once`, async () => {
  const { page, context } = await fixture();
  const circle = page.locator('[data-page="endless"] [data-shape="circle"][data-copy="1"]');
  assert.equal(await circle.evaluate(e => e.classList.contains('locked')), true);
  assert.equal(await page.locator('[data-page="endless"] [data-best-sub]').textContent(), 'Score 20 to unlock Circle');
  assert.equal((await storage(page)).ss_allshapes, undefined);
  await page.evaluate(() => __ts.tutorial(false));
  if (entry === 'complete') await learn(page);
  else await page.locator('#skipBtn').click();
  assert.equal((await storage(page)).ss_help_reveal, '"armed"');
  assert.equal(await page.locator('#helpBtn').isHidden(), true);
  while (await page.evaluate(() => __ts.score) < 19) await drop(page, 0);
  assert.equal((await storage(page)).ss_unlocked, undefined);
  await drop(page, 0);
  assert.deepEqual(JSON.parse((await storage(page)).ss_unlocked), ['square', 'circle']);
  assert.equal(await page.locator('#popup').textContent(), 'Circle unlocked!');
  await drop(page, 0);
  assert.equal(await page.locator('#popup').textContent(), 'Circle unlocked!', 'the next Perfect does not replace the unlock celebration');
  await lose(page);
  assert.equal(await page.locator('#tryNewBtn').textContent(), 'Play circle');
  assert.equal(await page.locator('#tryNewBtn').isVisible(), true);
  assert.equal(await page.locator('#unlockNote').textContent(), 'Daily challenge unlocked · Time Attack unlocked');
  assert.equal((await storage(page)).ss_help_reveal, '"pending"');
  await page.locator('#menuBtn').click();
  assert.equal(await circle.evaluate(e => e.classList.contains('locked')), false);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 1);
  assert.equal((await storage(page)).ss_help_reveal, '"done"');
  await page.reload();
  await page.waitForFunction(() => window.__ts && !document.querySelector('.hud').inert);
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  await page.locator('#helpBtn').click();
  await page.locator('#skipBtn').click();
  assert.equal(await page.locator('#helpBtn.beckon').count(), 0);
  await context.close();
});

test('Unlock All Shapes entitlement grants access without writing earned progression; Remove Ads alone does not unlock shapes', async () => {
  for (const all of [false, true]) {
    const { page, context } = await fixture({ ss_tut_done: 1, ss_noads: 1, ss_allshapes: all ? 1 : 0 });
    const shapes = page.locator('[data-page="endless"] [data-copy="1"]');
    assert.equal(await shapes.count(), 9);
    assert.equal(await shapes.evaluateAll(els => els.filter(e => e.classList.contains('locked')).length), all ? 0 : 8);
    const before = await storage(page);
    await page.locator('#helpBtn').click();
    await learn(page);
    for (let i = 4; i < 21; i++) await drop(page, 0);
    await lose(page);
    await page.locator('#menuBtn').click();
    assert.deepEqual(await storage(page), before);
    await context.close();
  }
});

// Use the real Continue buttons and native facade; only SDK responses are controlled.
async function firstRewardedContinue(config = {}) {
  const f = await fixture({}, {}, true, { infoPending: true, ...config }, '2026-11-12T12:00:00Z');
  const { page } = f;
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => __ts.tutorial(false));
  await page.locator('#skipBtn').dispatchEvent('click');
  await page.evaluate(() => { for (let i = 0; i < 20; i++) { __ts.setOff(0); __ts.place(); } });
  assert.equal(await page.evaluate(() => __ts.score), 20);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await drop(page, 6.9);
  await page.clock.runFor(650);
  assert.equal(await page.locator('#offer').isVisible(), true);
  await page.clock.runFor(1000);
  const count = await page.locator('#offerCount').textContent();
  if (config.infoBeforeContinue) {
    await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true }));
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showConsentForm')), false, 'late info cannot cover a live Continue offer');
    assert.equal(await page.locator('#privacySetup').isHidden(), true);
    assert.equal(await page.locator('.hud').evaluate(e => e.inert), false);
  }
  await page.locator('#offerYes').dispatchEvent('click');
  await page.waitForSelector('#privacySetup:not([hidden])');
  if (!config.infoBeforeContinue) await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true }));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showConsentForm'));
  await page.clock.runFor(6000); // A form can outlast the entire original Continue offer.
  assert.equal(await page.locator('#offerCount').textContent(), count);
  assert.equal(await page.locator('#offer').isVisible(), true);
  assert.equal(await page.locator('#over').isHidden(), true);
  await page.locator('#offerYes').dispatchEvent('click'); // duplicate input while UMP owns the boundary
  assert.equal(await page.evaluate(() => __nativeCalls.filter(c => c === 'AdMob.showConsentForm').length), 1);
  return f;
}

test('startup: late REQUIRED info preserves the live Continue offer until explicit consent opt-in', async () => {
  const { page, context } = await firstRewardedContinue({ infoBeforeContinue: true });
  await page.evaluate(() => __resolveNative('form', { canRequestAds: false }));
  await page.waitForSelector('#over:not([hidden])');
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  await context.close();
});

test('first-run rewarded Continue: score 20 waits for consent, initialization and loaded reward; no duplicate prompts', async () => {
  const { page, context } = await firstRewardedContinue({ initializePending: true, loadPending: true });
  await page.evaluate(() => __resolveNative('form', { canRequestAds: true }));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.initialize'));
  assert.equal(await page.locator('#privacySetup').textContent(), 'Loading ad…');
  await page.clock.runFor(2000);
  assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.prepareRewardVideoAd')), false);
  await page.evaluate(() => __resolveNative('initialize', {}));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.prepareRewardVideoAd'));
  await page.clock.runFor(2000);
  assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showRewardVideoAd')), false);
  assert.equal(await page.evaluate(() => __ts.state), 'over');
  await page.evaluate(() => __resolveNative('load', {}));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showRewardVideoAd'));
  await page.clock.runFor(300);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.equal(await page.evaluate(() => __ts.score), 20, 'Continue resumes the same run');
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  await drop(page, 6.9);
  await page.clock.runFor(650);
  assert.equal(await page.locator('#offer').isHidden(), true, 'one Continue per run');
  assert.equal(await page.locator('#over').isVisible(), true);
  await page.locator('#againBtn').dispatchEvent('click');
  await page.waitForFunction(() => __ts.state === 'playing');
  await page.evaluate(() => { for (let i = 0; i < 20; i++) { __ts.setOff(0); __ts.place(); } });
  await drop(page, 6.9);
  await page.clock.runFor(650);
  await page.locator('#offerYes').dispatchEvent('click');
  await page.waitForFunction(() => __nativeCalls.filter(c => c === 'AdMob.showRewardVideoAd').length === 2);
  await page.clock.runFor(300);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  for (const method of ['requestConsentInfo', 'showConsentForm', 'initialize']) {
    assert.equal(await page.evaluate(m => __nativeCalls.filter(c => c === 'AdMob.' + m).length, method), 1);
  }
  assert.equal(await page.evaluate(() => __nativeCalls.some(c => c.includes('TrackingAuthorization'))), false);
  await context.close();
});

for (const outcome of ['refused', 'no fill', 'dismissed', 'load timeout', 'show failure']) test(`first-run rewarded Continue: ${outcome} returns to results without a reward or stuck UI`, async () => {
  const { page, context } = await firstRewardedContinue({ noFill: outcome === 'no fill', rewardEarned: outcome !== 'dismissed', loadPending: outcome === 'load timeout', showFailure: outcome === 'show failure' });
  await page.evaluate(allowed => __resolveNative('form', { canRequestAds: allowed }), outcome !== 'refused');
  if (outcome === 'dismissed' || outcome === 'show failure') {
    await page.waitForFunction(() => __nativeCalls.includes('AdMob.showRewardVideoAd'));
    await page.clock.runFor(300);
  } else if (outcome === 'load timeout') {
    await page.waitForFunction(() => __nativeCalls.includes('AdMob.prepareRewardVideoAd'));
    await page.clock.runFor(15001);
  }
  await page.waitForSelector('#over:not([hidden])');
  assert.equal(await page.locator('#offer').isHidden(), true);
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  assert.equal(await page.evaluate(() => __ts.state), 'over');
  assert.equal(await page.evaluate(() => __ts.moving), null, 'no free continuation');
  if (outcome === 'refused') assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.initialize')), false);
  if (outcome !== 'dismissed' && outcome !== 'show failure') assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showRewardVideoAd')), false);
  if (outcome === 'load timeout') {
    await page.evaluate(() => __resolveNative('load', {}));
    assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showRewardVideoAd')), false, 'late preload cannot grant or show');
  }
  await page.locator('#againBtn').dispatchEvent('click');
  await page.waitForFunction(() => __ts.state === 'playing');
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), false);
  assert.equal(await page.evaluate(() => __nativeCalls.filter(c => c === 'AdMob.showConsentForm').length), 1);
  await context.close();
});

test('owner QA: first native tutorial and Skip run stay interactive until the first menu pause', async () => {
  const { page, context } = await fixture({}, {}, false, { infoPending: true });
  await page.waitForSelector('#skipBtn:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), false);
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  const frame = await page.evaluate(() => __launchFrame);
  assert.equal(frame.launch, true);
  assert.equal(frame.menu, false, 'native splash hands off to the prepared tutorial');
  assert.ok(frame.canvas > 0);
  await page.locator('#skipBtn').click();
  assert.equal(await page.locator('#tip b').textContent(), "You're playing for real!");
  await page.mouse.click(180, 320); // The fresh moving block is still outside the tower.
  await page.waitForSelector('#over:not([hidden])');
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide'], 'results remain unobstructed');
  await page.locator('#menuBtn').click();
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), false);
  await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true }));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showConsentForm'));
  assert.equal(await page.locator('#privacySetup').isVisible(), true);
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), true);
  await page.evaluate(() => __resolveNative('form', { canRequestAds: false }));
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide', 'AdMob.showConsentForm']);
  await context.close();
});

test('owner QA: completed native tutorial defers UMP presentation until replay, including a free Continue', async () => {
  const { page, context } = await fixture({}, {}, true, { purchases: [{ productIdentifier: 'shapescraper_no_ads', purchaseState: 1 }] });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.evaluate(() => __ts.tutorial(false));
  await learn(page);
  for (let i = 4; i < 10; i++) await drop(page, 0);
  await drop(page, 6.9);
  await page.waitForSelector('#offer:not([hidden])');
  assert.equal(await page.locator('#coach').evaluate(e => e.classList.contains('show')), false, 'readiness coaching clears at run failure');
  await page.locator('#offerYes').click();
  await page.waitForFunction(() => __ts.state === 'playing');
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await lose(page);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await page.locator('#againBtn').click();
  assert.equal(await page.evaluate(() => __ts.state), 'over', 'a required form holds only the results boundary');
  assert.equal(await page.locator('#privacySetup').isVisible(), true);
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showConsentForm'));
  await page.evaluate(() => __resolveNative('form', { canRequestAds: false }));
  await page.waitForFunction(() => __ts.state === 'playing');
  assert.equal(await page.evaluate(() => __ts.score), 0);
  await lose(page);
  await page.locator('#menuBtn').click();
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide', 'AdMob.showConsentForm'], 'no duplicate consent or separate ATT call');
  await context.close();
});

test('owner QA: quitting after tutorial Skip keeps the unfinished first run protected on relaunch', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1 }, {}, true, { infoPending: true });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await page.locator('[data-page="endless"] [data-play]').click();
  await lose(page);
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await page.locator('#menuBtn').click();
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.requestConsentInfo'));
  await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: false }));
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await context.close();
});

for (const status of ['NOT_REQUIRED', 'OBTAINED', 'UNKNOWN', 'REQUIRED']) test(`startup: returning ${status} stays interactive without a required available form`, async () => {
  const eligible = status === 'NOT_REQUIRED' || status === 'OBTAINED';
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 5 }, {}, true, {
    initializePending: true,
    info: { status, canRequestAds: eligible, isConsentFormAvailable: status !== 'REQUIRED' }
  });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.deepEqual(await page.evaluate(() => __setupMessages), []);
  assert.equal(await page.locator('#studioIntro').count(), 0);
  const nativeFrame = await page.evaluate(() => __launchFrame);
  assert.equal(nativeFrame.menu, true, 'menu is painted before native splash dismissal');
  assert.equal(nativeFrame.launch, true, 'the matching web launch surface is ready before native dismissal');
  assert.ok(nativeFrame.canvas > 0);
  assert.equal(await page.evaluate(() => Ads.isOpen()), false);
  assert.equal(await page.locator('#menu .privacy-btn').isVisible(), true, 'required privacy options remain accessible');
  await page.locator('[data-page="endless"] [data-play]').click();
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  if (eligible) {
    await page.waitForFunction(() => __nativeCalls.includes('AdMob.initialize'));
    await page.evaluate(() => __resolveNative('initialize', {}));
  }
  assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showConsentForm')), false);
  assert.equal(await page.evaluate(() => Ads.privacyRequired()), true, 'privacy entry remains required independently of form status');
  assert.equal(await page.evaluate(() => __nativeCalls.filter(c => c === 'AdMob.requestConsentInfo').length), 1);
  await context.close();
});

for (const entry of ['menu Play', 'results replay']) test(`startup: late REQUIRED info after ${entry} waits for the next menu boundary`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 5 }, {}, true, { infoPending: true });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.deepEqual(await page.evaluate(() => __setupMessages), []);
  await page.locator('[data-page="endless"] [data-play]').click();
  if (entry === 'results replay') {
    await lose(page);
    await page.locator('#againBtn').click();
    await page.waitForFunction(() => __ts.state === 'playing');
  }
  await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true, privacyOptionsRequirementStatus: 'REQUIRED' }));
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.showConsentForm')), false);
  assert.equal(await page.evaluate(() => __nativeCalls.includes('AdMob.initialize')), false);
  assert.deepEqual(await page.evaluate(() => __setupMessages), []);
  await lose(page);
  await page.locator('#menuBtn').click();
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showConsentForm'));
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), true);
  await page.evaluate(() => __resolveNative('form', { canRequestAds: false }));
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.locator('[data-page="endless"] [data-play]').click();
  await lose(page);
  await page.locator('#menuBtn').click();
  assert.equal(await page.evaluate(() => __nativeCalls.filter(c => c === 'AdMob.showConsentForm').length), 1);
  assert.equal(await page.evaluate(() => __nativeCalls.filter(c => c === 'AdMob.requestConsentInfo').length), 1);
  await context.close();
});

test('startup: returning launch stays silent until REQUIRED info arrives at the menu boundary', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 5 }, {}, true, { infoPending: true });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  await page.evaluate(() => __resolveNative('info', { status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true }));
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showConsentForm'));
  assert.equal(await page.locator('#privacySetup').isVisible(), true);
  assert.equal(await page.locator('.hud').evaluate(e => e.inert), true);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  await page.evaluate(() => __resolveNative('form', { canRequestAds: false }));
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  assert.equal(await page.locator('#privacySetup').isHidden(), true);
  await page.locator('[data-page="endless"] [data-play]').click();
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide', 'AdMob.showConsentForm']);
  await context.close();
});

for (const offline of [false, true]) test(`mock native returning launch: ${offline ? 'offline' : 'ATT already determined / no form'} permits prompt play`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 5 }, {}, true, { offline, info: { isConsentFormAvailable: false, canRequestAds: false } });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.locator('[data-page="endless"] [data-play]').click();
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.deepEqual(await page.evaluate(() => __nativeCalls), ['AdMob.requestConsentInfo', 'SplashScreen.hide']);
  await context.close();
});

test('mock native privacy form freezes movement and Time Attack countdown until dismissal', async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: 5, ss_modes_unlocked: ['time'] }, {}, true, { info: { isConsentFormAvailable: false, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' } });
  await page.waitForFunction(() => !document.querySelector('.hud').inert);
  await page.evaluate(() => __ts.start('time', 'square'));
  await page.evaluate(() => { window.__privacyDone = Ads.showPrivacyOptions(); });
  await page.waitForFunction(() => __nativeCalls.includes('AdMob.showPrivacyOptionsForm'));
  const before = await page.evaluate(() => ({ off: __ts.moving.off, time: __ts.remainingTime }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ off: __ts.moving.off, time: __ts.remainingTime })), before);
  await page.mouse.click(180, 320);
  assert.equal(await page.evaluate(() => __ts.score), 0);
  await page.evaluate(() => __resolveNative('privacy'));
  await page.evaluate(() => __privacyDone);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => __ts.remainingTime) < before.time);
  await context.close();
});

for (const platform of ['ios', 'android']) test(`mock ${platform} store entitlement grants every shape and ignores revoked purchases`, async () => {
  for (const revoked of [false, true]) {
    const { page, context } = await fixture({ ss_tut_done: 1 }, {}, true, {
      platform, info: { isConsentFormAvailable: false },
      purchases: [{ productIdentifier: 'shapescraper_unlock_all', purchaseState: 1, revocationDate: revoked ? '2026-11-01' : null }]
    });
    await page.waitForFunction(() => !document.querySelector('.hud').inert);
    assert.equal(await page.evaluate(() => Store.allShapes()), !revoked);
    assert.equal(await page.locator('[data-page="endless"] [data-copy="1"].locked').count(), revoked ? 8 : 0);
    assert.equal((await storage(page)).ss_unlocked, undefined);
    await context.close();
  }
});

const missHint = 'Tap when the block is over the tower.';
async function adaptiveMissFixture(practice, reducedMotion = 'no-preference') {
  const result = await fixture({}, { reducedMotion }, true, null, '2026-11-11T12:00:00Z');
  await result.page.clock.pauseAt('2026-11-11T12:01:00Z');
  await result.page.evaluate(practice => __ts.tutorial(practice), practice);
  return result;
}
async function recoverMiss(page, consecutive) {
  const before = await page.evaluate(() => ({ score: __ts.score, phase: __ts.tutorialPhase }));
  await drop(page, 6.9);
  const delay = consecutive >= 5 ? 1300 : 2000;
  await page.clock.fastForward(delay - 1);
  assert.equal(await page.evaluate(() => __ts.state), 'over', 'recovery does not run early');
  assert.equal(await page.locator('#coach b').textContent(), 'Missed the tower!');
  assert.equal(await page.locator('#coach span').textContent(), consecutive >= 3 ? missHint : 'In a normal run, that ends the game. Try again!');
  await page.clock.fastForward(1);
  assert.equal(await page.evaluate(() => __ts.state), 'playing', `miss ${consecutive} recovers at ${delay}ms`);
  assert.deepEqual(await page.evaluate(() => ({ score: __ts.score, phase: __ts.tutorialPhase })), before, 'no automatic placement or lesson completion');
  await page.clock.fastForward(200);
  assert.equal(await page.locator('#coach span').textContent() === missHint, consecutive >= 3, 'guidance persists on the next attempt');
}

for (const practice of [false, true]) for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`adaptive tutorial misses: ${practice ? 'replay' : 'first-time'}, motion=${reducedMotion}`, async () => {
    const { page, context } = await adaptiveMissFixture(practice, reducedMotion);
    const before = await storage(page);
    for (let n = 1; n <= 6; n++) await recoverMiss(page, n);
    assert.equal(await page.locator('#skipBtn').textContent(), practice ? 'EXIT PRACTICE' : 'SKIP TUTORIAL');
    assert.equal(await page.locator('#skipBtn').isVisible(), true);
    assert.deepEqual(await storage(page), before, 'recovery does not record losses or progression');

    await drop(page, 0.8); // successful slice resets complete misses without changing the Perfect lesson
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'perfect');
    for (let n = 1; n <= 3; n++) await recoverMiss(page, n);
    assert.equal(await page.locator('#coach b').textContent(), 'Land 3 Perfects in a row');
    assert.equal(await page.locator('#coach .pips3 i.on').count(), 0);
    await drop(page, 0.9); // existing adaptive Perfect tolerance still applies after repeated failures
    assert.equal(await page.evaluate(() => __ts.perfects), 1);
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), 'perfect');
    await recoverMiss(page, 1); // a successful Perfect also resets complete misses
    assert.deepEqual(await storage(page), before);

    for (let n = 1; n <= 3; n++) {
      await drop(page, 0.9);
      assert.equal(await page.evaluate(() => __ts.tutorialPhase), n < 3 ? 'perfect' : 'grown');
    }
    await page.clock.fastForward(2000);
    const completed = await page.evaluate(() => ({ score: __ts.score, moving: __ts.moving.mesh.uuid }));
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), null);
    await page.clock.fastForward(2500);
    assert.deepEqual(await page.evaluate(() => ({ score: __ts.score, moving: __ts.moving.mesh.uuid })), completed, 'no recovery can replace the completed tower');
    assert.equal((await storage(page)).ss_games, undefined);
    if (practice) assert.deepEqual(await storage(page), before);
    await context.close();
  });
}

for (const practice of [false, true]) for (const exit of ['skip', 'menu']) {
  test(`adaptive tutorial recovery cancellation: ${practice ? 'replay' : 'first-time'} via ${exit}`, async () => {
    const { page, context } = await adaptiveMissFixture(practice);
    for (let n = 1; n <= 4; n++) await recoverMiss(page, n);
    await drop(page, 6.9); // leave with the fifth miss's shortened timer still pending
    if (exit === 'skip') await page.locator('#skipBtn').dispatchEvent('click');
    else await page.evaluate(() => __ts.menu());
    const afterExit = await page.evaluate(() => ({ state: __ts.state, score: __ts.score, moving: __ts.moving?.mesh.uuid || null }));
    assert.equal(afterExit.state, exit === 'skip' && !practice ? 'playing' : 'menu');
    const saved = await storage(page);
    await page.clock.fastForward(2500);
    assert.deepEqual(await page.evaluate(() => ({ state: __ts.state, score: __ts.score, moving: __ts.moving?.mesh.uuid || null })), afterExit);
    assert.deepEqual(await storage(page), saved);
    assert.equal(await page.evaluate(() => __ts.tutorialPhase), null);
    assert.equal(await page.locator('#coach').isHidden(), true);
    assert.equal(saved.ss_games, undefined);
    // A new lesson must not inherit the miss streak or be touched by the old recovery.
    await page.evaluate(practice => __ts.tutorial(practice), practice);
    await recoverMiss(page, 1);
    await context.close();
  });
}

// Final polish: exercise scoring and the real menu gestures without a broad QA sweep.
async function observeBest(page) {
  await page.evaluate(() => {
    window.__bestMilestones = [];
    new MutationObserver(() => {
      const text = document.getElementById('popup').textContent;
      if (/new best!/i.test(text)) __bestMilestones.push(text);
    }).observe(document.getElementById('popup'), { childList: true, subtree: true });
  });
}
for (const [mode, shape, previous] of [['endless', 'square', 5], ['time', 'circle', 1]]) test(`follow-up: ${mode}/${shape} New Best happens once across Continue and persists results`, async () => {
  const key = `ss_best_${mode}_${shape}`;
  const { page, context } = await polishFixture({}, { [key]: previous, ss_noads: 1, ss_allshapes: 1 });
  await observeBest(page);
  await page.evaluate(([m, s]) => __ts.start(m, s), [mode, shape]);
  for (let i = 0; i < 12; i++) await drop(page, 0);
  assert.equal(await page.locator('#score').textContent(), '12');
  assert.equal(await page.locator('#bestTag').isHidden(), true);
  assert.equal(await page.evaluate(() => __bestMilestones.length), 1);
  await drop(page, 6.9); await page.clock.runFor(650);
  assert.equal(await page.locator('#offer').isVisible(), true);
  assert.equal(await page.locator('#offerScore').evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#popup').evaluate(e => e.classList.contains('show')), false, 'no stale gameplay badge');
  await page.locator('#offerYes').dispatchEvent('click'); await page.clock.runFor(0);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.equal(await page.locator('#bestTag').isHidden(), true);
  if (mode === 'time') await drop(page, 0); // Further scoring after Continue also stays quiet.
  const final = mode === 'time' ? 13 : 12;
  assert.equal(await page.evaluate(() => __bestMilestones.length), 1);
  await drop(page, 6.9); await page.clock.runFor(650);
  assert.equal(await page.locator('#newBest').isVisible(), true, 'the original record remains new across Continue');
  assert.equal(JSON.parse((await storage(page))[key]), final);
  for (const id of ['finalScore', 'finalBest', 'newBest']) {
    assert.equal(await page.locator('#' + id).evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  assert.equal(await page.locator('#over .card').evaluate(e => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'), false);
  await page.locator('#againBtn').dispatchEvent('click'); await page.clock.runFor(0);
  for (let i = 0; i < final + 1; i++) await drop(page, 0);
  assert.equal(await page.evaluate(() => __bestMilestones.length), 2, 'a new run gets one new milestone');
  await drop(page, 6.9); await page.clock.runFor(650);
  await page.locator('#offerNo').dispatchEvent('click');
  assert.equal(await page.locator('#finalScore').textContent(), String(final + 1));
  assert.equal(await page.locator('#finalBest').textContent(), String(final + 1));
  assert.equal(JSON.parse((await storage(page))[key]), final + 1);
  await context.close();
});
for (const previous of [19, 20]) test(`follow-up: New Best respects simultaneous/existing shape unlocks at previous best ${previous}`, async () => {
  const { page, context } = await polishFixture({}, { ss_best_endless_square: previous });
  await observeBest(page);
  await page.evaluate(() => __ts.start('endless', 'square'));
  for (let i = 0; i < previous + 2; i++) await drop(page, 0);
  const entries = await page.evaluate(() => __bestMilestones);
  assert.equal(entries.length, 1);
  assert.equal(entries[0], previous === 19 ? 'Circle unlocked!New best!' : 'New best!');
  assert.equal(await page.locator('#bestTag').isHidden(), true);
  await context.close();
});

async function swipeMode(page, dir, target = '#menuCard') {
  await page.locator(target).dispatchEvent('pointerdown', { clientX: 180, clientY: 400 });
  await page.locator(target).dispatchEvent('pointerup', { clientX: 180 - dir * 80, clientY: 402 });
}
for (const [reducedMotion, unlocked] of [['no-preference', false], ['reduce', false], ['no-preference', true]]) test(`follow-up: circular swipes, ${unlocked ? 'unlocked' : 'locked'} modes, taps and shape ownership (${reducedMotion})`, async () => {
  const { page, context } = await fixture({ ss_tut_done: 1, ss_games: unlocked ? 10 : 1, ss_modes_unlocked: unlocked ? ['time', 'daily'] : [], ss_intro_daily: 1 }, { reducedMotion });
  assert.equal(await page.locator('[data-mode="time"]').evaluate(e => e.classList.contains('locked')), !unlocked);
  assert.equal(await page.locator('[data-mode="daily"]').evaluate(e => e.classList.contains('locked')), !unlocked);
  for (const dir of [1, -1]) {
    for (const expected of dir === 1 ? ['time', 'daily', 'endless', 'time', 'daily', 'endless'] : ['daily', 'time', 'endless', 'daily', 'time', 'endless']) {
      const before = await page.evaluate(() => __ts.mode);
      await swipeMode(page, dir);
      assert.equal(await page.evaluate(() => __ts.mode), expected);
      assert.equal(await page.locator(`[data-mode="${expected}"]`).getAttribute('aria-checked'), 'true');
      if (Math.abs(['endless', 'time', 'daily'].indexOf(expected) - ['endless', 'time', 'daily'].indexOf(before)) === 2) {
        const frames = await page.evaluate(() => document.getElementById('track').getAnimations({ subtree: true }).filter(a => a.effect.target.matches('.page')).map(a => ({ page: a.effect.target.dataset.page, frames: a.effect.getKeyframes().map(k => k.transform) })));
        assert.equal(frames.length, reducedMotion === 'reduce' ? 0 : 2);
        if (reducedMotion !== 'reduce') {
          assert.deepEqual(frames.find(f => f.page === expected).frames, [`translateX(${dir * 100}%)`, 'translateX(0px)']);
          const positions = await page.evaluate(() => {
            const animations = document.getElementById('track').getAnimations({ subtree: true });
            animations.forEach(a => a.pause()); animations.forEach(a => { a.currentTime = 130; });
            return [...document.querySelectorAll('.page')].map(e => ({ page: e.dataset.page, x: e.getBoundingClientRect().x }));
          });
          const outgoing = positions.find(p => p.page === before).x, incoming = positions.find(p => p.page === expected).x;
          assert.ok(dir === 1 ? outgoing < incoming : outgoing > incoming, 'wrap travels in the swipe direction');
          await page.evaluate(() => document.getElementById('track').getAnimations({ subtree: true }).forEach(a => a.finish()));
        }
      }
      // Complete the short existing transition before the next independent gesture.
      await page.evaluate(() => document.getElementById('track').getAnimations({ subtree: true }).forEach(a => a.finish()));
      assert.equal(await page.locator('.page').count(), 3, 'real pages are reused');
      assert.ok(Math.abs(await page.locator(`[data-page="${expected}"]`).evaluate(e => e.getBoundingClientRect().x) - await page.locator('.pages').evaluate(e => e.getBoundingClientRect().x)) < 1);
    }
  }
  assert.equal(await page.locator('[data-page="daily"] .page-lock').isHidden(), unlocked);
  assert.equal(await page.locator('[data-page="time"] .page-lock').isHidden(), unlocked);
  await swipeMode(page, 1, '[data-page="endless"] .shapes');
  assert.equal(await page.evaluate(() => __ts.mode), 'endless', 'shape gestures keep mode ownership');
  await page.locator('#menuCard').dispatchEvent('pointerdown', { clientX: 180, clientY: 400 });
  await page.locator('#menuCard').dispatchEvent('pointerup', { clientX: 140, clientY: 402 });
  assert.equal(await page.evaluate(() => __ts.mode), 'endless', '45px threshold is unchanged');
  for (const mode of ['daily', 'time', 'endless']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    assert.equal(await page.evaluate(() => __ts.mode), mode);
  }
  await page.locator('[data-mode="endless"]').press('ArrowRight');
  assert.equal(await page.evaluate(() => __ts.mode), 'time');
  assert.equal(await page.locator('[data-mode="time"]').evaluate(e => e === document.activeElement), true);
  await page.reload(); await page.waitForFunction(() => window.__ts);
  assert.equal(await page.evaluate(() => __ts.mode), 'time', 'selection persists');
  await context.close();
});

test('follow-up: a repaired Continue tower cannot put a delayed gameplay badge over results', async () => {
  const { page, context } = await polishFixture({}, { ss_noads: 1 });
  await page.evaluate(() => { __ts.start('endless', 'square'); for (let i = 0; i < 12; i++) { __ts.setOff(0); __ts.place(); } });
  const full = await page.evaluate(() => __ts.topArea);
  await drop(page, 2);
  assert.equal(await page.evaluate(() => __ts.score), 13);
  assert.ok(await page.evaluate(() => __ts.topArea) < full / 2, 'thin tower needs repair');
  await drop(page, 6.9); await page.clock.runFor(650);
  await page.locator('#offerYes').dispatchEvent('click'); await page.clock.runFor(0);
  assert.equal(await page.evaluate(() => __ts.state), 'playing');
  assert.ok(await page.evaluate(() => __ts.topArea) >= full * .49, 'Continue actually repairs the thin tower');
  await drop(page, 6.9); await page.clock.runFor(650);
  assert.equal(await page.locator('#over').isVisible(), true);
  assert.equal(await page.locator('#popup').evaluate(e => e.classList.contains('show')), false);
  assert.equal(await page.locator('#finalScore').textContent(), '13');
  await context.close();
});
