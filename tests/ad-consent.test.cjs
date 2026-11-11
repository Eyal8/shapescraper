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
function setup(overrides = {}, platform = 'ios') {
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
    Date, setTimeout(fn, ms) { if (ms === 250) queueMicrotask(fn); else timers.push(fn); } });
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
