const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync(process.env.AGE_TEST_HTML || path.join(__dirname, '../src/game.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const ls = html.includes('window.GameAnalytics =');
const analyticsName = ls ? 'GameAnalytics' : 'Analytics';
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function boot({ platform = 'ios', status = 'notRequired', result = { status: 'resolved', minor: false }, fail = false, canRequestAds = true, pending, missing = false, umpStatus = 'NOT_REQUIRED', modes = '1111', needsForm = false, formModes = '1111' } = {}) {
  const calls = [], storage = new Map();
  const consentState = { status: umpStatus, modes, form: needsForm };
  const record = (method, options) => calls.push({ method, options });
  const regional = {
    async getRequirements() { record('requirements'); if (fail) throw Error('service unavailable'); return pending || { status }; },
    async requestRequiredAgeRange() { record('sharing'); return result; }
  };
  const plugins = {
    RegionalAge: missing ? undefined : regional,
    AnalyticsConsent: { async getConsentModes() { return { values: consentState.modes }; } },
    FirebaseAnalytics: {
      async setEnabled(options) { record('collection', options); },
      async setConsent(options) { record('analyticsConsent', options); },
      async getAppInstanceId() { return { appInstanceId: 'test-installation' }; },
      async logEvent(options) { record('event', options); }
    },
    AdMob: {
      async requestConsentInfo(options) { record('ump', options); return { status: consentState.status, canRequestAds, isConsentFormAvailable: consentState.form }; },
      async showConsentForm() {
        assert.equal(window[analyticsName].enabled(), false, 'collection is off while UMP obtains the new purpose');
        record('consentForm');
        consentState.status = 'OBTAINED'; consentState.modes = formModes; consentState.form = false;
        return { status: consentState.status, canRequestAds, isConsentFormAvailable: false };
      },
      async initialize(options) { record('initialize', options); },
      async prepareRewardVideoAd() { record('rewardLoad'); },
      async prepareInterstitial() { record('interstitialLoad'); },
      async trackingAuthorizationStatus() { return { status: 'notDetermined' }; },
      async requestTrackingAuthorization() { record('att'); }
    }
  };
  const window = { Capacitor: { getPlatform: () => platform, isNativePlatform: () => platform !== 'web' },
    capacitorExports: { registerPlugin: name => plugins[name] }, Store: { noAds: () => false } };
  const context = { window, location: { hash: '' }, console: { warn() {} }, Event: class {}, Promise,
    document: { addEventListener() {}, dispatchEvent() {}, getElementById: () => ({ hidden: true }) },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    setTimeout() { return 1; }, clearTimeout() {}, Date };
  vm.createContext(context);
  for (let code of scripts.filter(code => ['window.AgeAssurance =', `window.${analyticsName} =`, 'window.Ads ='].some(x => code.includes(x)))) {
    code = code.replace('const ANALYTICS_ALLOWED = false;', 'const ANALYTICS_ALLOWED = true;');
    vm.runInContext(code, context);
  }
  const flow = ls ? null : window.Ads.startup();
  await flush();
  return { window, calls, flow, storage, age: window.AgeAssurance, analytics: window[analyticsName] };
}
const count = (s,name) => s.calls.filter(c => c.method === name).length;

test('non-required users never receive an age-sharing request; UMP still controls ads and analytics', async () => {
  const s = await boot();
  assert.equal(s.age.status(), 'notRequired');
  assert.equal(count(s,'requirements'),1);
  assert.equal(count(s,'sharing'),0);
  assert.equal(count(s,'initialize'),1);
  assert.equal(s.analytics.enabled(),true);
  assert.ok(!('tagForUnderAgeOfConsent' in s.calls.find(c=>c.method==='initialize').options));
  const denied = await boot({ canRequestAds: false });
  assert.equal(count(denied,'initialize'),0);
  assert.equal(count(denied,'rewardLoad'),0);
});
test('mandatory sharing resolves once before ad initialization; adults retain the normal consent flow', async () => {
  const s = await boot({ status: 'required' });
  await Promise.all([s.age.ensure(),s.age.ensure()]);
  assert.equal(count(s,'sharing'),1);
  assert.ok(s.calls.findIndex(c=>c.method==='sharing')<s.calls.findIndex(c=>c.method==='initialize'));
  assert.equal(s.analytics.enabled(),true);
});
test('known minors receive per-user privacy flags without optional analytics or an ATT request', async () => {
  for (const childDirected of [false,true]) {
    const s=await boot({status:'required',result:{status:'resolved',minor:true,childDirected}});
    const options=s.calls.find(c=>c.method==='initialize').options;
    assert.ok(!('tagForUnderAgeOfConsent' in options),'native GMA teen treatment must not be overwritten by a legacy child flag');
    assert.ok(!('tagForChildDirectedTreatment' in options));
    if(childDirected)assert.equal(options.maxAdContentRating,'General');
    assert.equal(s.calls.filter(c=>c.method==='ump').at(-1).options.tagForUnderAgeOfConsent,true);
    assert.equal(s.analytics.enabled(),false);
    assert.equal(count(s,'att'),0);
    assert.equal(count(s,'rewardLoad'),1,'teen treatment does not blanket-block ad formats');
    s.analytics.track('level_start',{mode:'campaign',level_name:'test',minor:true});
    await flush();
    assert.equal(count(s,'event'),0);
    assert.equal(s.storage.size,0,'no age signal is persisted');
  }
});
test('declined, unavailable, malformed and unresolved results never become exemption or adult status',async()=>{
  for(const options of [{fail:true},{missing:true},{status:'unavailable'},{status:'invalid'},
    {status:'required',result:{status:'declined'}},{status:'required',result:{status:'unresolved'}},
    {status:'required',result:{status:'resolved'}}]) {
    const s=await boot(options);
    assert.equal(count(s,'initialize'),0);
    assert.equal(count(s,'rewardLoad'),0);
    assert.equal(s.analytics.enabled(),false);
    assert.notEqual(s.age.status(),'notRequired');
  }
});
test('pending silent check cannot enable measurement or ads and never starts a sharing sheet',async()=>{
  let resolve;
  const pending=new Promise(r=>resolve=r);
  const s=await boot({pending});
  assert.equal(count(s,'sharing'),0);
  assert.equal(count(s,'initialize'),0);
  assert.equal(s.analytics.enabled(),false);
  resolve({status:'notRequired'});
  await flush();
  assert.equal(count(s,'initialize'),1);
});
test('older iOS is explicitly unsupported, with no custom age prompt or assumed adult classification',async()=>{
  const s=await boot({status:'unsupported'});
  assert.equal(s.age.status(),'unsupported');
  assert.equal(count(s,'sharing'),0);
  assert.deepEqual(JSON.parse(JSON.stringify(s.age.adOptions())),{});
});
test('Android and web never invoke Apple or optional Google age-sharing APIs',async()=>{
  for(const platform of ['android','web']) {
    const s=await boot({platform});
    assert.equal(count(s,'requirements'),0);
    assert.equal(count(s,'sharing'),0);
    assert.equal(s.age.status(),platform==='android'?'androidPending':'web');
  }
});

for (const platform of ['ios', 'android']) {
  test(`${platform}: returning ads-only consent obtains the analytics purpose through UMP`, async () => {
    for (const granted of [true, false]) {
      const s = await boot({ platform, umpStatus: 'REQUIRED', modes: '1114', needsForm: true,
        formModes: granted ? '1111' : '1112' });
      assert.equal(count(s, 'consentForm'), 1);
      assert.equal(s.analytics.enabled(), granted);
      assert.equal(count(s, 'event'), 0, 'events from before the choice are not buffered');
    }
  });
  test(`${platform}: existing valid analytics consent is reused without a new prompt`, async () => {
    const s = await boot({ platform, umpStatus: 'OBTAINED', modes: '1111' });
    assert.equal(count(s, 'consentForm'), 0);
    assert.equal(s.analytics.enabled(), true);
  });
}
