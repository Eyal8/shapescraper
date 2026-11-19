// Preserve native child/teen compliance treatment across the wrapper's configuration rebuild.
// No age value crosses this boundary. Fail explicitly if upstream changes the patch site.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../node_modules/@capacitor-community/admob/android/src/main/java/com/getcapacitor/community/admob/AdMob.java');
const marker = '.setAgeRestrictedTreatment(MobileAds.getRequestConfiguration().getAgeRestrictedTreatment())';
let text = fs.readFileSync(file, 'utf8');
if (!text.includes(marker)) {
  const anchor = 'RequestConfiguration requestConfiguration = new RequestConfiguration.Builder()';
  if (text.split(anchor).length !== 2) throw Error('AdMob age-treatment patch needs review: upstream configuration changed');
  text = text.replace(anchor, anchor + '\n                ' + marker);
  fs.writeFileSync(file, text);
}
