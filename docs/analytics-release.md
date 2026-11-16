# Shapescraper Firebase gameplay analytics — implementation and gates

Owner decision: November 16, 2026. Implementation updated November 17. Studio standard v1.8 is synced from the source of truth, after reviewing website PR 23. Reference implementation: Landscraper PR 1, head `e72aefd` (includes `fe990ff`, `4a69990`, and NOT_REQUIRED fix `bb57745`). No code in other games is changed.

## Created for this game

- Firebase project `beno74-shapescraper`, number `900403742111`, Spark/no-cost. No billing upgrade or other Firebase services enabled.
- Android `1:900403742111:android:f077891ae15bce9150e9aa`.
- iOS `1:900403742111:ios:0dd8cd0d487dcfcf50e9aa`.
- Both native app identifiers: `com.beno74.shapescraper`.
- GA4 account Beno Studio `407422411`; separate property `beno74-shapescraper` / `564600762`.
- Streams: Android `16354999065`, iOS `16354994749`. Verified in this project's Firebase integration screen, not inferred from Landscraper.
- Native configuration downloaded using the Firebase connector. No Landscraper config or identifiers reused.

## Collection contract

Firebase native startup configures the app and disables the collection flag persisted from prior processes, before the bridge invokes UMP. Android's automatic FirebaseInitProvider is removed; the Application initializes Firebase explicitly. iOS loads its config from the existing bundled `public/` folder, avoiding extra Xcode resource-file entries. `-ObjC` is passed by iOS build workflows. The installed Capacitor analytics plugin constrains Firebase Apple to compatible 12.x; it is not upgraded across that major version as part of this integration.

JavaScript also disables collection before every UMP refresh, form/reset and privacy change. It only enables after the current update succeeded and native `UMP_consentModeValues` is exactly four digits in 0–4:

- Fourth digit 1 with UMP OBTAINED or NOT_REQUIRED → permitted.
- Fourth digit 3 only with NOT_REQUIRED → permitted, with no additional prompt.
- 0/2/4, missing/malformed, unresolved REQUIRED, failed refresh or native read → off.

`canRequestAds`, ATT and ad personalization do not grant analytics. Firebase AD_STORAGE, AD_USER_DATA and AD_PERSONALIZATION stay denied. Analytics AD_ID/IDFA/IDFV and automatic native screen tracking are disabled; AdMob's own permissions remain intact. No account User-ID, session replay, Auth, Firestore, Remote Config, Crashlytics or BigQuery.

The old separate local opt-in is ignored and its Allow UI removed. Main menu → Gameplay analytics displays collection state, the saved installation ID for privacy requests, and a device pause. Removing pause rechecks the UMP gate; it cannot grant consent. Pause and request ID survive withdrawal. No pre-consent event buffering/backfill. A generation counter invalidates pending events across privacy changes. Native SDK transmission already in progress cannot be recalled.

UMP remains at the existing safe presentation boundary after first-use teaching/play. A silent current-launch UMP info refresh may allow eligible returning/not-required users; missing or offline results do not. Physical cold-start/offline verification is required: JS mocks do not prove native SDK traffic behavior.

## Event schema

| Event | Fields | Trigger |
|---|---|---|
| level_start | mode, level_name (shape) | Normal run or measured run segment begins |
| level_end | mode, level_name, success, score, elapsed_seconds | Final results; a Continue offer is not a final end; success means Daily goal completed |
| run_abandoned | mode, level_name, elapsed_seconds | Measured run replaced or exited through menu; OS termination is not reliably measured |
| rewarded_ad_completed | placement=rewarded | Native reward callback, once after reward flow finishes; no browser simulation or buyer free grant |
| interstitial_ad_shown | ad_format=interstitial | Native display callback, not request/load/dismissal |
| purchase_completed | item_id | Matching fresh verified native purchase response, not previously owned, with transaction ID/date; no fallback refresh, restore, pending, cancellation or failure |

Shapescraper has no life counter, so `life_lost` is intentionally omitted. Tutorial practice is excluded from run metrics. Mode is an enum; shape/product fields are enum-allowlisted; no dates, calendar, tower geometry, save files, free text, receipts/tokens or transaction IDs are sent. Numbers are bounded. Elapsed time counts foreground active play only. Reports cover measured installations, not all players. SDK lifecycle/session and eligible automatic purchase events also exist. Custom purchase/ad events are behavior counts, not additional revenue totals on top of SDK events.

## Builds and private QA

- Default preview/tester build: analytics deactivated in native metadata and disabled in web code, even if an earlier build was permitted. `npm run build` restores safe native source flags.
- Explicit QA: `ANALYTICS_TEST=true UMP_TEST=true npm run build`, then Capacitor sync. Test ads only. ANALYTICS_TEST with real ads, and UMP_TEST without ANALYTICS_TEST, are rejected.
- Future store build uses existing `ADS_TEST=false` only after release gates are approved. No store release is authorized now.
- UMP test module, menu, dialog, region override and saved-device-ID reader are removed from ordinary/store packages. QA controls accept native-log UMP test IDs, Actual/EEA/US/Other, and reset only UMP after suspending analytics. Region forcing requires a registered test ID. Startup/privacy refresh use the same options. Progress, purchases and analytics history are not reset.
- `.github/workflows/analytics-qa.yml` builds Android QA APK and unsigned iOS simulator/device apps, records actual UMP dependency resolution, and performs package checks. No signing cleanup, TestFlight upload or Play upload exists in this workflow.
- Required UMP: Android >=3.2.0; iOS >=3.0.0. Installed wrapper currently requests Android 4.0.0 and iOS 3.1.x. Resolved native evidence must come from CI, not those declarations alone.

## Console verification status

Owner reported both account-wide AdMob Consent Mode toggles enabled/saved on November 16. We did not change them. A real message still must verify Analytics purpose and migration of a returning advertising-consented user. No EU/US/IDFA message, ad unit or cross-app consent setting was replaced.

Firebase project, app registrations, streams, GA4 linkage and Spark plan were directly verified. Google signals was observed off for this property. The property retained its observed defaults: event data 2 months; user data 14 months; reset on new activity enabled. Google products & services sharing was directly observed unchecked in account 407422411. Data Processing Terms showed accepted September 24, 2026. Modeling contributions, technical support and business recommendations remain enabled at account level; those shared-account settings were not changed. Ads personalization was disabled for this new property in all 307 regions and the saved result was verified. Do not use Landscraper notes as evidence for any remaining check. The new analytics-only Play draft categories use the service-provider exception on those verified facts; this is not an app-wide statement about AdMob sharing. Final combined-app disclosure review remains required.

## Privacy and store work

[Website draft PR 25](https://github.com/Eyal8/beno-studio-site/pull/25) updates only Shapescraper's policy and its legal-route assertions. Main deployment requires Eyal's merge approval. The policy is not published. Play Data safety changes were saved separately as a draft, not submitted; Apple fields remain pending login. See `privacy-analytics-update.md` for declaration mappings and remaining checks.

## Validation status

58 targeted tests pass (UMP grant/deny/missing/malformed/not-required, errors, returning user, pause/revoke, purchase/reward/interstitial callbacks and packaging guards). Default web build and Capacitor sync pass for iOS and Android. No browser E2E suite or running simulator was started.

Unsigned iOS Simulator compilation passed locally. [Native QA run 43969243134](https://github.com/Eyal8/shapescraper/actions/runs/43969243134) also passed unsigned Simulator and iPhone device builds plus package/dependency checks. Packaged Firebase project, explicit QA/test-ad flags, native default-off/identifier/advertising restrictions were checked. Actual resolved Firebase Apple: 12.19.3; GoogleAppMeasurement: 12.19.2; iOS UMP: 3.1.0. Native cold-start traffic still needs a device test.

GitHub and Java blockers resolved November 17: the existing macOS GitHub credentials work outside the restricted shell; no credentials or account permissions were changed. Branch published as [draft app PR 9](https://github.com/Eyal8/shapescraper/pull/9), with no merge. Eclipse Temurin 21.0.13+9 was downloaded from its official GitHub release and SHA-256 verified, then unpacked only under `/tmp/shapescraper-java21`; system Java remains unchanged. Set `JAVA_HOME` from `/tmp/shapescraper-java21/java-home.txt` when repeating a local build. CI independently pins Temurin 21.

Android QA `assembleDebug` and the existing app unit-test task passed locally with Java 21; the latter contains one framework example test, not a new native consent integration suite. The 58 targeted analytics tests also passed in CI. [Android native QA job](https://github.com/Eyal8/shapescraper/actions/runs/43969243134/job/133656710228) and the [ordinary analytics-off tester build](https://github.com/Eyal8/shapescraper/actions/runs/43969159219) passed. Actual runtime graph: UMP 4.0.0 and Firebase Analytics 23.0.0. Both local and CI QA APKs were inspected for native collection/advertising defaults, custom startup Application, removed automatic FirebaseInitProvider, compiled AnalyticsConsent bridge, correct Firebase Android app ID and explicit test-ad/QA flags. Evidence and the local QA APK are under `artifacts/analytics/`. No Android device was attached; no app was installed or launched on a device/emulator. Default analytics-off web/native assets were restored after validation.

The purchase event timestamp parser accounts for NativePurchases 8.8.1 Android formatting local time with a literal Z; the iOS timestamp remains UTC, and tests include Asia/Jerusalem.

The Xcode setup helper also hit local Swift sandbox restrictions. The simpler resource solution uses the pre-existing Capacitor public folder and the app's SPM transitive dependencies; the successful native build verifies this arrangement without editing the Xcode project or upgrading Firebase to incompatible 13.x.

## Release gates still required

- Native builds and packaged dependency/flag checks have passed; physical-device runtime verification remains required.
- Physical iOS AND Android: test real UMP messages with test ads, fresh/returning grant/deny, NOT_REQUIRED+3, missing purpose, pause, revoke, failed refresh, and cold launch without network after a previous grant. Use Firebase DebugView. On iPhone enable `-FIRDebugEnabled` via development tools and explicitly finish with `-FIRDebugDisabled`.
- Verify final run counts, Continue, Daily completion/abandonment and sandbox purchases/restores on both platforms.
- Verify GA sharing/processing terms and reconcile combined AdMob/Analytics Apple App Privacy and Play Data safety forms. Publish policy only after approval.
- Applicable regional/minor restrictions remain release checks; UMP NOT_REQUIRED is not universal legal clearance. No new age screen or geolocation system is introduced.
- No app merge, public release, upload to TestFlight/Play or monetization change is authorized by this work.
