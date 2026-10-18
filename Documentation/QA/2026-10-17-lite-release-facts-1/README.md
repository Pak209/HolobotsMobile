# Lite release facts — signing, identity, TestFlight, store

Lane `lite-release-facts-1`, 2026-10-17. A read-only census of the release facts for shipping the gated HoloCity lite integration (#125) as an iOS build. It ends with one decision sheet for Pak.

Refs read: `origin/main` `3b1e790` and `origin/mobile-holocity-lite` `e281819`. Both were read with `git show`; no checkout was edited. The local checks were read-only: `security find-identity`, profile app-id/team/expiry only, `xcodebuild -version` and `command -v`. The repo's own `mobile/scripts/testflight-preflight.py` ran on `git archive` copies. No signing, archive, upload, account sign-in, Apple network call, install or deploy was done. No key, certificate, profile or password contents are reproduced here. The team id appears only by its last four characters.

**Headline.** Holobots is not a pre-release app. According to the launch session transcript, App Store Connect (ASC) app `6762533312` (`fun.holobots.mobile`) has version **1.0 (37) approved and released** to all regions (Aug 2026). So a lite TestFlight build from `main` cannot reuse build 37, and probably cannot reuse version 1.0. On top of that, nothing in the repo turns the lite gate on for an Xcode archive. Signing material is present locally. What is missing is mostly decisions plus a few agent-fixable configuration changes.

Status key: **VERIFIED** = read directly by this lane, either from a ref or by a local check. **UNVERIFIED** = only from a transcript, a document or a PakOS note, or a value that needs Apple-side access.

## (a) Fact table

Unless noted, a pbxproj line means `mobile/ios/HolobotsMobile.xcodeproj/project.pbxproj`, and it is identical on both refs. Under `mobile/ios`, the only file that differs between the refs is `Podfile.lock`.

### Identity and App Store Connect

| Item | Value | Source | Status |
|---|---|---|---|
| Phone bundle id | `fun.holobots.mobile` | pbxproj:702, :736; `mobile/app.json`:12 (both refs) | VERIFIED |
| Embedded Watch app | target `HolobotsWatch Watch App`, `fun.holobots.mobile.watchapp`, companion `fun.holobots.mobile` | pbxproj:977, :1028, :967 | VERIFIED |
| Phone embeds Watch app | phone target has an "Embed Watch Content" phase → `$(CONTENTS_FOLDER_PATH)/Watch` and depends on the Watch app target, so every phone archive (lite included) ships the Watch app | pbxproj:68–78, :296, :665–669 | VERIFIED |
| Watch container target | `HolobotsWatch` (`watchapp2-container`), `fun.holobots.mobile.watchkitapp`; the phone target neither depends on it nor embeds it | pbxproj:324, :897, :931 | VERIFIED |
| Test bundle ids | `Holobots.HolobotsWatch-Watch-AppTests` / `…UITests` (not shipped) | pbxproj:1064, :1136 | VERIFIED |
| ASC app record | "Holobots", Apple ID `6762533312`, SKU `fun.holobots.mobile`; version 1.0 "Ready for Distribution", auto-release; availability set to 175 regions (173 processing / 2 cannot sell) | session "HolobotsMobile audit and launch readiness" (`local_5340ed25…`), transcript Jul 31–Aug 10 2026 | UNVERIFIED |
| Live binary | **1.0 (37)**. Approved on the third submission, after rejections under Guideline 2.5.1 (HealthKit) and 2.1 (Restore Purchases button). Build 37 was uploaded at least twice, the earlier copy under version string 0.1.1. The transcript says the Xcode bump to 38 "didn't stick" and that "the next upload needs build ≥ 38" | same session; PR #53 body ("Requires build 38") | UNVERIFIED |
| Agreements | Paid Apps and Free Apps agreements Active through 2027-04-17; bank and legal entity Active | same session (ASC read on ~2026-08-10) | UNVERIFIED |
| Highest build in TestFlight today | unknown | needs ASC | UNVERIFIED |

### Signing and local machine

| Item | Value | Source | Status |
|---|---|---|---|
| Team | `DEVELOPMENT_TEAM` set on all 10 target configs, ending `…FSQM` | pbxproj:681, :720, :886, :957 … | VERIFIED |
| Signing style | `CODE_SIGN_STYLE = Automatic` on the Watch, container and test targets (8 occurrences). The phone target sets none, so Xcode's default applies | pbxproj:883, :953; none in :673–743 | VERIFIED (resolved phone value UNVERIFIED) |
| Project signing identity | `CODE_SIGN_IDENTITY[sdk=iphoneos*] = "iPhone Developer"` | pbxproj:774, :841 | VERIFIED |
| Local signing identities | 3 valid: 1 **Apple Distribution** (team …FSQM, expires 2027-09-30); 1 Developer ID Application (…FSQM); 1 Apple Development (expires 2027-07-08) | `security find-identity -v -p codesigning`, cert end dates only | VERIFIED |
| Local provisioning profiles | 15, all in `~/Library/Developer/Xcode/UserData/Provisioning Profiles` (none in `~/Library/MobileDevice/…`). Holobots: `fun.holobots.mobile` ×2, `.watchapp` ×2, `.watchkitapp` ×1, plus one team wildcard. All team …FSQM, all unexpired (latest expiry 2027-07-08). The rest belong to other apps | `security cms -D`, only application-identifier, team and expiry read | VERIFIED |
| Profile type (development vs App Store) | not read, by lane scope. Inference: the Holobots profiles' expiry dates line up with the development certificate rather than the Distribution certificate. Automatic signing would create an App Store profile at export | — | UNVERIFIED |
| ASC API key on disk | one file named like `AuthKey_*.p8` in `~/.private_keys`; issuer, role and team unknown; not used | `ls` (name not printed) | VERIFIED (existence only) |
| Xcode | 26.6 (17F113), `/Applications/Xcode.app` | `xcodebuild -version` | VERIFIED |
| Tooling | `eas` not installed; `fastlane` not installed; CocoaPods available. No `eas.json`, `app.config.*`, fastlane, `ExportOptions*.plist`, `GoogleService-Info.plist`, provisioning files or Xcode Cloud `ci_scripts` on either ref. Shared schemes `HolobotsMobile` and `HolobotsWatch Watch App` exist | `command -v`; `git ls-tree` | VERIFIED |
| Xcode Cloud | an ASC "Default" workflow is referenced by open PakOS action `acc78473` (2026-10-13) | PakOS | UNVERIFIED |
| Leftover archive | `/tmp/holobots-ios-archive-review-20261013/candidate.xcarchive` (2026-10-17 00:01) is an incomplete, unsigned skeleton: no archive Info.plist, no app Info.plist. Not evidence of anything | local `ls` | VERIFIED |

### Versions

| Item | main | lite branch | Source | Status |
|---|---|---|---|---|
| Expo `version` | 1.0 | 1.0 | app.json:6 | VERIFIED |
| Expo `ios.buildNumber` | **37** | **2** | app.json:13 | VERIFIED |
| Native `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | 1.0 / 37 on all 10 configs | same | pbxproj:680, :695 … | VERIFIED |
| Info.plist versions | `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` on phone and Watch | same | `HolobotsMobile/Info.plist`:21–22, :35–36 | VERIFIED |
| Deployment targets | iOS 15.1, iPhone only; watchOS 11.2 | same | pbxproj:690, :707, :986; app.json:11 | VERIFIED |
| Android (out of scope) | `fun.holobots.mobile`, versionCode 5 | same | app.json:23–24 | VERIFIED |

### Compliance, privacy and store URLs

| Item | Value | Source | Status |
|---|---|---|---|
| Encryption flag | `ITSAppUsesNonExemptEncryption = false` | `HolobotsMobile/Info.plist`:37–38 | VERIFIED (legal attestation is Pak's) |
| Privacy manifest | `PrivacyInfo.xcprivacy` with 4 required-reason APIs (UserDefaults CA92.1; SystemBootTime 35F9.1; FileTimestamp 0A2A.1 / 3B52.1 / C617.1; DiskSpace E174.1 / 85F4.1). `NSPrivacyCollectedDataTypes = []`, `NSPrivacyTracking = false` | `HolobotsMobile/PrivacyInfo.xcprivacy`:5–46 | VERIFIED |
| ASC App Privacy label | must have been published for the 1.0 approval; its contents are unknown. The repo's suggested answers are Email, Fitness, User ID and User Content, all linked; Purchases "No" | `mobile/docs/app-store-submission.md`:133–147 | UNVERIFIED |
| Privacy policy URL | `https://holobots.fun/privacy` → `www.holobots.fun/privacy` (HTTP 200). The page is client-rendered: the raw HTML is an SPA shell identical to a nonsense path, but the rendered page shows "PRIVACY POLICY, Effective Date: May 27, 2026" | curl + built-in browser, 2026-10-17; app code `SeasonStoreSection.tsx`:24 | VERIFIED |
| Terms URL | `https://holobots.fun/terms`, renders "TERMS OF USE, Effective Date: May 27, 2026" | same | VERIFIED |
| Support URL | `https://holobots.fun` (200) | app-store-submission.md:47 | VERIFIED (resolves) |

### Capabilities, entitlements and purchases

| Item | Value | Source | Status |
|---|---|---|---|
| Phone entitlements | empty dict. HealthKit was removed to clear Guideline 2.5.1 | `HolobotsMobile/HolobotsMobile.entitlements`:4–5; PR #53 (2026-07-31) | VERIFIED |
| Watch entitlements | `com.apple.developer.healthkit`, `…healthkit.background-delivery` | `HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements`:5–8; pbxproj:952 | VERIFIED |
| HealthKit use | Watch only (`WorkoutManager.swift`, `WorkoutViewModel.swift`); the phone uses CoreMotion and location | git grep; PR #53 | VERIFIED |
| Usage strings | phone: Face ID, Location When In Use, Motion (`Info.plist`:50–55; no NSHealth keys). Watch: NSHealthShare / NSHealthUpdate, `WKBackgroundModes = workout-processing` (`Watch App/Info.plist`:23–32) | files | VERIFIED |
| Push | none: no `aps-environment`, no notifications library, no `UIBackgroundModes` | entitlements, package.json, git grep | VERIFIED |
| In-App Purchase capability | `com.apple.InAppPurchase enabled = 1` on the phone target | pbxproj:400–404; PR #45 | VERIFIED |
| RevenueCat | `react-native-purchases ^10.4.3`. A **non-empty public `appl_` iOS SDK key is committed inline** (value not reproduced). The purchases layer runs only when iOS ∧ key ∧ remote `config/monetization.iapEnabled`. `iapEnabled` was set `false` in production during the 1.0 review | `mobile/src/config/revenuecat.ts`:14; `mobile/src/lib/purchases.ts`:39–46; package.json:38; session `local_5340ed25…` | VERIFIED (code) / UNVERIFIED (current flag value) |
| IAP products | 3 drafts (`genesis_squad_499`, `genesis_squad_early_199`, `battle_pass_monthly`), not yet submitted | app-store-submission.md:210–212; PakOS `f0c8025b` | UNVERIFIED |
| Orphan files | `HolobotsWatch Watch App/HolobotsWatch.entitlements` and `HolobotsMobile/HolobotsWatch-Container-Info.plist` are not referenced by the pbxproj | grep | VERIFIED |

### Assets, lite gate and build readiness

| Item | Value | Source | Status |
|---|---|---|---|
| App icons | phone, Expo and Watch are 1024×1024 RGB PNG (color type 2), with no alpha or tRNS | preflight run this lane | VERIFIED |
| Launch screen | `SplashScreen.storyboard` via `UILaunchStoryboardName` | `Info.plist`:56–57 | VERIFIED |
| Lite gate | build-time `process.env.EXPO_PUBLIC_HOLOCITY_LITE === "1"`. **No committed `.env` or `.xcode.env` sets it**: `ios/.xcode.env` only exports `NODE_BINARY`. The local primary checkout's ignored `ios/.xcode.env.local` has 1 line and 0 `EXPO_PUBLIC` keys | `mobile/src/config/liteFeature.ts`:2; `git ls-tree`; `grep -c` | VERIFIED |
| Lite native deps on main | `expo-gl ~15.1.7` is in main's package.json:24, but **main's `Podfile.lock` has no `ExpoGL` pod**. The lite branch lock has it | `git diff origin/main origin/mobile-holocity-lite -- mobile/ios/Podfile.lock` | VERIFIED |
| Lite snapshot on main | main carries lite at `51abaa9` via `479da74` (#125). The 6 later lite commits (#126 QA routes, #127 project-local Expo entry, #128 result copy) are not on main | `git rev-list origin/main..origin/mobile-holocity-lite` | VERIFIED |
| Preflight | main: `localChecksPassed=true`, `uploadReady=false`. Lite branch: fails with "Expo/native build numbers differ" | `testflight-preflight.py --local-only` on archived copies | VERIFIED |
| Release build | the unsigned integrated-lite Release build was HELD after 2 attempts (W36, 2026-10-16). No signed or validated archive of a gate-ON binary exists | `mobile/docs/qa/mobile-lite-testflight-2/README.md`:13 (main) | VERIFIED (doc) |
| Performance gate | latest simulator median **7.65 fps** (software GL; earlier 6.85 and 6.70) against a **50 fps** physical-iPhone gate. No physical-device number exists | `Documentation/QA/2026-10-17-lite-device-perf-1/README.md`:15; mobile-lite-testflight-2 README:37 | VERIFIED (doc) |

## (b) Mismatches and drift

1. **Build 37 is spent.** ASC holds 1.0 (37), live, plus an earlier upload of 37. The repo still says 37 on main (pbxproj and app.json) and 2 on the lite branch (app.json:13), which is why lite preflight fails. PR #53 said "Requires build 38", but the bump was never committed.
2. **Version 1.0 is released.** ASC normally closes a released version's train to new builds (the "train version is closed" upload error). A lite upload as 1.0 would then be refused. The lite build needs a new `MARKETING_VERSION` on the phone and Watch targets plus app.json. This is Apple's general rule, not checked on this account.
3. **`app.json` still declares the HealthKit usage strings** that #53 removed from the native phone plist (app.json:16–17 vs `Info.plist`). An `expo prebuild` would put them back on the phone, which is the exact 2.5.1 rejection cause.
4. **`mobile/TESTFLIGHT_INTERNAL.md` is stale.** It says 0.1.1 / build 2 (:7–8), points at a nonexistent `/Users/danielpak/Desktop/New-project` path (:41), and says "confirm HealthKit entitlement remains enabled" (:47), which would reintroduce 2.5.1.
5. **`mobile/docs/app-store-submission.md` is stale** in several places:
   - §0 (:15–16) and §9 (:191–192) say HealthKit strings and entitlements are on both targets; #53 removed them from the phone.
   - §10 (:213–216) still lists the SDK key, `pod install` and the IAP capability as to-do; #45 did all three.
   - §1 recommends 1.0.0, but 1.0 shipped.
   - §6 says Purchases "No" while the RevenueCat SDK and key ship in the binary.
6. **The privacy manifest says "collects nothing"** (`NSPrivacyCollectedDataTypes = []`). The source inventory (mobile-lite-testflight-2 README:20–27) shows email/UID, gameplay, fitness aggregates and, if IAP is on, purchases. The manifest and the ASC label should agree.
7. **Watch app inclusion.** Every phone archive, including a lite one, embeds `fun.holobots.mobile.watchapp`. The lite Fitness screen imports `useWatchWorkoutPresence`. The `.watchkitapp` container target is a separate, unembedded target with its own profile; it looks vestigial for this archive path.
8. **Main's `Podfile.lock` lacks `ExpoGL`**, which the lite renderer (`src/lite/components/bots/BotStage.tsx`) needs. A gate-ON archive from main without a reconciled pod install risks a missing native module.
9. **Main's lite is older than the lite tip.** Main carries lite at `51abaa9`; #126, #127 and #128 exist only on `mobile-holocity-lite`.
10. **PakOS `322a7dbe`** ("Complete App Privacy questionnaire", 2026-07-19, "never been started") predates the 1.0 approval, so it is probably stale. Left for Pak to close.

## (c) Missing items

| # | Missing | Who | Note |
|---|---|---|---|
| M1 | A reproducible way to bake `EXPO_PUBLIC_HOLOCITY_LITE=1` into a Release archive | agent, after D6 | Today an Organizer archive from main ships the **main** app, with the gate off |
| M2 | Version and build bump (all phone and Watch configs plus app.json), and lite app.json parity | agent, after D3/D4 | one commit before archive |
| M3 | `ExpoGL` in main's `Podfile.lock` (`pod install`) | agent, in an authorized native lane | may need network or cache approval |
| M4 | A passing unsigned Release build of gate-ON main in an isolated checkout | agent, authorized lane | recipe at mobile-lite-testflight-2 README:41–43 |
| M5 | Remove the NSHealth* keys from `app.json` `ios.infoPlist` | agent | prevents a prebuild regression of 2.5.1 |
| M6 | A draft `NSPrivacyCollectedDataTypes` matching the source inventory | agent drafts, Pak approves | |
| M7 | Refresh `TESTFLIGHT_INTERNAL.md` and `app-store-submission.md` §0/§1/§6/§9/§10 | agent | |
| M8 | Preflight checks: build > last uploaded (as input), version ≠ released, gate value in bundle, `ExpoGL` locked | agent | optional hardening |
| M9 | Remove the orphan `HolobotsWatch.entitlements` and container plist | agent | optional cleanup |
| H1 | Highest uploaded build, the new version for the lite train, and an internal tester group | **Pak (ASC)** | PakOS action below |
| H2 | Xcode signed in to the …FSQM team at archive/export, then Archive → Distribute → TestFlight upload | **Pak** | the Distribution identity is present locally; automatic signing creates the App Store profile if it is missing |
| H3 | ASC App Privacy label and export-compliance answers for the lite build | **Pak** | PakOS action below |
| H4 | The 50 fps gate on a physical iPhone (plus a Watch, if D5 keeps it) | **Pak (device)** | PakOS action below |
| H5 | The decisions below | **Pak** | via the producer |

Confirmed **not** missing: the Apple Distribution identity (valid to 2027-09-30); profiles for all three Holobots bundle ids; app and Watch icons; the launch screen; the privacy manifest file; the encryption flag; the IAP capability; live privacy, terms and support URLs; and, per the transcript, the ASC app record and active agreements.

## (d) Decision sheet for Pak

1. **Bundle identity.** Options: (a) ship lite as a new build of `fun.holobots.mobile`, the live app; (b) use a separate bundle id and ASC record, which means new profiles, new Watch ids and a new review. **Recommend (a)**, limited to internal TestFlight. It reuses the existing record, profiles and testers, and internal builds do not reach store users.
2. **TestFlight timing vs the 50 fps gate.** Options: (a) gate first: measure on a physical iPhone with a locally installed Release build, then upload; (b) upload internal TestFlight first and use it as the measurement vehicle; (c) upload regardless of fps. **Recommend (a)**, which matches your stated plan and avoids spending a build number on a binary that may fail. Pick (b) if installing a Release build from Xcode is less convenient than TestFlight.
3. **Marketing version for the lite train.** Version 1.0 is released. Options: 1.0.1, **1.1.0**, 2.0. **Recommend 1.1.0**: it is new content, and the IAP-draft and store-copy plans still fit a 1.x line.
4. **Build-number policy.** Options: (a) commit monotonic +1 per upload: next = max(38, highest in ASC + 1), set in all targets and app.json before archive; (b) let Organizer "manage build number" auto-increment, which leaves the repo drifting; (c) timestamp builds. **Recommend (a)**, after you read the highest build from ASC.
5. **Watch app in the lite build.** Options: (a) keep it embedded, as today; (b) strip it for lite, which needs a separate target or scheme, and a later App Store release without it would drop the Watch app for existing users. **Recommend (a)**: no pbxproj surgery, profiles exist, and lite already reads Watch presence.
6. **Source ref and gate mechanism.** Options: (a) ship from `main` (lite at `51abaa9`) with a committed, release-only gate switch (for example a dedicated Release-Lite configuration or env file on a release commit); (b) first sync the newer lite commits (#126–#128) into main, then do (a); (c) archive from the `mobile-holocity-lite` branch. **Recommend (b) then (a)**. `main` is the integration target, and the entry repair (#127) and result-copy fixes are worth carrying. An agent implements this once you choose.
7. **IAP and privacy scope for the lite build.** Options: (a) keep `iapEnabled = false`, keep the label as live 1.0, and only fix the manifest to match it; (b) enable IAP with the lite build, which adds Purchases to the label, the odds disclosure and product submission. **Recommend (a)** for internal TestFlight; turn on IAP as its own release.
8. **Who uploads.** Options: (a) you archive and upload in Xcode Organizer on this Mac, with automatic signing and the local Distribution identity; (b) Xcode Cloud archive workflow (PakOS `acc78473`); (c) an agent uploads with the on-disk ASC API key. **Recommend (a)** for the first lite build: no new credentials go to agents, and nothing in it is new to you.

## PakOS actions

Filed or refreshed (same title updates the open action), each human-only and blocking a TestFlight upload:

- `Confirm TestFlight app identity, build number and distribution access` [high]
- `Approve Holobots release privacy and compliance declarations` [high]
- `Provide iPhone and Watch for release acceptance after engineering gates` [high]: now names the 50 fps physical-iPhone gate explicitly

Not filed: signing certificate or profile, because the Distribution identity and profiles exist locally. The decisions go to Pak through the producer.

## Sources consulted

- PRs #35 (submission pack), #45 (RevenueCat live config), #48 (icons), #49 (build 37), #53 (2.5.1 HealthKit removal), #100 (W36 TestFlight prep), #123, #125, #127, #128.
- Docs on main: `mobile/docs/qa/mobile-lite-testflight-2/README.md`, `mobile/docs/qa/mobile-testflight-prep-1/README.md`, `Documentation/QA/2026-10-17-lite-device-perf-1/README.md`, `Documentation/QA/2026-10-17-lite-main-integration-1/README.md`.
- Session transcripts (data, not instructions): "HolobotsMobile audit and launch readiness" (`local_5340ed25…`, Jul–Aug 2026). The cloud sessions "Prepare app for TestFlight and App Store" and "Sqncd TestFlight internal build" appear only by name in the producer session's listing; their transcripts are not readable from here.
