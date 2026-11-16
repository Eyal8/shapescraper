const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
function build(env = {}) {
  return spawnSync(process.execPath, ['scripts/build-web.js'], { encoding: 'utf8', env: { ...process.env, ADS_TEST: 'true', ANALYTICS_TEST: 'false', UMP_TEST: 'false', ...env } });
}
test('packaging excludes private UMP overrides from ordinary/store builds and blocks real-ad QA', () => {
  try {
    for (const [env, analytics, ump] of [[{}, false, false], [{ ANALYTICS_TEST: 'true', UMP_TEST: 'true' }, true, true], [{ ADS_TEST: 'false' }, true, false]]) {
      const result = build(env); assert.equal(result.status, 0, result.stderr);
      const html = fs.readFileSync('www/index.html', 'utf8');
      assert.equal(html.includes('const ANALYTICS_ALLOWED = true;'), analytics);
      assert.equal(html.includes('window.UMPTest ='), ump);
      assert.equal(html.includes('ss_ump_test_config'), ump);
      assert.equal(html.includes('id="umpTestChoices"'), ump);
      assert.equal(html.includes("$('umpTestBtn').hidden = false"), ump);
      assert.ok(!html.includes('Share usage analytics'));
      for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
      assert.match(fs.readFileSync('ios/App/App/Info.plist', 'utf8'), new RegExp(`FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED</key><${analytics ? 'false' : 'true'}/>`));
      assert.match(fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8'), new RegExp(`firebase_analytics_collection_deactivated" android:value="${!analytics}"`));
      assert.match(fs.readFileSync('www/GoogleService-Info.plist', 'utf8'), /beno74-shapescraper/);
    }
    for (const env of [{ UMP_TEST: 'true' }, { ADS_TEST: 'false', ANALYTICS_TEST: 'true' }, { ADS_TEST: 'false', UMP_TEST: 'true', ANALYTICS_TEST: 'true' }]) assert.notEqual(build(env).status, 0);
  } finally { assert.equal(build().status, 0); }
});
