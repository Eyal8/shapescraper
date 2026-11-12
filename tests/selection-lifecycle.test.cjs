// Build first. PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/selection-lifecycle.test.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
const errors = [];
before(async () => { browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }); });
after(async () => { await browser?.close(); assert.deepEqual(errors, [], 'no uncaught errors or promise rejections'); });
async function fixture(seed = {}, options = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  page.recoveries = [];
  page.on('console', m => { if (m.text() === 'Restoring missing moving block') page.recoveries.push(m.text()); });
  await page.addInitScript(seed => {
    if (!localStorage.getItem('_selection_qa')) {
      Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      localStorage.setItem('_selection_qa', '1');
    }
  }, { ss_tut_done: 1, ss_games: 6, ss_allshapes: 1, ss_modes_unlocked: ['time', 'daily'], ss_intro_daily: 1, ts_muted: 1, ss_haptics: 0, ...seed });
  await page.clock.install({ time: '2026-11-12T12:00:00Z' });
  await page.goto(pathToFileURL(resolve('www/index.html')).href + '#shots');
  await page.waitForFunction(() => window.__ts && !document.querySelector('.hud').inert);
  await page.clock.pauseAt('2026-11-12T12:01:00Z');
  return { page, context };
}
const picker = mode => `[data-page="${mode}"] [data-picker]`;
const button = (mode, shape, copy = 1) => `${picker(mode)} [data-shape="${shape}"][data-copy="${copy}"]`;
async function menu(page, mode, shape) {
  await page.evaluate(([m, s]) => __ts.menu(m, s), [mode, shape]);
  await page.clock.runFor(400); // layout/scroll events from entering menu finish
}
const play = (page, mode) => page.locator(`[data-page="${mode}"] [data-play]`).dispatchEvent('click');
const drop = (page, off) => page.evaluate(off => { __ts.setOff(off); __ts.place(); }, off);
async function liveRun(page, mode, shape) {
  const initial = await page.evaluate(() => ({ shape: __ts.runShape, mode: __ts.mode, state: __ts.state, outline: __ts.baseOutline, local: __ts.moving?.local, off: __ts.moving?.off, time: __ts.remainingTime, score: __ts.score }));
  assert.equal(initial.state, 'playing'); assert.equal(initial.mode, mode); assert.equal(initial.shape, shape);
  assert.ok(initial.local, 'moving geometry exists');
  const local = initial.local[0][0], base = initial.outline[0][0];
  assert.equal(local.length, base.length);
  assert.ok(local.every(([x, z], i) => Math.abs((x - local[0][0]) - (base[i][0] - base[0][0])) < 1e-8 && Math.abs((z - local[0][1]) - (base[i][1] - base[0][1])) < 1e-8), 'moving outline matches selected base, allowing its local translation');
  const sides = { square: 4, circle: 48, triangle: 3, pentagon: 5, hexagon: 6, octagon: 8, cross: 12, heart: 48, star: 10 };
  assert.equal(initial.outline[0][0].length, sides[shape]);
  await page.clock.runFor(700); // every old animation/debounce has had time to fire
  const late = await page.evaluate(() => ({ shape: __ts.runShape, state: __ts.state, off: __ts.moving?.off, time: __ts.remainingTime, outline: __ts.baseOutline, score: __ts.score }));
  assert.equal(late.state, 'playing'); assert.equal(late.shape, shape); assert.notEqual(late.off, undefined);
  assert.notEqual(late.off, initial.off, 'block keeps moving'); assert.deepEqual(late.outline, initial.outline, 'late callbacks did not replace tower');
  if (mode === 'time') assert.ok(late.time < initial.time && late.time > initial.time - 1, 'timer accompanies live movement');
  await page.evaluate(() => __ts.setOff(0));
  await page.locator('#c').dispatchEvent('pointerdown');
  assert.equal(await page.evaluate(() => __ts.score), initial.score + 1, 'real input places the block');
  assert.ok(await page.evaluate(() => !!__ts.moving));
  assert.deepEqual(page.recoveries, [], 'selection fix works without invoking fallback recovery');
}
for (const [mode, from, to, count] of [['time', 'triangle', 'circle', 10], ['endless', 'circle', 'square', 1], ['endless', 'square', 'circle', 1]]) {
  test(`immediate PLAY: ${mode} ${from} -> ${to} (${count} repeats)`, async () => {
    const { page, context } = await fixture();
    for (let i = 0; i < count; i++) {
      await menu(page, mode, from);
      await page.evaluate(([m, s]) => {
        document.querySelector(`[data-page="${m}"] [data-shape="${s}"][data-copy="1"]`).click();
        document.querySelector(`[data-page="${m}"] [data-play]`).click();
      }, [mode, to]);
      await liveRun(page, mode, to);
    }
    await context.close();
  });
}
test('all unlocked shapes, rapid taps, animation frames, clone wraparound and Reduced Motion', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { page, context } = await fixture({}, { reducedMotion });
    for (const [i, to] of ['triangle', 'pentagon', 'hexagon', 'octagon', 'cross', 'heart', 'star', 'square', 'circle'].entries()) {
      await menu(page, 'endless', 'square');
      await page.locator(button('endless', 'triangle')).dispatchEvent('click');
      await page.locator(button('endless', to, i % 3)).dispatchEvent('click');
      await page.clock.runFor([0, 16, 128, 255, 300][i % 5]);
      assert.equal(await page.evaluate(() => __ts.shape), to, 'last tap committed promptly');
      await play(page, 'endless'); await liveRun(page, 'endless', to);
    }
    await context.close();
  }
});
test('native scroll pending at PLAY resolves its centre, including clones; held gesture waits', async () => {
  const { page, context } = await fixture();
  for (const copy of [0, 1, 2]) {
    await menu(page, 'time', 'triangle');
    await page.locator(picker('time')).dispatchEvent('pointerdown', { pointerType: 'touch' });
    await play(page, 'time'); assert.equal(await page.evaluate(() => __ts.state), 'menu');
    await page.locator(picker('time')).evaluate((p, copy) => {
      const el = p.querySelector(`[data-shape="circle"][data-copy="${copy}"]`);
      p.scrollLeft = el.offsetLeft - (p.clientWidth - el.offsetWidth) / 2;
      p.dispatchEvent(new Event('scroll'));
    }, copy);
    await page.locator(picker('time')).dispatchEvent('pointercancel', { pointerType: 'touch' }); // native scroll takes pointer ownership
    await play(page, 'time'); await liveRun(page, 'time', 'circle');
  }
  await context.close();
});
test('mouse drag, interrupted slide and late input cannot mutate a run; mode switching keeps selection', async () => {
  const { page, context } = await fixture();
  await menu(page, 'endless', 'square');
  await page.locator(button('endless', 'triangle')).dispatchEvent('click');
  await page.clock.runFor(32);
  await page.locator(picker('endless')).dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0, clientX: 180 });
  const dragX = await page.locator(picker('endless')).evaluate(p => {
    const el = p.querySelector('[data-shape="circle"][data-copy="1"]');
    return 180 + p.scrollLeft - (el.offsetLeft - (p.clientWidth - el.offsetWidth) / 2);
  });
  await page.locator(picker('endless')).dispatchEvent('pointermove', { clientX: dragX });
  await page.locator(picker('endless')).dispatchEvent('pointerup');
  assert.equal(await page.evaluate(() => __ts.shape), 'circle');
  await page.locator('[data-mode="time"]').dispatchEvent('click');
  await page.locator(button('time', 'pentagon')).dispatchEvent('click');
  await page.locator('[data-mode="endless"]').dispatchEvent('click');
  await play(page, 'endless');
  await page.locator(button('endless', 'square')).dispatchEvent('click');
  await page.locator('[data-mode="daily"]').dispatchEvent('click');
  await page.locator(picker('endless')).dispatchEvent('scroll');
  await liveRun(page, 'endless', 'pentagon');
  await context.close();
});
test('locked target is committed before trial eligibility; loading cannot change mode or shape', async () => {
  const { page, context } = await fixture({ ss_allshapes: 0 });
  await menu(page, 'endless', 'square');
  await page.evaluate(() => { window.__rewards = 0; Ads.showRewarded = () => { __rewards++; return new Promise(r => window.__reward = r); }; });
  await page.locator(button('endless', 'circle')).dispatchEvent('click');
  await play(page, 'endless');
  assert.equal(await page.evaluate(() => __rewards), 1);
  await page.locator(button('endless', 'triangle')).dispatchEvent('click');
  await page.locator('[data-mode="time"]').dispatchEvent('click');
  await play(page, 'endless');
  assert.equal(await page.evaluate(() => __rewards), 1);
  await page.evaluate(() => __reward(false));
  assert.equal(await page.evaluate(() => __ts.state), 'menu');
  await play(page, 'endless'); await page.evaluate(() => __reward(true));
  await liveRun(page, 'endless', 'circle');
  assert.equal(await page.evaluate(() => localStorage.getItem('ss_unlocked')), null, 'trial does not grant ownership');
  await drop(page, 6.9); await page.clock.runFor(650);
  await page.locator('#againBtn').dispatchEvent('click'); await page.clock.runFor(0);
  assert.equal(await page.evaluate(() => __rewards), 3, 'replay requires a fresh trial reward');
  await page.evaluate(() => __reward(true)); await liveRun(page, 'endless', 'circle');
  await context.close();
});
test('rapid selection supports miss, results, replay, return to menu and persisted selection', async () => {
  const { page, context } = await fixture();
  await menu(page, 'endless', 'triangle');
  await page.locator(button('endless', 'circle')).dispatchEvent('click'); await play(page, 'endless');
  await liveRun(page, 'endless', 'circle');
  await drop(page, 6.9); await page.clock.runFor(650);
  assert.equal(await page.locator('#finalScore').textContent(), '1');
  await page.locator('#againBtn').dispatchEvent('click'); await page.clock.runFor(0);
  await liveRun(page, 'endless', 'circle');
  await drop(page, 6.9); await page.clock.runFor(650);
  await page.locator('#menuBtn').dispatchEvent('click'); await page.clock.runFor(400);
  assert.equal(await page.evaluate(() => __ts.shape), 'circle');
  await page.clock.resume();
  await page.reload(); await page.waitForFunction(() => window.__ts && !document.querySelector('.hud').inert);
  assert.deepEqual(await page.evaluate(() => [__ts.mode, __ts.shape]), ['endless', 'circle']);
  await context.close();
});
test('Daily starts during a shape/mode slide, completes once, and Time Attack expiry remains terminal', async () => {
  const { page, context } = await fixture();
  await menu(page, 'endless', 'triangle');
  await page.locator(button('endless', 'circle')).dispatchEvent('click');
  await page.locator('[data-mode="daily"]').dispatchEvent('click');
  const dailyShape = await page.evaluate(() => __ts.runShape);
  await play(page, 'daily'); await liveRun(page, 'daily', dailyShape);
  await page.evaluate(() => { for (let i = 0; i < 50 && __ts.state === 'playing'; i++) { __ts.setOff(0); __ts.place(); } });
  const games = await page.evaluate(() => localStorage.getItem('ss_games'));
  await page.clock.runFor(2100); assert.equal(await page.evaluate(() => __ts.state), 'over');
  assert.equal(await page.evaluate(() => localStorage.getItem('ss_games')), games);
  assert.equal(await page.locator('#celebrate').isVisible(), true);
  await page.locator('#menuBtn').dispatchEvent('click');
  await page.locator('[data-mode="time"]').dispatchEvent('click');
  await play(page, 'time'); await page.evaluate(() => __ts.timeLeft(0.02));
  await page.clock.runFor(800);
  assert.equal(await page.evaluate(() => __ts.state), 'over');
  assert.equal(await page.locator('#finalScore').textContent(), '0');
  assert.equal(await page.evaluate(() => !!__ts.moving), false);
  await context.close();
});
test('missing block recovers the next block once without resetting score, timer or rewards', async () => {
  const { page, context } = await fixture();
  await menu(page, 'time', 'circle'); await play(page, 'time');
  await drop(page, 0); await drop(page, 0);
  const before = await page.evaluate(() => ({ score: __ts.score, area: __ts.topArea, time: __ts.remainingTime, saved: { ...localStorage } }));
  await page.evaluate(() => __ts.loseMoving()); await page.clock.runFor(32);
  assert.equal(await page.evaluate(() => __ts.score), before.score);
  assert.equal(await page.evaluate(() => __ts.topArea), before.area);
  assert.ok(await page.evaluate(() => __ts.moving?.lvl) === 3);
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), before.saved);
  assert.ok(await page.evaluate(() => __ts.remainingTime) <= before.time);
  const off = await page.evaluate(() => __ts.moving.off); await page.clock.runFor(100);
  assert.notEqual(await page.evaluate(() => __ts.moving.off), off);
  await drop(page, 0); assert.equal(await page.evaluate(() => __ts.score), 3);
  assert.equal(page.recoveries.length, 1, 'only the injected loss invokes recovery');
  await context.close();
});

test('past Daily reward belongs to requested day; changing date or closing calendar cannot start a stale run', async () => {
  const { page, context } = await fixture();
  await menu(page, 'daily', 'square');
  await page.locator('#calBtn').dispatchEvent('click');
  const past = await page.locator('#calGrid .day:not([disabled]):not(.today)').evaluateAll(els => els.slice(-2).map(e => e.dataset.day));
  assert.equal(past.length, 2);
  await page.evaluate(() => { Ads.showRewarded = () => new Promise(r => window.__reward = r); });
  await page.locator(`[data-day="${past[0]}"]`).dispatchEvent('click');
  await page.locator('#calPlay').dispatchEvent('click');
  await page.locator(`[data-day="${past[1]}"]`).dispatchEvent('click');
  await page.locator('#calClose').dispatchEvent('click');
  await page.evaluate(() => __reward(true));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ss_days')));
  assert.equal(saved[past[0]]?.unlocked, true, 'reward grants exactly the requested day');
  assert.equal(saved[past[1]]?.unlocked, undefined, 'other day is never overwritten or granted');
  assert.equal(await page.evaluate(() => __ts.state), 'menu', 'dismissed calendar does not restart gameplay');
  await context.close();
});
