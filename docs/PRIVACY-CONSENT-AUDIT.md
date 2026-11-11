# ShapeScraper production privacy and consent audit — 2026-11-11

**Result: confirmed consent defects fixed locally; replacement releases required. Runtime verification remains pending.**

| Platform | Public/candidate build | UMP included | Consent gating before fix | EU message | ATT/IDFA | US privacy | Result |
|---|---|---|---|---|---|---|---|
| iOS | Public 1.0 (36), source `b3cff7e`; latest TestFlight 1.1 (39), `f97c600`, test ads | Source dependency and CI framework evidence; IPA not inspected | Missing `canRequestAds`; SDK initialized first | UMP launch integration exists; delivery unverified | Usage description and explicit ATT call exist; explainer path conditional | No ShapeScraper US message, per owner | BLOCKER; local fix needs release |
| Android | Latest signed AAB 1.1 (37), `f97c600`; test APK workflow run 77 at HEAD | Yes, directly inspected AAB: UMP 4.0.0 | Missing gate in packaged HTML | UMP launch integration exists; delivery unverified | Android AD_ID permission; ATT inapplicable | Same missing console assignment | BLOCKER; replace candidate before distribution |

## Evidence and release identity

- The supplied workspace initially contained only an unborn Git repository. Source was recovered from [Eyal8/shapescraper](https://github.com/Eyal8/shapescraper), onto local branch `codex/privacy-consent-audit`. Baseline HEAD: `cf8c0367504a3dc1b43f5b923c1e96222fc1f7dd`. GitHub exposes only `main`; the Git fetch returned no tags. No remote changes were made.
- [iOS workflow 36](https://github.com/Eyal8/shapescraper/actions/runs/41177802051) checks out `b3cff7ece6be46347b012e27c37370086081cc8a`. Its job records `ADS_TEST=false`, `CURRENT_PROJECT_VERSION=36`, and successful archive/export. That commit has marketing version 1.0 and bundle ID `com.beno74.shapescraper`. This establishes the CI source/configuration associated with build 36; App Store binary identity is based on the owner's build identification, not an independently downloaded IPA.
- Apple's public lookup confirms version 1.0, released November 9, 2026. The [public listing](https://apps.apple.com/us/app/shapescraper-stack-slice/id6826044452) discloses Identifiers for tracking; Coarse Location, Device ID, Product Interaction, Advertising Data, Crash Data and Performance Data under its stated purposes. These broadly cover Google's advertised SDK categories. Whether all data is properly classified as unlinked, and every tracking purpose is correctly declared, cannot be proven from the listing or source alone.
- [Latest iOS workflow 39](https://github.com/Eyal8/shapescraper/actions/runs/41643403737) uses `f97c600a7ad928179b71449ebadd52acc88192e0`, version 1.1, **test ads**. It is not the public binary.
- [Android release workflow 37](https://github.com/Eyal8/shapescraper/actions/runs/41643409675) uses that same commit, versionName 1.1 / versionCode 37, **test ads**. Its existing artifact was downloaded and inspected without building or running it. ZIP SHA-256 matches GitHub's artifact digest: `87937476c908031098bf1ed454455539821e3bf612d999c2cb7fc37cc0760b6f`. Packaged HTML contains `testing: true`, unconditional preloads and no `canRequestAds`. DEX contains UMP and GMA classes; bundled version metadata identifies GMA 25.4.0 and UMP 4.0.0.
- Both release source revisions lock `@capacitor-community/admob` **8.2.1** with identical lockfile integrity. Its iOS SPM dependencies declare GMA **13.11.0 exact**, UMP **3.1.x** (`upToNextMinor` from 3.1.0). The resolved iOS UMP patch is unknown: no retained Package.resolved/IPA was inspected. Build-36 export logs reference both GoogleMobileAds and UserMessagingPlatform frameworks, which supports inclusion but is not binary inspection.
- Android plugin defaults are GMA `25.4.+`, UMP `4.0.0`, with no project overrides. The inspected candidate resolves the GMA range to 25.4.0. Native dependency resolutions in a future build must not be assumed identical.

## Confirmed defects and local changes

**BLOCKER — missing SDK consent gate, both platforms.** Public-build source, current HEAD and inspected Android candidate initialize Mobile Ads before UMP, swallow consent errors, then preload ads regardless of eligibility. Rewarded actions can also preload during a pending startup form. Google requires using SDK `canRequestAds` before ad requests; SDK initialization can also trigger ad-related work. See [iOS UMP guidance](https://developers.google.com/admob/ios/privacy) and [Android UMP guidance](https://developers.google.com/admob/android/privacy).

Fixed in `src/game.html`: request fresh consent information before initialization; present available required forms through UMP; initialize only after explicit SDK eligibility; guard both preload and presentation paths. No persisted custom consent flag, country detection, forced non-personalized mode, geography override or consent reset was added. A transient boolean reflects only the SDK result.

**BLOCKER — privacy changes leave stale ads eligible.** Existing privacy buttons call the SDK but do not refresh eligibility or invalidate already loaded/in-flight ads. Fixed by pausing ad eligibility, clearing ready ads, invalidating old completions, waiting out old loads before requesting replacements, then refreshing SDK information. Duplicate privacy forms and concurrent duplicate preloads are guarded. Existing startup runs once per cold launch, after the first-install intro where applicable.

**IMPORTANT — UMP IDFA message can be bypassed.** Existing code calls the consent form only for `status === REQUIRED`, then independently requests ATT if undetermined. This can skip an available IDFA form in other consent states and ask for ATT after UMP deliberately did not ask. Fixed by routing available forms through the plugin's `loadAndPresentIfRequired` / `loadAndShowConsentFormIfRequired` implementation and removing the extra app-side ATT request. The pinned plugin supports pre-initialization consent on both platforms and explicitly documents UMP ownership of ATT when IDFA messaging is configured. See its installed `docs/consent.md`, native consent executors, [Google IDFA guidance](https://developers.google.com/admob/ios/privacy/idfa), and [message selection rules](https://support.google.com/admob/answer/10114020).

ATT was already part of production behavior and disclosures; no tracking capability was added. GDPR and ATT remain separate decisions managed by UMP/Apple. Existing Info.plist has `NSUserTrackingUsageDescription`: “This lets us show you more relevant ads, which keeps Shapescraper free.” The plugin imports AppTrackingTransparency and exposes the native request. Denial must not disable permitted ads: Google omits IDFA, while UMP eligibility still controls ad requests. ATT is necessary before actual tracking/IDFA access, not just because an explainer exists. See [Apple's tracking requirements](https://developer.apple.com/app-store/user-privacy-and-data-use/).

**BLOCKER for distribution — latest candidates contain test ads.** This is a confirmed build-configuration issue, not a reason to change the safe testing default. Future store-bound workflows must explicitly select `real_ads=true`. Do not distribute Android 37 or iOS 39 as real-ad replacements.

## EU operational status

This is **more than console-only configuration**: both platforms call UMP on cold launch and use native forms. iOS build-36 source and Android's packaged HTML have this integration. However, publishing a message does not establish delivery, and the existing release is unsafe when consent fails or is pending. No device session established that the newly published message appears, nor that network ad requests follow its choices correctly.

Native application IDs used by UMP:

- iOS: `ca-app-pub-5535097818156227~6590416851` (`ios/App/App/Info.plist`).
- Android: `ca-app-pub-5535097818156227~5364965093` (`android/app/src/main/AndroidManifest.xml`).

Confirm those exact AdMob app records have **BENO74 – European Regulations** assigned. Message identity is selected server-side by app ID, not by a name embedded in code. Owner-reported settings were not independently inspected in AdMob. A shared message is suitable; a dedicated message per game is unnecessary.

The existing title/results “Ad privacy choices” buttons are SDK-requirement driven. The fix publishes their visibility as soon as consent info arrives, even if the startup form subsequently fails. Consent refusal does not disable the game. No code assumes every refusal allows ads; only `canRequestAds === true` enables them, with SDK consent signals determining eligible advertising.

## US privacy and owner actions

**IMPORTANT — assign and publish a US state regulations message for both ShapeScraper app records.** Studio standard section 4 explicitly requires this for every app. A shared existing message can be assigned; no new dedicated message is inherently required. Use the correct policy URL, applicable US-state targeting, and review ad partners and restricted data processing choices. The existing required privacy-options entry point is the right integration: Google's US message is generally accessed there, rather than as an EU-style mandatory startup dialog. See [US setup](https://developers.google.com/admob/android/privacy/us-iab-support) and [message locations](https://support.google.com/admob/answer/10114020).

Google Mobile Ads collects/shares advertising-related identifiers, IP-derived location, interactions and diagnostics; direct BENO74 collection is not the only relevant processing. SDK requests use UMP's stored consent/opt-out signals; this app has no custom override of those signals. [Google explains GPP/RDP behavior](https://support.google.com/admob/answer/9561022) and its [iOS](https://developers.google.com/admob/ios/privacy/data-disclosure) / [Android](https://developers.google.com/admob/android/privacy/play-data-disclosure) data disclosures.

A particular Google message is a technical implementation choice, not a universal statutory requirement. Whether BENO74 is legally covered in each state depends on jurisdiction, business thresholds, audience and processing not established by this code audit. Where applicable, targeted-advertising/sale/sharing opt-out rights must be honored. [California's official guidance](https://oag.ca.gov/privacy/ccpa) illustrates coverage and opt-out obligations; it does not determine every state's applicability. Qualified legal review is needed for unresolved coverage, including minor protections; UMP does not infer a player's age merely because the app targets 13+.

Additional owner actions:

1. Verify EU and IDFA message assignments against the exact IDs above. Keep UMP in charge of the iOS prompt; confirm the intended regional message sequence. The shared explainer is supported but its actual delivery is unverified, and existing releases can bypass it.
2. Publish/assign the US message and verify the privacy entry point in a regulated-state test. No console messages or data-processing settings were changed by this audit.
3. Review App Store Connect App Privacy and Play Data safety against actual SDK behavior and resolved versions. The public iOS label already acknowledges tracking and relevant data categories; private questionnaires and Play declarations were not accessible. Do not certify them solely from SDK inclusion.
4. The [live policy](https://beno74.com/privacy/shapescraper) was fetched successfully. It describes AdMob data, UMP, the two privacy entry points and ATT. Clarify its broad “non-personalized ads otherwise” wording to cover SDK eligibility/limited ads/no ads, and document applicable US opt-out choices after configuration. No website edits were made.

## Validation, limitations and minimum release checkpoint

Passed: `node --test tests/ad-consent.test.cjs` (**15 tests**, mocked SDK); `npm run build` (web assets only, test mode); syntax checks of all inline JavaScript; `plutil -lint ios/App/App/Info.plist`; `git diff --check`. Tests cover both platform gates, form ordering including an available non-REQUIRED form, offline/form/init errors, startup races, privacy revocation including in-flight loads and retry timers, duplicate loads/forms, reward settlement and the existing buyer free-reward bypass.

No IPA/AAB was created, no native build, simulator/emulator, device session, broad gameplay suite, upload, submission or publication was performed. Existing Android AAB inspection is static evidence, not runtime consent PASS. Source purchase/unlock rules and gameplay code were not changed.

The plugin rejects consent-update errors without returning cached SDK eligibility. The minimal safe fix disables ads for that launch when it cannot establish eligibility, including returning users offline; gameplay and existing buyer free rewards remain available. After connectivity returns, a cold relaunch refreshes consent; a visible privacy-options action can also refresh after completion. No custom consent cache or native bridge was introduced just to recover offline ad revenue. Native cached-status exposure can be deferred.

**New releases are necessary on both platforms.** Console publication cannot repair packaged consent logic. Minimum replacements: one iOS update containing the fix (current source version 1.1; next build number greater than 39, subject to App Store Connect), and one Android replacement AAB (versionCode greater than the highest uploaded Play version; 38 if 37 is still the highest). Select `real_ads=true` only for the owner-authorized store builds. The existing code-change validation does not authorize building, uploading or publishing.

One consolidated owner QA checkpoint, using test ads on registered test devices and temporary debug geography only in a test configuration:

1. On each platform, fresh EEA startup: accept and refuse in separate reset test cases; confirm no GMA initialization/ad request before UMP eligibility. Core Endless and Daily play remain usable, unavailable rewarded actions give the existing fallback, and rewards settle once when allowed. Verify privacy buttons on title and results.
2. Reopen choices, revoke/alter consent while a preload is pending, then request a rewarded ad: no old cached ad may show; new requests use the current SDK signals/eligibility. Cold relaunch preserves SDK choices without redundant forms or initialization.
3. First launch offline and returning launch offline/form error: no bypass ad requests, gameplay works. Reconnect and cold relaunch refreshes consent.
4. On iOS with undetermined ATT, test EEA and non-EEA UMP message sequences per Google's rules. Test ATT allow/deny/restricted/already-decided states: no extra app-side prompt; denied users can receive eligible ads without IDFA. Capture the shipped plist/SDK resolution from the eventual archive for comparison.
5. In a regulated US-state test on each platform, verify the required privacy entry point presents the assigned US message, opt-out persists and subsequent GPP/RDP/ad behavior respects it. Outside affected regions, entry-point visibility follows UMP.

These are pending release checks, not additional implementation milestones or claims of universal legal compliance.
