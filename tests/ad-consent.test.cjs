const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync('src/game.html', 'utf8');
const source = html.slice(html.indexOf('window.Ads ='), html.indexOf('</script>', html.indexOf('window.Ads =')));
const info = (canRequestAds, extra = {}) => ({ canRequestAds, privacyOptionsRequirementStatus: 'REQUIRED', ...extra });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function setup(overrides = {}, platform = 'ios', autoStart = true) {
  const calls = [], timers = [], listeners = {};
  const plugin = {};
  for (const name of ['initialize', 'requestConsentInfo', 'showConsentForm', 'showPrivacyOptionsForm',
    'prepareRewardVideoAd', 'prepareInterstitial', 'requestTrackingAuthorization']) {
    plugin[name] = async (...args) => {
      calls.push(name);
      return overrides[name] ? overrides[name](...args) : info(true);
    };
  }
  plugin.addListener = async (name, fn) => { listeners[name] = fn; return { remove() {} }; };
  plugin.showRewardVideoAd = async () => {
    calls.push('showRewardVideoAd');
    if (overrides.showRewardVideoAd) return overrides.showRewardVideoAd();
    listeners.onRewardedVideoAdReward({ amount: 1 });
    listeners.onRewardedVideoAdDismissed();
    return { amount: 1 };
  };
  const events = {};
  const window = { Capacitor: { getPlatform: () => platform },
    capacitorExports: { registerPlugin: () => plugin }, Store: { noAds: () => false } };
  vm.runInNewContext(source, { window, console: { warn() {} }, Event: class { constructor(type) { this.type = type; } },
    document: { dispatchEvent(e) { events[e.type]?.(); }, addEventListener(n, fn) { events[n] = fn; },
      getElementById: () => ({ hidden: true }) }, localStorage: { getItem: () => '10' },
    Date, clearTimeout() {}, setTimeout(fn, ms) { if (ms === 250) queueMicrotask(fn); else timers.push(fn); } });
  if (autoStart) window.Ads.startup();
  return { ads: window.Ads, calls, timers, window };
}
for (const platform of ['ios', 'android']) {
  test(`${platform}: SDK eligibility gates initialization and all ad loads`, async () => {
    const s = setup({ requestConsentInfo: () => info(false) }, platform);
    await flush();
    assert.equal(await s.ads.showRewarded(), false);
    await s.ads.maybeInterstitial(4);
    assert.deepEqual(s.calls, ['requestConsentInfo']);
    assert.equal(s.ads.privacyRequired(), true);
  });
  test(`${platform}: form completes before SDK initialization; UMP owns ATT`, async () => {
    const s = setup({ requestConsentInfo: () => info(false, { status: 'NOT_REQUIRED', isConsentFormAvailable: true }),
      showConsentForm: () => info(true) }, platform);
    await flush();
    assert.deepEqual(s.calls, ['requestConsentInfo', 'showConsentForm', 'initialize', 'prepareRewardVideoAd', 'prepareInterstitial']);
  });
}
test('pending consent cannot be bypassed by a rewarded action', async () => {
  const pending = deferred();
  const s = setup({ requestConsentInfo: () => pending.promise });
  assert.equal(await s.ads.showRewarded(), false);
  pending.resolve(info(true));
  await flush();
  assert.equal(s.calls.filter(c => c === 'initialize').length, 1);
});
for (const method of ['requestConsentInfo', 'showConsentForm', 'initialize']) {
  test(`${method} error disables ads and preserves buyer free rewards`, async () => {
    const s = setup({ requestConsentInfo: () => info(true, { isConsentFormAvailable: true }),
      [method]: () => { throw Error('offline or unavailable'); } });
    await flush();
    assert.equal(await s.ads.showRewarded(), false);
    assert.ok(!s.calls.includes('prepareRewardVideoAd'));
    s.window.Store.noAds = () => true;
    assert.equal(await s.ads.showRewarded({ free: true }), true);
  });
}
test('missing canRequestAds is not treated as permission', async () => {
  const s = setup({ requestConsentInfo: () => ({ status: 'OBTAINED' }) });
  await flush();
  assert.equal(await s.ads.showRewarded(), false);
  assert.ok(!s.calls.includes('initialize'));
});
test('returning eligible user skips unavailable form and receives rewarded reward', async () => {
  const s = setup();
  await flush();
  assert.equal(await s.ads.showRewarded(), true);
  assert.equal(s.calls.filter(c => c === 'initialize').length, 1);
  assert.ok(!s.calls.includes('showConsentForm'));
});
test('concurrent reward preloads share a single native request', async () => {
  const load = deferred();
  const s = setup({ prepareRewardVideoAd: () => load.promise });
  await flush();
  const first = s.ads.showRewarded();
  assert.equal(s.calls.filter(c => c === 'prepareRewardVideoAd').length, 1);
  load.resolve();
  assert.equal(await first, true);
});
test('privacy change invalidates old loaded ads and rechecks SDK eligibility', async () => {
  let allowed = true;
  const s = setup({ requestConsentInfo: () => info(allowed) });
  await flush();
  allowed = false;
  await s.ads.showPrivacyOptions();
  assert.equal(await s.ads.showRewarded(), false);
  allowed = true;
  await s.ads.showPrivacyOptions();
  await flush();
  assert.equal(s.calls.filter(c => c === 'initialize').length, 1);
  assert.equal(s.calls.filter(c => c === 'prepareRewardVideoAd').length, 2);
});
test('privacy form cannot open twice, and in-flight old ads cannot survive revocation', async () => {
  const load = deferred(), form = deferred();
  let allowed = true;
  const s = setup({ requestConsentInfo: () => info(allowed), prepareRewardVideoAd: () => load.promise,
    showPrivacyOptionsForm: () => form.promise });
  await flush();
  const changing = s.ads.showPrivacyOptions();
  await s.ads.showPrivacyOptions();
  assert.equal(await s.ads.showRewarded(), false);
  await flush();
  assert.equal(s.calls.filter(c => c === 'showPrivacyOptionsForm').length, 1);
  load.resolve();
  allowed = false;
  form.resolve();
  await changing;
  assert.equal(await s.ads.showRewarded(), false);
});
test('privacy form failure leaves ads disabled and choices accessible', async () => {
  const s = setup({ showPrivacyOptionsForm: () => { throw Error('form error'); } });
  await flush();
  await s.ads.showPrivacyOptions();
  assert.equal(await s.ads.showRewarded(), false);
  assert.equal(s.ads.privacyRequired(), true);
});
test('scheduled ad retry respects subsequent privacy revocation', async () => {
  let allowed = true;
  const s = setup({ requestConsentInfo: () => info(allowed),
    prepareRewardVideoAd: () => { throw Error('no fill'); } });
  await flush();
  allowed = false;
  await s.ads.showPrivacyOptions();
  const before = s.calls.length;
  s.timers.forEach(fn => fn());
  await flush();
  assert.equal(s.calls.length, before);
});

test('startup is explicitly sequenced after intro and runs once', async () => {
  const form = deferred();
  const s = setup({ requestConsentInfo: () => info(false, { isConsentFormAvailable: true }),
    showConsentForm: () => form.promise }, 'ios', false);
  await flush();
  assert.deepEqual(s.calls, [], 'no form or ads during the studio intro');
  const first = s.ads.startup();
  assert.equal(s.ads.startup(), first);
  await flush();
  assert.equal(s.ads.isOpen(), true);
  assert.deepEqual(s.calls, ['requestConsentInfo', 'showConsentForm']);
  form.resolve(info(false)); // refusal still completes startup
  await first;
  assert.equal(s.ads.isOpen(), false);
  assert.ok(!s.calls.includes('initialize'));
});
test('timed-out consent refresh cannot present a late form or request ads', async () => {
  const request = deferred();
  const s = setup({ requestConsentInfo: () => request.promise });
  s.timers[0](); // request watchdog, before any native presentation
  await s.ads.startup();
  request.resolve(info(true, { isConsentFormAvailable: true }));
  await flush();
  assert.deepEqual(s.calls, ['requestConsentInfo']);
  assert.equal(s.ads.isOpen(), false);
  assert.equal(await s.ads.showRewarded(), false);
});
test('ad initialization cannot hold the consent/play boundary indefinitely', async () => {
  const init = deferred();
  const s = setup({ initialize: () => init.promise });
  await s.ads.startup();
  assert.equal(s.ads.isOpen(), false);
  const reward = s.ads.showRewarded();
  assert.deepEqual(s.calls, ['requestConsentInfo', 'initialize']);
  s.timers.at(-1)(); // initialization watchdog; no late initialization may load ads
  assert.equal(await reward, false);
  init.resolve();
  await flush();
  assert.ok(!s.calls.includes('prepareRewardVideoAd'));
});

test('launch refresh is non-presenting and shared with the later consent boundary', async () => {
  const request = deferred();
  const s = setup({ requestConsentInfo: () => request.promise }, 'ios', false);
  const refresh = s.ads.refreshConsentInfo();
  assert.equal(s.ads.refreshConsentInfo(), refresh);
  assert.equal(s.ads.isOpen(), false, 'background consent info cannot freeze gameplay');
  request.resolve(info(false, { isConsentFormAvailable: true }));
  await refresh;
  assert.deepEqual(s.calls, ['requestConsentInfo']);
  await s.ads.startup();
  assert.equal(s.calls.filter(c => c === 'requestConsentInfo').length, 1);
  assert.equal(s.calls.filter(c => c === 'showConsentForm').length, 1);
});

test('reward waits for native initialization and then the shared rewarded preload', async () => {
  const init = deferred(), load = deferred();
  const s = setup({ initialize: () => init.promise, prepareRewardVideoAd: () => load.promise });
  await s.ads.startup();
  const reward = s.ads.showRewarded();
  await flush();
  assert.ok(!s.calls.includes('prepareRewardVideoAd'));
  init.resolve();
  await flush();
  assert.equal(s.calls.filter(c => c === 'prepareRewardVideoAd').length, 1);
  assert.ok(!s.calls.includes('showRewardVideoAd'));
  load.resolve();
  assert.equal(await reward, true);
  assert.equal(s.calls.filter(c => c === 'initialize').length, 1);
});

test('rewarded preload timeout returns no reward and cannot show a late ad', async () => {
  const load = deferred();
  const s = setup({ prepareRewardVideoAd: () => load.promise });
  await flush();
  const reward = s.ads.showRewarded();
  s.timers[2](); // refresh, initialize, then rewarded preload watchdog
  assert.equal(await reward, false);
  load.resolve();
  await flush();
  assert.ok(!s.calls.includes('showRewardVideoAd'));
});

test('native show rejection without an event resolves promptly without a reward', async () => {
  const s = setup({ showRewardVideoAd: () => { throw Error('ad expired'); } });
  await flush();
  assert.equal(await s.ads.showRewarded(), false);
});
