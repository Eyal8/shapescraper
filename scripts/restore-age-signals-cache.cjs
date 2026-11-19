// Restore the unchanged SDK/POM used by the Nov 19 native tests, privately in CI.
// SHA-256 pins identify that tested copy; they are not a Google digital signature.
// The binary stays out of the public repository and logs. Preserve its POM/license.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const parts = [1, 2, 3].map(n => process.env[`AGE_SIGNALS_005_CACHE_${n}`]);
if (parts.some(part => !part)) throw Error('Verified Age Signals CI cache is not configured');
const payload = JSON.parse(zlib.gunzipSync(Buffer.from(parts.join(''), 'base64'), { maxOutputLength: 300000 }));
const hashes = {
  aar: 'e81896a0f4bd8db3a0b380c3b31c88a1a335e3953fcabf7b5e5b3ec583d45394',
  pom: 'a75d79a8a64b62c2a0cf8b150b013aafef7614d8f1816e78c23e05deeb62ed47'
};
// Validate every file before creating a repository. Never silently use another SDK.
const files = Object.entries(hashes).map(([ext, expected]) => {
  const bytes = Buffer.from(payload[ext], 'base64');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw Error(`Age Signals ${ext} checksum mismatch`);
  }
  return [ext, bytes];
});
const target = path.join(__dirname, '../android/.gradle/age-signals-maven/com/google/android/play/age-signals/0.0.5');
fs.mkdirSync(target, { recursive: true });
for (const [ext, bytes] of files) fs.writeFileSync(path.join(target, `age-signals-0.0.5.${ext}`), bytes);
console.log('Restored hash-pinned Age Signals 0.0.5 AAR and original dependency POM');
