# Lite release prep — 1.1.0 (39), gate ON on a release branch

Lane `lite-release-prep-1`, 2026-10-18. Prepares the HoloCity lite internal TestFlight build
per Pak's DECISIONS #72.7 (HolobotsUnity) and the census
`Documentation/QA/2026-10-17-lite-release-facts-1/README.md` (#135).

**Branch:** `release/lite-1.1.0`, cut from GitHub-verified main `f6d77a2`; draft PR into main.
**Not done:** no signing, archive, upload, App Store Connect call, account sign-in, deploy,
`expo prebuild`, networked install, or edit under `mobile/src/**`.

## Commits

| Commit | Item | What |
|---|---|---|
| 1 | M2, M5, M9 | `MARKETING_VERSION 1.1.0` / `CURRENT_PROJECT_VERSION 39` on all 10 configs + `app.json`; `app.json` drops the two NSHealth strings; three orphan Watch-side files and the empty membership-exception set removed |
| 2 | M6 | Draft `NSPrivacyCollectedDataTypes` (email, user ID, gameplay content, fitness), **pending Pak** |
| 3 | M8 | Preflight hardening + 26 unit tests; `metro.config.js` keys Metro's cache on the gate |
| 4 | M7 | `TESTFLIGHT_INTERNAL.md` rewritten; `app-store-submission.md` §0/§1/§6/§9/§10 |
| 5 | M1 | **Release commit only:** `export EXPO_PUBLIC_HOLOCITY_LITE=1` in the versioned `mobile/ios/.xcode.env` |
| 6 | M8 | Critic fixes: unexported shell assignments no longer count, shellScript phases scanned, xcconfig ordered below build settings, purchases release hold |
| 7 | — | This README |

Commit 5 touches only `ios/.xcode.env` and nothing depends on it, so Pak can merge everything else into main gate-off and archive
from the branch.

## New finding: Metro's cache ignored the gate

Two offline `expo export:embed --dev false --minify true` runs in a row, gate ON then gate OFF,
both with `--reset-cache`, produced **byte-identical** bundles. The OFF run took 1.6 s against
72 s for the cold ON run, and both shipped `function n(){return!0}…e.isLiteEnabled=n`.
babel-preset-expo inlines `EXPO_PUBLIC_*` at transform time, but Metro's transform cache key
does not include env values, and `--reset-cache` did not clear `$TMPDIR/metro-cache`. A fresh
cache dir gave the correct `return!1`.

So on main before this branch, a Release archive could ship the gate value of whichever build
last warmed the cache. Fix: `config.cacheVersion` now includes every
`EXPO_PUBLIC_HOLOCITY_*` key and value. With one shared cache dir, ON → OFF → ON gave
`!0` (37 s, cold) → `!1` (51 s, cold for the new key) → `!0` (2 s, warm, correct). The runbook
also clears the cache before archiving.

## Preflight output

Release branch, `--expect-lite on --last-uploaded 38 --bundle <gate-on JS bundle>`:

- `marketingVersion 1.1.0`, `buildNumber 39`, `bundleLiteGate "1"`.
- Lite gate `effective "1"`. Sources: process env (none), Xcode build settings (none),
  `ios/.xcode.env` = `1` (tracked), `ios/.xcode.env.local` (none set, untracked).
- **One local failure:** `expo-gl is a dependency but ExpoGL is not in ios/Podfile.lock`
  (M3, HELD). `uploadReady` stays `false` by design.

Main `f6d77a2` (archived copy), new script, `--expect-lite off --bundle <gate-off JS bundle>`:

- Lite gate `effective null`, no source sets it; `bundleLiteGate "0"`. **Gate OFF.**
- Expected failures on main: marketing version 1.0 is released; the two phone NSHealth
  strings in `app.json`; ExpoGL not locked.

The local checkouts on this Mac (`HolobotsMobile`, `HolobotsMobile-lite`) have no
`EXPO_PUBLIC_HOLOCITY_*` line in any `ios/.xcode.env*` or `mobile/.env*` file.

## M3 / M4 — HELD (network)

`pod install` under `sandbox-exec` with outbound IP denied, using the CocoaPods trunk cache:
- dependency analysis resolved, including `ExpoGL (15.1.7)`;
- install stopped at `hermes-engine (0.79.6)`: CocoaPods ran
  `git clone https://github.com/facebook/hermes.git` (no cached copy for that source);
- `Podfile.lock` and the pbxproj were left unchanged.

Even offline-complete, the lock would not be committable from this worktree:
`node_modules` is a symlink to another checkout, so the podspec paths resolved through it
(`../../../../…/HolobotsMobile-lite/mobile/node_modules/…`). M3 needs a networked
`pod install` in a checkout with its own `node_modules`. M4 (the unsigned gate-ON Release
build) waits on M3 and was not attempted.

## M9 proof

- `HolobotsMobile/HolobotsWatch-Container-Info.plist`: no `INFOPLIST_FILE` names it; the
  container target sets `GENERATE_INFOPLIST_FILE = YES` (pbxproj:889, :924).
- `HolobotsWatch Watch App/Info.plist`: its only reference was the membership exception
  that kept it out of the target; the target generates its plist from `INFOPLIST_KEY_*`.
  The exception set is removed with it.
- `HolobotsWatch Watch App/HolobotsWatch.entitlements`: both Watch configs sign with
  `HolobotsWatch Watch App.entitlements`; nothing names this file.
- Repo grep: the names appear only in QA docs. `plutil -lint` passes and
  `xcodebuild -list` lists all 5 targets.
- An unsigned `watchsimulator` Release build of the Watch target succeeds. Its built
  Info.plist carries 1.1.0 / 39, the build-setting NSHealth strings and no `WKBackgroundModes`
  (the deleted file's `workout-processing` mode never shipped). Whether background Watch
  workouts need that mode is still a device question; if so, add it as a build setting.

## M6 — privacy manifest (draft, pending Pak)

One `PrivacyInfo.xcprivacy` is a resource of both the phone and the Watch app, so it is both
bundles' manifest. Declared (all linked, no tracking, app functionality): email address, user
ID, gameplay content, fitness. Not declared, with reasons in an XML comment: location
(coordinates stay on device; `SyncFitnessActivityRequest` has none), purchase history
(`iapEnabled` off, D7), health records (stay in Apple Health). §6 of the submission pack now
matches.

## Tests

- `python3 mobile/scripts/test-testflight-preflight.py`: 26 / 26.
- `npx tsc --noEmit`: only the 2 known `react-test-renderer` errors.
- `npx vitest run`: 105 files / 1,374 tests pass, 4 skipped; 2 files fail only on the missing
  local `react-test-renderer` (known gap).

## Critic

One adversarial read-only critic (no ref writes) checked gate leakage, version/build consistency, no-prebuild and privacy honesty. Results:

- **Holds:** only the gate commit touches a gate source (`git log -S HOLOCITY_LITE`), and it can be dropped cleanly. With no gate variables set, `cacheVersion` stays `"1.0"`, so gate-off output is unchanged. All 10 version and all 10 build settings match `app.json`. Nothing runs or needs `expo prebuild`. No reference to the three deleted files remains. The four data types are valid Apple keys, and no undeclared off-device flow was found (no analytics/crash SDK, no device id, no coordinates uploaded). §6 matches.
- **Blocker:** ExpoGL is not in `Podfile.lock`. This is M3, already HELD; the preflight fails on it, so the branch cannot pass as upload-ready until a networked `pod install` lands. That lock commit must stay separate from the gate commit.
- **Major (pre-existing):** the Watch app has never shipped `WKBackgroundModes` `workout-processing` (the deleted file was excluded from its target), while `WorkoutManager.swift` runs an `HKWorkoutSession`. Not changed here: it is a capability change that needs a device check. Filed as a follow-up for Pak's Watch run.
- **Minor, fixed:** an unexported `KEY=1` counted as gate-on; inline `export` in a pbxproj shellScript was missed and read as `1\n…`; xcconfig precedence was reversed; purchases-undeclared depends on a remote flag (now a release hold).
- **Nit, fixed:** the Metro comment described the cache leak backwards; the runbook bundle proof is now required.
- **Nit, left:** an empty `exceptions = ( );` remains, matching the two test-target groups.

## HELD for Pak

- **D4:** 39 is valid only if App Store Connect's highest uploaded build is ≤ 38.
- **M3 / M4:** networked `pod install` (ExpoGL), then the unsigned gate-ON Release build.
- **M6:** approve or correct the draft manifest together with the ASC privacy label.
- **Watch background mode:** on the Watch device run, check that a workout keeps running with the wrist down; if not, add Background Modes → Workout Processing to the Watch App target.
- Signing (Xcode team sign-in / App Store profiles), the tester group and the device fps run
  are unchanged Pak-only items.
