# Shapescraper privacy and store declarations — prepared, not submitted

Updated November 17, 2026. [Website draft PR 25](https://github.com/Eyal8/beno-studio-site/pull/25) contains the actual proposed `/privacy/shapescraper` source change and legal-route check update. It explains UMP consent/not-required collection, local pause, pseudonymous installation ID for access/deletion requests, SDK automatic events, device/purchase/IP-derived geography, retention and international processing. Existing AdMob and store disclosures remain. It is version-conditional because analytics is not publicly released. Eyal must approve a merge to the site's main branch. No other game's policy was edited.

The shared studio standard v1.8 already covers the UMP contract and was synced, not independently rewritten. The earlier separate analytics consent draft is superseded. The website terms currently refer to features only where offered; no new terms change is proposed for this analytics integration.

## Actual console actions and remaining work

- Google Play account/app were inspected directly: BENO74 Studios / `com.beno74.shapescraper`, app `4973948027811776225`. A **draft** Data safety update was saved (console confirmed “Your changes have been saved”). Added Purchase history and Other actions as collected, not ephemeral, user-optional, for Analytics. These new analytics-only categories are not marked shared under the provider exception, based on the actual new property's configuration and the verified account processing/sharing facts below. No review submission or publication action was performed.
- Existing App interactions already had Analytics and Advertising/marketing selected and required collection. That existing entry, approximate location, identifiers and AdMob diagnostics were retained; this change does not certify all older AdMob declarations. The deletion-request answer remains unchanged (currently No); reconcile that answer/link with the published analytics request path before final submission. No automatic “deleted within 90 days” claim was added.
- Apple App Store Connect redirected to login (`authResult=FAILED`). No Apple privacy fields were edited. The table below is the prepared delta, not a console update.
- Direct GA evidence for this property/account: Google products & services sharing unchecked; Data Processing Terms accepted September 24, 2026; Google signals off; no advertising integration was created; property ads personalization explicitly disabled in all 307 regions. Account-wide modeling contributions (aggregated/de-identified), technical support and business recommendations remained on and were not changed. Recheck combined provider practices before final publication; do not infer app-wide “not shared” from the new analytics categories.

## Apple App Privacy delta

| Data type | Purpose | Assessment for this implementation |
|---|---|---|
| Identifiers → Device ID | Analytics | App installation identifier; conservatively linked to device/user unless Apple's de-identification conditions are demonstrated |
| Usage Data → Product Interaction | Analytics | Sessions, runs, rewards, ad interactions and engagement |
| User Content → Gameplay Content | Analytics | Scores and run results; no cloud save or save-file upload |
| Purchases → Purchase History | Analytics | Product/purchase outcomes plus eligible SDK automatic purchase details |
| Location → Coarse Location | Analytics | Approximate geography derived by Google from masked IP, not GPS |

Analytics intended “used for tracking”: No, conditional on the final provider/account settings and absence of cross-company advertising linkage. This does not remove AdMob tracking declarations or ATT. “Linked to user” and “tracking” are different questions. Ongoing pseudonymous analytics is not automatically exempt because it can be declined. Match any additional SDK diagnostic fields against the resolved native SDK privacy manifests and Google's disclosure guidance before submission. Do not mark the full app Data Not Collected.

## Google Play Data safety delta

| Data type | Collected | Purpose | Optional within analytics |
|---|---|---|---|
| Device or other IDs | Yes | Analytics | Yes — device pause and UMP choices |
| App activity → App interactions | Yes | Analytics | Yes |
| App activity → Other actions | Yes, gameplay results | Analytics | Yes |
| Financial info → Purchase history | Yes | Analytics | Yes |
| Location → Approximate location | Yes | Analytics | Yes |

Not ephemeral: events are stored for reporting. Google documents TLS for analytics traffic. For a category also collected by AdMob or another required feature, the combined app's optional/required and purpose/sharing answers must reflect all actual uses. Advertising identifiers remain in AdMob disclosures even though Analytics disables its own advertising identifiers.

“Shared”: do not choose No solely because Google provides the SDK. Verify this project's actual data sharing and applicable processing terms before relying on the service-provider exception. Existing AdMob sharing obligations still apply. Account processing review remains open until recorded as verified in `analytics-release.md`.

## Retention and deletion

The draft policy documents event retention of two months and user retention of fourteen months with reset on activity; verify these property defaults before merging. Aggregate reports may remain longer. Do not promise local reset, pause, uninstall or withdrawal deletes server history. The app retains the last Analytics ID so the player can email privacy@beno74.com; handle installation-level requests through the supported Google Analytics deletion process. Do not ask players to send receipts/tokens or unrelated personal information.

## Console publication status

No Apple App Privacy or Play Data safety answer has been changed or submitted in this task. No marketing text or screenshots need revision solely for this integration. Policy merge/deployment and final combined-app store answers remain pending approval/verification; a local document or draft PR is not publication.

## Official guidance

- [Google AdMob Consent Mode settings](https://support.google.com/admob/answer/16053245)
- [UMP basic mode](https://developers.google.com/funding-choices/fc-sdks)
- [Android Consent Mode](https://developers.google.com/admob/android/privacy/consent-mode), [iOS Consent Mode](https://developers.google.com/admob/ios/privacy/consent-mode)
- [Analytics Android disclosures](https://support.google.com/analytics/answer/11582702?hl=en)
- [Firebase Apple disclosures](https://firebase.google.com/docs/ios/app-store-data-collection)
- [Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- [Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

## Evidence and references

Console screenshots are in `artifacts/analytics/` (Firebase project/streams, property ads-personalization restriction, GA account processing and Play saved draft). The full iOS compile log and packaged configuration check are retained there too.

- [Google Play service-provider and anonymous-transfer exceptions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-GB)
- [Google account data sharing and processing roles](https://support.google.com/analytics/answer/1011397)
- [Analytics Android SDK data disclosures](https://support.google.com/analytics/answer/11582702?hl=en)
- [Apple privacy data types and linkage](https://developer.apple.com/app-store/app-privacy-details/)
