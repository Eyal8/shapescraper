<!-- Synced copy. Do not edit here: the source is beno-studio-site/standards/BENO74-STANDARDS.md -->

# BENO74 Studios: Legal, Privacy, Ads & Branding Standard (v1.3.1, November 3, 2026)

Single source of truth for every BENO74 game (Shapescraper, Pair by Pair, Sorté, Tile Wave, Landscraper and future titles).
Every chat, handoff and coding agent (Claude, Codex) follows this document. A game may deviate only if the deviation is written in its row in section 10 with a reason.
This document defines **behaviour**. SDKs and libraries are chosen per game (Capacitor, Expo React Native, etc.) and listed in section 10.
Not legal advice: this is the studio's product policy. Items marked **[VERIFY]** need a check against current official docs before release. Product decisions and conservative design choices are not compliance guarantees.
**Where it lives:** source of truth `Eyal8/beno-studio-site` → `standards/BENO74-STANDARDS.md`. Game repos hold a synced read-only copy at `docs/BENO74-STANDARDS.md` (see `standards/README.md`).

---

## 1. Principles
1. Same behaviour in every game: players and stores see one consistent studio.
2. Simple over clever: no extra onboarding screens, no data we don't need.
3. Platform tools first (Google UMP, AdMob settings, store age signals) instead of home-made compliance logic. Platform tools help but do not by themselves guarantee every obligation is met.
4. Ads never block core play. If an ad can't be shown, the player still has a fair path.
5. A rule that is a conservative design choice (not a requirement) must be labelled as such.

## 2. Audience & age
- **Target audience: 13+** (Play Console: 13-15, 16-17, 18+). Not designed for or marketed to children under 13; no child-oriented art, wording or store assets.
- Note: Google states that the 13-15 / 16-17 groups may count as children in some regions (e.g. EU age of digital consent up to 16). This is handled through UMP consent and regional settings, not through an age screen. **[VERIFY]** per game before release.
- Apple: age rating from the App Store Connect questionnaire honestly answered; Made for Kids **off**.
- **No age screen, no birthday, no "are you 18+?" question.** We do not collect age ourselves.
- Unknown age is never treated as "adult" in code and never causes ads to be blocked by itself.
- Teens 13-17 may see all ad formats, subject to platform/regional protections.
- If a store age signal or SDK flag identifies a user as a minor, apply the protections the platform requires for that user.
- Families Policy / under-13 rules don't apply as long as the audience stays 13+. If a game ever targets under-13, this whole document must be reviewed first.

## 3. Ads (AdMob)
- Network: Google AdMob, no mediation unless decided studio-wide. SDK/wrapper per game (section 10).
- **Global request configuration in every game:** `maxAdContentRating = T` (Teen). This limits **ad content** only. It is a different mechanism from age-restricted / teen treatment (privacy treatment of the ad request); the two must not be confused.
- Age-restricted treatment (TEEN etc.), `tagForChildDirectedTreatment`, `tagForUnderAgeOfConsent`: not set app-wide by default (audience is 13+, age unknown). Apply per user only when a reliable platform signal identifies a minor. **[VERIFY]** against current AdMob docs and the game's SDK version.
- Ad mode is baked in at build time: test ads by default; real ads only for store-bound builds. Tester builds always use test ads. Never play real-ads builds on own devices.
- Formats allowed: rewarded (opt-in), interstitial (between runs/levels, with a frequency cap per game), banner (only where it doesn't cover gameplay).
- Rewarded unavailable → clear message ("No ad available right now. Try again in a moment.") and the core loop continues. A daily challenge or main mode must never require a rewarded ad to be playable.
- No ads in the first session's tutorial (and none during the first-launch studio intro, section 11).
- `app-ads.txt` lives at `https://beno74.com/app-ads.txt` and covers all games' AdMob publisher ID.
- After store launch: link each app in AdMob to its store listing.

## 4. Consent & privacy (UMP)
- Google UMP runs at launch, **before the first ad request**. Ads are requested only when `canRequestAds` is true.
- Messages configured in AdMob Privacy & messaging for every app: **EU/UK (GDPR)** and **US state regulations**. **[VERIFY]** US messages are published for each app.
- Every game has a menu entry **"Ad privacy choices"** that opens the UMP privacy options form (shown when required, harmless otherwise).
- UMP covers consent; it does not replace the privacy policy, store disclosures or age-related obligations.
- iOS ATT: one studio-wide decision for all games. **[VERIFY / DECIDE]** current Shapescraper behaviour and copy it to all games (either IDFA explainer + ATT via UMP, or no ATT prompt and no IDFA).
- We store nothing about the player on a server. Local save data (scores, streaks, purchases cache) stays on device.

## 5. Store age-signal laws (US: Texas, Utah, others coming)
- Under these laws the **stores** verify age and pass an age range / parental-consent status to developers via Apple **Declared Age Range API** and Google **Play Age Signals API**. We never ask the user ourselves.
- Some of these laws are already in effect (Texas, Utah in 2026; Alabama from Jan 1, 2027). **[VERIFY]** before each US store release: current state status, store requirements for developers, and whether the game must read and honour the signals.
- Adoption is studio-wide: when adopted, all games get it, each through its own SDK, with the same behaviour.
- Age-signal data may be used only for compliance (e.g. honouring consent / revoked consent, applying minor protections), never for ad targeting or profiling.
- When a game makes a "significant change" (new ads type, new purchases, new data use), check whether the stores require notice. **[VERIFY]** at each major update.

## 6. In-app purchases
- Non-consumables only unless decided studio-wide. No server. Purchase library per game (section 10).
- Ownership is re-read from the store at every launch; owned items auto-restore after reinstall. Pending/refunded purchases handled by the purchase layer.
- Menu has **"Restore purchases"**. Purchase/restore buttons show "Connecting…" (disabled) until the store answers.
- A successful purchase gets a dedicated thank-you celebration that is clearly bigger than any in-game celebration (Shapescraper 1.1 is the reference).
- Test with Play License Testers and Apple Sandbox before every release that touches purchases.

### 6.1 Remove Ads: studio rule
- **Always:** Remove Ads removes **all banners and interstitials**.
- **Rewarded ads:** each game picks ONE of two models and records it in section 10:
  - **Model A, "Optional rewarded":** rewarded buttons stay, the player may still choose to watch for a reward. For games where rewarded ads are a pure extra (not part of the core economy).
  - **Model B, "Ad-free rewards":** the buyer never sees any ad. Every "watch an ad to get X" button gives X **immediately, without an ad**. For games where rewarded ads drive the core economy (hints, boosters).
- **Model B caps rule:**
  - A reward grant quantity (e.g. "+3 hints per video") is **not** a cap. Before adopting Model B, the game must audit every rewarded entry point: eligibility, real caps/cooldowns enforced in code, and whether it can be claimed repeatedly.
  - Where a real cap exists, buyers get exactly the same cap; only the ad is skipped.
  - Where the only limit was the friction of watching the ad, the owner must decide in section 10: either a written **buyer cap** (per puzzle / per run / per day) or explicitly accept unlimited. No silent default, no hidden economy change.
  - Optional: a modestly higher cap for buyers as a purchase bonus, as a written decision.
- UI for Model B: the button keeps its place but drops the ad icon/"Watch" text and shows the plain reward ("Get hint", "Get hammer"). Remaining-count display stays.
- If a reward was granted without an ad, nothing calls the ad SDK (no load, no show). Grants are settled exactly once.
- Store product description must match the model:
  - Model A: "Removes banner and interstitial ads. Optional reward videos remain available."
  - Model B: "Removes all ads. Rewards that required a video are granted instantly."

## 7. Data disclosure (store forms)
- Play **Data safety** and Apple **App Privacy** must reflect the ads SDK (device/advertising ID, diagnostics, approximate location via IP, used for advertising and analytics by Google). Use AdMob's official disclosure guidance for the SDK version in use. **[VERIFY]** per release.
- No accounts, no personal data collected by BENO74 directly. If analytics/crash reporting is ever added, update this section first.

## 8. Privacy policy & studio info
- One page per game: `https://beno74.com/privacy/<game-slug>`, same template for all games.
- Template must cover: who we are (BENO74 Studios, contact email), what we collect (nothing directly), third parties (Google AdMob/UMP, Apple/Google stores and purchases), consent and how to change it ("Ad privacy choices"), children/age (13+, not directed to children), data retention (local only), contact and changes.
- Update the policy **before** any release that adds ads, purchases, analytics or age signals. This is a release blocker.
- Developer name in stores: **BENO74 Studios**. Same support/contact email in every listing.

## 9. Release checklist (every game, every store release)
- [ ] Target audience 13+ / Apple questionnaire up to date
- [ ] `maxAdContentRating = T`; no blanket age-based ad blocking in code
- [ ] Minor protections applied where a platform signal identifies a minor; regional requirements checked
- [ ] UMP: EU + US messages published, "Ad privacy choices" works
- [ ] ATT behaviour matches the studio decision
- [ ] Real-ads build for store, test-ads build for testers
- [ ] Rewarded fallback works; core modes playable without ads
- [ ] Remove Ads behaves per the game's model (6.1), caps audited; store description matches
- [ ] Purchases: buy, restore, reinstall-restore tested in sandbox
- [ ] Data safety / App Privacy forms match current SDKs
- [ ] Privacy policy page live and current; app-ads.txt includes the app
- [ ] Age-signal laws: status checked for target regions (section 5)
- [ ] Launch screen has no framework default (Capacitor/Expo/Flutter logo) and matches the first screen (section 11)
- [ ] First-launch studio intro shows once, skips on tap; "by BENO74 Studios" credit in the main menu

## 10. Per-game status
| Game | Stack (ads / purchases) | Audience | Remove Ads model | UMP / privacy button | Deviations / open items |
|---|---|---|---|---|---|
| Shapescraper | Capacitor 8: `@capacitor-community/admob` 8.2.1, `@capgo/native-purchases` 8.8.1 | 13+ | **A** (optional rewarded) | "Ad privacy choices" in menu | 1.1: add `maxAdContentRating = T`; verify code matches Model A; ATT decision; **iOS launch screen still shows the default Capacitor logo on white → replace (section 11)**; add first-launch intro + menu credit |
| Pair by Pair | Expo React Native, repo `Eyal8/number-match` (former name) | 13+ | **B** (ad-free rewards) | UMP tested Android + iOS; US messages pending | R4C.2A revision: remove blanket age blocking; audit rewarded entry points (hints, hammer, Daily Attempt); **open: buyer cap vs unlimited**; check launch screen is not the Expo default (section 11) |
| Sorté | repo `Eyal8/sorte` (see its docs/ADMOB.md) | 13+ | — | — | Not yet aligned |
| Tile Wave | Expo React Native, repo `Eyal8/tile-wave` (see docs/ads-privacy-consent.md) | 13+ | — | — | Not yet aligned |
| Landscraper | — | 13+ | — | — | Not started |

## 11. Branding & launch
Based on Apple HIG (Launching, Branding) and the Android 12+ SplashScreen API. Goal: the studio is visible, but nothing delays play.
1. **System launch screen (both platforms): no logo, no text.** It shows only the background/colours of the game's first screen, so the switch into the game is seamless. Never ship a framework default (Capacitor, Expo, Flutter logos or plain white when the first screen is coloured). Apple: "The launch screen isn't a branding opportunity… design a launch screen that's nearly identical to the first screen."
   - Android 12+: the system splash shows the game's app icon on the game's background colour; set `windowSplashScreenBrandingImage` to a small "BENO74 Studios" wordmark at the bottom. Older Android: same background colour, no extra image.
2. **Studio intro: first launch after install only.** A short BENO74 logo animation (about 1.5 s, tap to skip) before the tutorial/onboarding, never on later launches, no sound by default, no ads. This follows Apple's advice to put a splash at the beginning of onboarding, not at every launch. Store a local flag (e.g. `beno74_intro_done`).
3. **Permanent credit:** a small, quiet "by BENO74 Studios" line at the bottom of the main menu (not during gameplay). Optional: tapping it opens beno74.com.
4. Same BENO74 logo asset and animation in every game (one shared asset, adapted per engine). No studio logo in store screenshots.
5. Never add a separate studio splash at every launch, and never hold the player on any branding screen while the game is already ready.

## Changelog
- v1.3.1 (Nov 3, 2026): Tile Wave added; repo names in section 10; copies synced to shapescraper, sorte, tile-wave and number-match.
- v1.3 (Nov 1, 2026): section 11 Branding & launch (system launch screen = first screen, no logos; first-launch-only studio intro; menu credit; Android 12 branding image); purchase thank-you celebration rule; checklist items; Shapescraper Capacitor-logo launch screen and Pair by Pair Expo check added as open items. Moved to `beno-studio-site/standards/` as the shared source of truth.
- v1.2 (Nov 1, 2026): standard is behaviour-level, SDKs per game; `maxAdContentRating` vs age-restricted treatment clarified; 13-15 regional note; age-signal laws partly in effect, verify per release; Model B caps rule requires an audit and an explicit owner decision where no real cap exists.
- v1.1 (Nov 1, 2026): Remove Ads rule (6.1) with Model A / Model B; Shapescraper = A, Pair by Pair = B.
- v1.0 (Nov 1, 2026): first version. Decisions: 13+ everywhere, no age screen, ads for teens, `maxAdContentRating = T`, age signals as checklist item.
