# Shapescraper

One-tap 3D stacking game for iOS and Android, built with Three.js + Capacitor, monetized with AdMob.

## Monetization (already wired in)
- **Rewarded "Continue"**: at game over (score 5+), watch an ad to keep your tower and play on. Once per run.
- **Interstitial**: every 3rd game over, at most once per 60 seconds, shown when the player taps "Play again".
- Consent (GDPR/UMP) form and iOS tracking prompt run on launch.
- Ships with **Google's test ad IDs** so nothing can get your account flagged while testing.

## Run it
```
npm install
npm run android   # opens Android Studio
npm run ios       # opens Xcode (Mac only)
```
Or push this folder to a private GitHub repo and use the cloud builds (no Mac needed):
- **android-test-apk**: runs on every push, gives an installable test APK
- **Android release (Play Store bundle)**: signed .aab for Google Play
- **iOS release (TestFlight)**: builds on a cloud Mac and uploads to TestFlight

The launch kit doc lists the secrets each one needs.

## Regenerate art and screenshots
`python3 design/render.py` (icon, splash, feature graphic) then `npx @capacitor/assets generate`;
`python3 design/screens.py` (store screenshots, needs `npm run build` first).

## Ads
Shapescraper's real AdMob IDs are in place (`src/game.html` → `CONFIG`, the Android manifest and the iOS Info.plist).
Store builds (Android release, iOS TestFlight) show **real ads**; local builds and the test APK show **test ads**.
For a local build with real ads: `ADS_TEST=false npm run sync`. Never tap your own real ads.

After editing `src/game.html`, run `npm run sync`.
