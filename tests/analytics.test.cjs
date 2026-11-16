const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync('src/game.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const flush = () => new Promise(setImmediate);
async function boot(options = {}) {
  const calls = [], events = {}, storage = new Map(Object.entries(options.storage || {}));
  const state = { modes: '1111', status: 'OBTAINED', canRequestAds: true, form: false, fail: '', purchases: [], reward: true, shown: true, transaction: null, ...options };
  const listeners = {};
  let now = Date.now();
  const record = (plugin, method, args) => { calls.push({ plugin, method, args }); if (state.fail === method) throw Error('unavailable'); };
  const firebase = Object.fromEntries(['setEnabled', 'setConsent', 'logEvent'].map(method => [method, async args => { record('FirebaseAnalytics', method, args); }]));
  firebase.getAppInstanceId = async () => ({ appInstanceId: 'test-installation' });
  const info = () => ({ status: state.status, canRequestAds: state.canRequestAds, isConsentFormAvailable: state.form, privacyOptionsRequirementStatus: 'REQUIRED' });
  const plugins = {
    FirebaseAnalytics: firebase,
    AnalyticsConsent: { getConsentModes: async () => { record('AnalyticsConsent', 'getConsentModes'); return { values: state.modes }; } },
    AdMob: {
      requestConsentInfo: async args => { assert.equal(context.window.Analytics.enabled(), false, 'collection stops before every UMP update'); record('AdMob', 'requestConsentInfo', args); return info(); },
      showConsentForm: async () => { record('AdMob', 'showConsentForm'); state.status = state.formStatus || 'OBTAINED'; state.modes = state.formModes || '2221'; return info(); },
      showPrivacyOptionsForm: async () => { assert.equal(context.window.Analytics.enabled(), false); record('AdMob', 'showPrivacyOptionsForm'); state.modes = state.privacyModes || '2222'; },
      initialize: async args => record('AdMob', 'initialize', args),
      prepareRewardVideoAd: async args => record('AdMob', 'prepareRewardVideoAd', args),
      prepareInterstitial: async args => record('AdMob', 'prepareInterstitial', args),
      resetConsentInfo: async () => { assert.equal(context.window.Analytics.enabled(), false); record('AdMob', 'resetConsentInfo'); state.modes = ''; state.status = 'NOT_REQUIRED'; state.form = false; },
      showRewardVideoAd: async () => { record('AdMob', 'showRewardVideoAd'); if (state.reward) listeners.onRewardedVideoAdReward?.({ amount: 1 }); listeners.onRewardedVideoAdDismissed?.(); return { amount: 1 }; },
      showInterstitial: async () => { record('AdMob', 'showInterstitial'); if (state.shown) listeners.interstitialAdShowed?.(); listeners.interstitialAdDismissed?.(); },
      addListener: async (name, fn) => { listeners[name] = fn; return { remove() { delete listeners[name]; } }; }
    },
    NativePurchases: {
      getPurchases: async () => { record('NativePurchases', 'getPurchases'); return { purchases: state.purchases }; },
      getProducts: async () => ({ products: [] }),
      purchaseProduct: async args => { record('NativePurchases', 'purchaseProduct', args); return state.transaction; },
      restorePurchases: async () => record('NativePurchases', 'restorePurchases'),
      addListener: async () => ({ remove() {} }), acknowledgePurchase: async () => {}
    }
  };
  if (!storage.has('ss_games')) storage.set('ss_games', '10');
  const elements = { adSim: { hidden: true }, adCount: {}, adClose: { focus() {} } };
  const context = {
    console: { warn() {} }, location: { hash: state.hash || '' },
    Date: class extends Date { static now() { return now; } },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn, ms) { if (ms === 250) queueMicrotask(fn); return 1; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
    localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key), setItem(key, value) { if (state.storageFails) throw Error('storage unavailable'); storage.set(key, value); } },
    document: { getElementById: id => elements[id], hidden: false, addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(e) { events[e.type]?.(); } },
    window: { Capacitor: { getPlatform: () => state.platform || 'ios' }, capacitorExports: { registerPlugin: name => plugins[name] } }
  };
  vm.createContext(context);
  for (let code of scripts.filter(code => ['window.Analytics =', 'window.UMPTest =', 'window.Store =', 'window.Ads ='].some(x => code.includes(x)))) {
    code = code.replace('const ANALYTICS_ALLOWED = false;', `const ANALYTICS_ALLOWED = ${state.allowed !== false};`);
    vm.runInContext(code, context);
  }
  const { Analytics: analytics, Ads: ads, Store: store } = context.window;
  await analytics.ready();
  return { context, state, calls, storage, analytics, ads, store, advance() { now += 200000; },
    async start() { await ads.refreshConsentInfo(); await ads.startup(); await flush(); await analytics.ready(); },
    async logs() { await analytics.ready(); return calls.filter(c => c.method === 'logEvent'); } };
}
for (const platform of ['android', 'ios']) {
  test(`${platform}: fresh UMP grant, Firebase order and advertising restrictions`, async () => {
    const s = await boot({ platform });
    assert.equal(s.analytics.enabled(), false);
    s.analytics.track('level_start');
    await s.start();
    assert.equal(s.analytics.enabled(), true);
    assert.ok(s.calls.findIndex(c => c.method === 'setEnabled') < s.calls.findIndex(c => c.method === 'requestConsentInfo'));
    assert.ok(s.calls.filter(c => c.method === 'setConsent' && c.args.type !== 'ANALYTICS_STORAGE').every(c => c.args.status === 'DENIED'));
    assert.equal((await s.logs()).length, 0, 'no backfill');
    assert.equal(s.analytics.requestId(), 'test-installation');
  });
  test(`${platform}: grant does not depend on ad eligibility; ATT not consulted`, async () => {
    const s = await boot({ platform, canRequestAds: false }); await s.start();
    assert.equal(s.analytics.enabled(), true);
    assert.ok(!s.calls.some(c => c.method === 'initialize'));
  });
}
for (const modes of ['', '1112', '1110', '1114', '111', '11111', '111x', 1111]) {
  test(`missing/denied/unconfigured/malformed ${JSON.stringify(modes)} fails closed`, async () => {
    const s = await boot({ modes, storage: { ss_analytics_consent_v1: 'granted' } }); await s.start();
    assert.equal(s.analytics.enabled(), false);
  });
}
for (const [status, modes, enabled] of [['NOT_REQUIRED', '3333', true], ['NOT_REQUIRED', '2221', true], ['OBTAINED', '3333', false], ['REQUIRED', '1111', false], ['UNKNOWN', '1111', false], ['NOT_REQUIRED', '3332', false], ['NOT_REQUIRED', '3334', false]]) {
  test(`${status} + ${modes}: collection ${enabled}`, async () => {
    const s = await boot({ status, modes }); await s.start();
    assert.equal(s.analytics.enabled(), enabled);
    assert.ok(!s.calls.some(c => c.method === 'showConsentForm'), 'no extra consent prompt');
  });
}
test('returning advertising-only user stays off until real UMP analytics grant', async () => {
  const s = await boot({ modes: '1114', status: 'REQUIRED', form: true });
  await s.start();
  assert.ok(s.calls.some(c => c.method === 'showConsentForm'));
  assert.equal(s.analytics.enabled(), true);
});
test('UMP update failure and native signal failure never enable; later pause removal cannot override', async () => {
  for (const fail of ['requestConsentInfo', 'getConsentModes', 'setConsent']) {
    const s = await boot({ fail }); await s.start();
    assert.equal(s.analytics.enabled(), false);
    await s.analytics.setPaused(false); assert.equal(s.analytics.enabled(), false);
  }
});
test('pause persists, preserves deletion ID, and resuming respects explicit refusal', async () => {
  const s = await boot(); await s.start();
  await s.analytics.setPaused(true);
  assert.equal(s.analytics.enabled(), false); assert.equal(s.storage.get('ss_analytics_paused'), '1');
  assert.equal(s.analytics.requestId(), 'test-installation');
  s.state.modes = '1112'; await s.analytics.setPaused(false);
  assert.equal(s.analytics.enabled(), false);
  const next = await boot({ storage: Object.fromEntries(s.storage), modes: '1112' }); await next.start();
  assert.equal(next.analytics.enabled(), false); assert.equal(next.analytics.requestId(), 'test-installation');
});
test('withdrawal and failed privacy refresh invalidate queued events', async () => {
  for (const fail of ['', 'requestConsentInfo']) {
    const s = await boot(); await s.start();
    s.analytics.track('level_start', { mode: 'endless' });
    s.state.fail = fail;
    await s.ads.showPrivacyOptions();
    assert.equal(s.analytics.enabled(), false);
    assert.equal((await s.logs()).length, 0);
    assert.equal(s.analytics.requestId(), 'test-installation');
  }
});
test('ordinary tester and browser preview never measure, including stale local opt-in', async () => {
  for (const options of [{ allowed: false }, { platform: 'web' }, { hash: '#shots' }]) {
    const s = await boot({ ...options, storage: { ss_analytics_consent_v1: 'granted' } });
    await s.start(); s.analytics.track('level_start');
    assert.equal(s.analytics.enabled(), false); assert.equal((await s.logs()).length, 0);
  }
});
test('event names and fields are allowlisted; no free text or receipts', async () => {
  const s = await boot(); await s.start();
  s.analytics.track('anything', { email: 'private' });
  s.analytics.track('level_end', { mode: 'arbitrary', level_name: 'heart', score: NaN, success: 1, receipt: 'private', elapsed_seconds: 12.4 });
  const logs = await s.logs(); assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(logs[0].args)), { name: 'level_end', params: { level_name: 'heart', success: 1, elapsed_seconds: 12 } });
});
test('verified fresh purchase only; no simulated purchase, restore, old ownership, pending or fallback', async () => {
  for (const platform of ['android', 'ios']) {
    const s = await boot({ platform }); await s.start();
    s.state.transaction = { productIdentifier: 'shapescraper_no_ads', purchaseState: '1', purchaseDate: new Date(Date.now() - (platform === 'android' ? new Date().getTimezoneOffset() * 60000 : 0)).toISOString().replace(/\.\d{3}Z$/, 'Z'), transactionId: 'fresh' };
    assert.equal(await s.store.buy('noAds'), 'bought');
    await s.store.buy('noAds'); await s.store.restore();
    assert.equal((await s.logs()).filter(c => c.args.name === 'purchase_completed').length, 1);
    for (const patch of [{ purchaseState: '2', productIdentifier: 'shapescraper_unlock_all' }, { purchaseDate: '2020-01-01', productIdentifier: 'shapescraper_unlock_all' }, { transactionId: '', productIdentifier: 'shapescraper_unlock_all' }]) {
      s.state.transaction = { ...s.state.transaction, ...patch }; await s.store.buy('allShapes');
    }
    s.state.fail = 'purchaseProduct'; await s.store.buy('allShapes');
    assert.equal((await s.logs()).filter(c => c.args.name === 'purchase_completed').length, 1);
  }
});
test('only real reward/display callbacks count; buyer free grant is not a viewed ad', async () => {
  const s = await boot(); await s.start();
  await s.ads.showRewarded();
  s.state.reward = false; await s.ads.showRewarded(); // returned amount alone must not count
  s.advance(); await s.ads.maybeInterstitial(4);
  s.advance(); s.state.shown = false; await s.ads.maybeInterstitial(6);
  s.state.purchases = [{ productIdentifier: 'shapescraper_no_ads', purchaseState: '1' }]; await s.store.refresh();
  await s.ads.showRewarded({ free: true });
  const logs = await s.logs();
  assert.equal(logs.filter(c => c.args.name === 'rewarded_ad_completed').length, 1);
  assert.equal(logs.filter(c => c.args.name === 'interstitial_ad_shown').length, 1);
});
test('private reset suspends collection first; same UMP options on refresh and privacy', async () => {
  const s = await boot(); await s.start();
  assert.throws(() => s.context.window.UMPTest.save(1, ''), /device ID/);
  s.context.window.UMPTest.save(1, 'A'.repeat(32));
  await s.ads.showPrivacyOptions();
  const last = s.calls.filter(c => c.method === 'requestConsentInfo').at(-1).args;
  assert.equal(last.debugGeography, 1); assert.equal(last.testDeviceIdentifiers[0], 'A'.repeat(32));
  await s.ads.resetConsentForTest();
  assert.ok(s.calls.some(c => c.method === 'resetConsentInfo'));
  assert.equal(s.analytics.enabled(), false); assert.equal(s.analytics.requestId(), 'test-installation');
});
test('native cold-start setup disables persisted collection before bridge/UMP; no claims about device traffic', () => {
  const java = readFileSync('android/app/src/main/java/com/beno74/shapescraper/ShapescraperApplication.java', 'utf8');
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const swift = readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
  assert.match(java, /setAnalyticsCollectionEnabled\(false\)/);
  assert.match(manifest, /FirebaseInitProvider[\s\S]*?tools:node="remove"/);
  assert.match(swift, /Analytics.setAnalyticsCollectionEnabled\(false\)/);
  assert.match(readFileSync('ios/App/App/Info.plist', 'utf8'), /GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED<\/key><false\/>/);
  assert.match(manifest, /google_analytics_adid_collection_enabled" android:value="false"/);
});
