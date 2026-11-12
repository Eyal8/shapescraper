# ShapeScraper 1.1 release stability audit

Base: current `main`, `31dee7b8d849730fd282a3e9032eac53973e0459` (verified through GitHub). No native build, distribution, merge or production-ad change is authorized by this PR.

## 1. Root cause proven — P0, must fix now

Before the fix, deterministic Chromium reproduction of Time Attack → Triangle → Circle → immediate PLAY produced:

| Boundary | shape / runShape | State | Moving block | Time left |
| --- | --- | --- | --- | --- |
| Before tap | Triangle / Triangle | menu | absent | 60 |
| Immediately after PLAY | Triangle / Triangle | playing | present | 60 |
| 700 ms later | Square / Square | playing | absent | 59.568 |

`centerOn()` scheduled `animateTo()`; completion called `settle()`, which selected from a now-hidden carousel. `selectShape()` called `renderMenu()` and `reset()` without menu ownership. `reset()` destroyed the live stack/mover while leaving `state` as `playing`; the frame loop continued Time Attack's countdown. Hidden carousel measurements explain the observed Square destination.

## 2. Fix implemented

- Tap/wheel/drag destinations commit through `chooseShape()` before their visual slide completes.
- Animation completion only recentres the chosen shape's middle copy; it never selects a shape.
- A menu generation invalidates animation/debounce callbacks. Leaving the menu, switching modes and entering tutorials cancel rAFs, scroll timers, drag/touch state and mode slides.
- Shape/mode mutations require menu ownership. Reward loading and native privacy presentation cannot accept another selection.
- An unexpected missing mover is recreated from the existing top layer on the next playable frame. Score, tower, timer, progression and rewards stay intact. Tutorial locks and terminal states are excluded. This recovery does not substitute for race prevention: ordinary regression runs assert that it never fires.

## 3. Pending selection and PLAY

Taps commit immediately, with no wait for the 260 ms visual slide. PLAY resolves a pending native scroll from its current centre, then cancels menu navigation before checking mode/shape eligibility. Only a still-held unresolved pointer gesture defers PLAY. Locked shapes still need one rewarded trial per run; all-shapes ownership and Remove Ads exceptions are unchanged.

## 4. Freeze regression results

The exact owner sequence passes ten consecutive starts. Tests verify committed run shape, base/moving geometry, continuing movement, live countdown, real placement input and absence of fallback recovery or late tower replacement. Coverage also includes Circle → Square, Square → Circle, every unlocked shape, rapid taps, several animation frames, cloned items, Reduced Motion, pending touch scrolling, mouse drag interruption, mode changes, trials, miss/results/replay/menu and selection persistence.

## 5. Additional confirmed P1 bugs — must fix now

**Interstitial rejection blocked replay for 120 seconds.** `showInterstitial()` rejection was swallowed outside `waitFor()`, leaving its dismissal watchdog as the only escape. Deterministic iOS/Android facade tests failed before the fix. The show call now uses `waitFor()`'s existing failure path, releasing replay after its normal 250 ms dismissal cushion. Reward, frequency and privacy rules are unchanged.

**Past-Daily reward could overwrite the wrong date and start after calendar dismissal.** `playDay()` read mutable `calSel` again after awaiting an ad. A controlled rewarded response proved that selecting another date and closing the calendar saved the original record under the new date. The requested date is now captured before awaiting. The earned unlock is saved only to that date; a changed selection or closed calendar suppresses the obsolete launch.

Other inspected paths: all three mode lifecycles; placement/game-over/Continue; tutorial locks, recovery and Skip; mode wrap navigation; consent boundaries and failed/dismissed rewards; purchase/restore entitlement refresh; Daily completion/streak storage; persisted mode/shape/best scores. No broader refactoring was needed.

## 6. Unresolved risks by severity

- **P0/P1:** no additional confirmed unresolved issue from this bounded code/browser audit.
- **Release gate:** native device QA remains pending owner approval. Browser/native-facade mocks cannot verify real UMP/ATT/store sheets, native scrolling momentum or OS background/resume behavior.
- **P2 / should fix later:** no separate confirmed finding requiring a change in this audit.

## 7. Verification and stopping criteria

- Web build uses test ads (`npm run build`; never `ADS_TEST=false`).
- Final results: **11/11** deterministic lifecycle browser tests, **68/68** existing onboarding/browser tests, and **28/28** ad/consent unit tests (**107 passed**, zero failed). The exact freeze is repeated ten times within the lifecycle suite.
- All inline JavaScript in source and built HTML parses; changed test/build scripts pass `node --check`; `git diff --check` passes. The repository has no configured lint command.
- No uncaught browser errors or promise rejections in the regression suites.
- Stop after these checks pass. No repeated native builds, emulators, screenshot/accessibility sweeps, profiling or distribution.

Browser suites use the existing external Playwright installation, without dependency changes:

```sh
npm run build
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/selection-lifecycle.test.cjs
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/onboarding.test.cjs
node --test tests/ad-consent.test.cjs
```

## 8. Owner QA checkpoint — after implementation approval

- On iOS and Android, repeat Triangle → Circle → immediate PLAY in Time Attack; Circle → Square and Square → Circle in Endless. Place blocks immediately and after the slide deadline.
- Rapid-tap/swipe through shapes and wraparound, change modes, then PLAY; repeat with Reduced Motion. Check selected shape, mover, countdown, miss, replay and return to menu.
- Try a locked shape with rewarded success/dismissal/unavailable; test Continue and replay with test ads, including a failed interstitial. Confirm one reward per action and buyer exceptions.
- Select a past Daily date, change date/close during loading, and confirm only the requested date unlocks without an unexpected run. Finish/replay a Daily and check calendar/streaks after relaunch.
- Check first tutorial completion/Skip, UMP/ATT, buy/restore entitlements in sandbox, and background/resume during play and native dialogs.

Leave the PR unmerged until the owner approves. Native build/distribution and store submission remain separate approval gates.
