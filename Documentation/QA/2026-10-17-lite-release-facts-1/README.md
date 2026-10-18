# Lite release facts — signing, identity, TestFlight, store

Lane `lite-release-facts-1`, 2026-10-17, amended after two refute-first reviews. This is a read-only census of the release facts for shipping the gated HoloCity lite integration (#125) as an iOS build. It ends with one decision sheet for Pak.

**What was read.** Refs: `origin/main` `3b1e790` and `origin/mobile-holocity-lite` `c187921` (the census started at `e281819`; native and config drift is unchanged between them). Both were read with `git show`; no checkout was edited.

**Local checks**, all read-only:
- `security find-identity`;
- provisioning-profile fields: app id, team, dates, device-list presence, `get-task-allow`, `beta-reports-active`, entitlement-key presence, and whether the embedded certificate matches a local signing identity;
- certificate end dates;
- `xcodebuild -version` and `command -v`;
- the repo's `mobile/scripts/testflight-preflight.py` (from main), run on `git archive` copies.

**Not done:** no signing, archive, upload, account sign-in, Apple network call, install or deploy.

**Not reproduced:** no key, certificate, profile, device or password contents, and no credential locations. The team id appears only by its last four characters.

## Headline

1. **Holobots 1.0 is approved, but its public listing is not confirmed.** In the launch session's transcript, App Store Connect (ASC) app `6762533312` (`fun.holobots.mobile`) went "Ready for Distribution" with auto-release on **2026-08-03**. Availability was set to 175 regions around 19:01Z on **2026-08-10**. At the transcript's last message, the public page still returned 404 and the iTunes lookup was empty.
2. **A lite upload needs a new marketing version.** 1.0 (37) is approved, and the 1.0 train is probably closed to new builds. On iOS, build numbers only need to be unique within a version. Starting at 38 or higher is the repo policy proposed in D4, not an Apple rule.
3. **Nothing on `main` turns the lite gate on for an archive.** The `mobile-holocity-lite` branch is ungated: its `App.tsx` always mounts CityHub and CityMarket. So today only an archive of that branch would ship lite.
4. **No Holobots App Store profile uses this Mac's Distribution identity.** The existing App Store profiles embed a Distribution certificate that this Mac has no signing identity for. Xcode did generate a same-team App Store profile with the local identity (for another app) on 2026-09-30, so automatic signing at export probably only needs to generate the Holobots profiles.

Status key:
- **VERIFIED** = read directly by this lane, from a ref or a local check.
- **DOC** = the text of a committed QA doc was read; the run it describes was not repeated.
- **INFERRED** = follows from VERIFIED rows.
- **UNVERIFIED** = only from a transcript or a PakOS note, or a value that needs Apple-side access.

## (a) Fact table

Unless noted, a pbxproj line means `mobile/ios/HolobotsMobile.xcodeproj/project.pbxproj`, which is identical on both refs. Under `mobile/ios`, the only file that differs between the refs is `Podfile.lock`.

### Identity and App Store Connect

| Item | Value | Source | Status |
|---|---|---|---|
| Phone bundle id | `fun.holobots.mobile` | pbxproj:702, :736; `mobile/app.json`:12 (both refs) | VERIFIED |
| Embedded Watch app | target `HolobotsWatch Watch App`, `fun.holobots.mobile.watchapp`, companion `fun.holobots.mobile` | pbxproj:977, :1028, :967 | VERIFIED |
| Phone embeds Watch app | the phone target has an "Embed Watch Content" phase → `$(CONTENTS_FOLDER_PATH)/Watch` and depends on the Watch app target, so every phone archive (lite included) ships the Watch app | pbxproj:68–78, :296, :665–669 | VERIFIED |
| Watch container target | `HolobotsWatch` (`watchapp2-container`), `fun.holobots.mobile.watchkitapp`; the phone target neither depends on it nor embeds it | pbxproj:324, :897, :931 | VERIFIED |
| Test bundle ids | `Holobots.HolobotsWatch-Watch-AppTests` / `…UITests` (not shipped) | pbxproj:1064, :1136 | VERIFIED |
| ASC app record | "Holobots", Apple ID `6762533312`, SKU `fun.holobots.mobile`, version 1.0 | session "HolobotsMobile audit and launch readiness" (`local_5340ed25…`; transcript runs 2026-07-06 → 2026-08-10, and the release events cited here span 2026-07-20 → 2026-08-10) | UNVERIFIED |
| Review history (three submissions) | 1. First submitted 2026-07-20 about 18:32Z.<br>2. Guideline 2.1 (App Completeness) rejection pasted 2026-07-26 18:11Z (a demo-account detail; binary unchanged); Update Review 2026-07-26 18:34Z.<br>3. Guideline 2.5.1 (HealthKit) rejection pasted 2026-07-31 05:32Z, with a 2.1 question about the Restore Purchases button answered in the same reply; the 0.1.1-string build 37 swapped for 1.0 (37); Update Review 06:39Z.<br>"Ready for Distribution" email 2026-08-03 20:09Z | same transcript; timestamps from its local log | UNVERIFIED |
| Distribution status | 1.0 auto-release; App Availability set to 175 regions (173 processing / 2 cannot sell) at about 2026-08-10 19:01Z. **Public listing not confirmed**: the last message (19:02Z) still saw a 404. ASC also showed a pending **"Declare Your Regulated Medical Device"** notice (EU/EEA, UK, US; due early 2027) | same | UNVERIFIED |
| Builds in ASC | **1.0 (37)** was the last build attached before the final Update Review. Build 37 also exists under the older 0.1.1 version string. The transcript says the Xcode bump to 38 "didn't stick" and "the next upload needs build ≥ 38"; PR #53 says "Requires build 38". Any uploads after 2026-08-10 are unknown | same; PR #53 | UNVERIFIED |
| Agreements | Paid Apps and Free Apps agreements Active through **2027-04-17**; bank and legal entity Active | same (ASC read about 2026-08-10) | UNVERIFIED |

### Signing and local machine

| Item | Value | Source | Status |
|---|---|---|---|
| Team | `DEVELOPMENT_TEAM` set on all 10 target configs, ending `…FSQM` | pbxproj:681, :720, :886, :957 … | VERIFIED |
| Signing style | `CODE_SIGN_STYLE = Automatic` on the Watch, container and test targets (8 occurrences). The phone target sets none, so Xcode's default applies | pbxproj:883, :953; none in :673–743 | VERIFIED (resolved phone value UNVERIFIED) |
| Project signing identity | `CODE_SIGN_IDENTITY[sdk=iphoneos*] = "iPhone Developer"` | pbxproj:774, :841 | VERIFIED |
| Local signing identities | 3 valid: 1 **Apple Distribution** (team …FSQM, issued 2026-09-30, expires 2027-09-30); 1 Developer ID Application (…FSQM); 1 Apple Development (expires 2027-07-08) | `security find-identity -v -p codesigning`; certificate dates only | VERIFIED |
| Development profiles | 4, all created 2026-07-08 and expiring 2027-07-08: `fun.holobots.mobile`, `.watchapp`, `.watchkitapp` and a team wildcard. Each has a device list and `get-task-allow = true`, and embeds the local Apple Development identity's certificate | `security cms -D`; field presence and dates only | VERIFIED |
| App Store profiles | **2**, `fun.holobots.mobile` and `.watchapp` only, with **none for `.watchkitapp`** (that target is not embedded). Both created 2026-07-13, with no device list, `get-task-allow = false` and `beta-reports-active = true`. Both embed an Apple Distribution certificate (valid to 2027-04-18) that **has no matching signing identity on this Mac**. They expire 2027-04-18 because that certificate does | same | VERIFIED |
| Local Distribution identity vs profiles | used by **no** Holobots profile. It is used by exactly 1 same-team App Store profile for another app, created 2026-09-30 (the day the identity was issued) and expiring 2027-09-30 | same, by matching certificate digests (not printed) | VERIFIED |
| What an upload from this Mac needs | a Holobots App Store profile for the local Distribution identity. Automatic signing at Organizer export would normally generate it, provided Xcode is signed in to the …FSQM team with rights to create profiles (Admin or App Manager with certificate access). Alternatives: cloud-managed distribution signing at export, or importing the older Distribution certificate's identity from wherever it lives | follows from the three rows above | INFERRED |
| HealthKit on the phone App ID | the phone profiles were generated 2026-07-08 and 2026-07-13, before #53, and carry the HealthKit entitlement, so the capability was on then. The current portal state is unknown. Not a 2.5.1 risk by itself: signed entitlements come from the empty phone `.entitlements` file (pbxproj:679, :718) | profile entitlement keys (presence only) | VERIFIED (then) / UNVERIFIED (now) |
| ASC API upload | possible only if Pak supplies an ASC API key to an agent; none was used by this lane | — | not checked |
| Xcode | 26.6 (17F113) | `xcodebuild -version` | VERIFIED |
| Tooling | `eas` not installed; `fastlane` not installed; CocoaPods available. No `eas.json`, `app.config.*`, fastlane, `ExportOptions*.plist`, `GoogleService-Info.plist`, provisioning files or Xcode Cloud `ci_scripts` on either ref | `command -v`; `git ls-tree` | VERIFIED |
| Shared scheme | `HolobotsMobile.xcscheme`: Test = Debug, **Launch (Run) = Release**, Profile = Release, Analyze = Debug, Archive = Release | `xcshareddata/xcschemes/HolobotsMobile.xcscheme`:26, :44, :65, :82, :85 | VERIFIED |
| Xcode Cloud | an ASC "Default" workflow is referenced by open PakOS action `acc78473` (2026-10-13) | PakOS | UNVERIFIED |

### Versions

| Item | main | lite branch | Source | Status |
|---|---|---|---|---|
| Expo `version` | 1.0 | 1.0 | app.json:6 | VERIFIED |
| Expo `ios.buildNumber` | **37** | **2** | app.json:13 | VERIFIED |
| Native `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | 1.0 / 37 on all 10 configs | same | pbxproj:680, :695 … | VERIFIED |
| Phone Info.plist versions | `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` | same | `HolobotsMobile/Info.plist`:21–22, :35–36 | VERIFIED |
| Deployment targets | iOS 15.1, iPhone only; watchOS 11.2 | same | pbxproj:690, :707, :986; app.json:11 | VERIFIED |
| Android (out of scope) | `fun.holobots.mobile`, versionCode 5 | same | app.json:23–24 | VERIFIED |

### Compliance, privacy and store URLs

| Item | Value | Source | Status |
|---|---|---|---|
| Encryption flag | `ITSAppUsesNonExemptEncryption = false`, which pre-answers TestFlight export compliance | `HolobotsMobile/Info.plist`:37–38 | VERIFIED (legal attestation is Pak's) |
| Privacy manifest | `PrivacyInfo.xcprivacy` with 4 required-reason APIs (UserDefaults CA92.1; SystemBootTime 35F9.1; FileTimestamp 0A2A.1 / 3B52.1 / C617.1; DiskSpace E174.1 / 85F4.1). `NSPrivacyCollectedDataTypes = []`, `NSPrivacyTracking = false`. The **same file is a resource of both the phone and the Watch app** | `HolobotsMobile/PrivacyInfo.xcprivacy`:5–46; pbxproj:452, :467 | VERIFIED |
| ASC App Privacy label | must have been published for the 1.0 approval; its contents are unknown. The repo's suggested answers are Email, Fitness, User ID and User Content, all linked; Purchases "No". The label gates App Store submission, not internal TestFlight | `mobile/docs/app-store-submission.md`:133–147 | UNVERIFIED |
| Privacy policy URL | `https://holobots.fun/privacy` → `www.holobots.fun/privacy` (HTTP 200). The page is client-rendered: the raw HTML is an SPA shell identical to a nonsense path, but the rendered page shows "PRIVACY POLICY, Effective Date: May 27, 2026" | curl + built-in browser, 2026-10-17; `SeasonStoreSection.tsx`:24 | VERIFIED |
| Terms URL | `https://holobots.fun/terms`, renders "TERMS OF USE, Effective Date: May 27, 2026" | same | VERIFIED |
| Support URL | `https://holobots.fun` (200) | app-store-submission.md:47 | VERIFIED (resolves) |

### Capabilities, entitlements and purchases

| Item | Value | Source | Status |
|---|---|---|---|
| Phone entitlements | empty dict. HealthKit was removed to clear Guideline 2.5.1 | `HolobotsMobile/HolobotsMobile.entitlements`:4–5; PR #53 (2026-07-31) | VERIFIED |
| Watch entitlements | `com.apple.developer.healthkit`, `…healthkit.background-delivery` | `HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements`:5–8; pbxproj:952 | VERIFIED |
| HealthKit use | Watch only (`WorkoutManager.swift`, `WorkoutViewModel.swift`); the phone uses CoreMotion and location | git grep; PR #53 | VERIFIED |
| Phone usage strings | Face ID, Location When In Use, Motion; no NSHealth keys | `HolobotsMobile/Info.plist`:50–55 | VERIFIED |
| Watch Info.plist as built | the folder's `Info.plist` is **membership-excepted** and not used: the target sets no `INFOPLIST_FILE` and uses `GENERATE_INFOPLIST_FILE = YES`. The shipped NSHealthShare / NSHealthUpdate / NSMotion strings come from `INFOPLIST_KEY_*` build settings. No `WKBackgroundModes` build setting exists, so the file's `workout-processing` mode **probably does not ship**. Whether background Watch workouts need it is a device check | pbxproj:104–110, :961–967, :1013–1019 | VERIFIED (settings); built bundle not inspected |
| Push | none: no `aps-environment` in entitlements or profiles, no notifications library, no `UIBackgroundModes` | entitlements, profiles, package.json, git grep | VERIFIED |
| In-App Purchase capability | `com.apple.InAppPurchase enabled = 1` on the phone target | pbxproj:400–404; PR #45 | VERIFIED |
| RevenueCat | `react-native-purchases ^10.4.3`. A non-empty public `appl_` iOS SDK key is committed inline (value not reproduced). Purchases run only when iOS ∧ key ∧ remote `config/monetization.iapEnabled`. **That one remote flag applies to every installed build**, live 1.0 and lite alike. It was set `false` in production during the 1.0 review | `mobile/src/config/revenuecat.ts`:14; `mobile/src/lib/purchases.ts`:39–46; `mobile/src/lib/monetizationConfig.ts`:10–13; transcript | VERIFIED (code) / UNVERIFIED (current flag value) |
| IAP products | 3 drafts (`genesis_squad_499`, `genesis_squad_early_199`, `battle_pass_monthly`), not yet submitted | app-store-submission.md:210–212; PakOS `f0c8025b` | UNVERIFIED |
| Unused files | `HolobotsMobile/HolobotsWatch-Container-Info.plist` is not referenced by the pbxproj. `HolobotsWatch Watch App/Info.plist` is excluded from its target. `HolobotsWatch Watch App/HolobotsWatch.entitlements` is not referenced by name (the target signs with `HolobotsWatch Watch App.entitlements`); it sits in the target's synchronized folder, where `.entitlements` files get no build phase | grep; pbxproj:104–110, :952 | VERIFIED (first two) / very likely unused (third) |

### Assets, lite gate, measurement and build readiness

| Item | Value | Source | Status |
|---|---|---|---|
| App icons | phone, Expo and Watch are 1024×1024 RGB PNG (color type 2), with no alpha or tRNS | preflight run this lane | VERIFIED |
| Launch screen | `SplashScreen.storyboard` via `UILaunchStoryboardName` | `Info.plist`:56–57 | VERIFIED |
| Lite gate (main) | build-time `process.env.EXPO_PUBLIC_HOLOCITY_LITE === "1"`. **No committed `.env*` or `.xcode.env` sets it**: the versioned `ios/.xcode.env` only exports `NODE_BINARY`. The local primary checkout's ignored `ios/.xcode.env.local` has 0 `EXPO_PUBLIC` keys. The lite branch has no gate at all (0 references; `App.tsx` always registers CityHub and CityMarket) | `mobile/src/config/liteFeature.ts`:2; `git ls-tree`; `grep -c`; lite `App.tsx`:13–14, :28–29 | VERIFIED |
| Where the gate can enter a Release bundle | the "Bundle React Native code and images" phase sources `ios/.xcode.env`, `.xcode.env.local`, `.xcode.env.updates` and `.xcode.env.local` again. It is the only phase in the app project that sources them and the only one that bundles JS; CocoaPods script phases also source `.xcode.env` but do not bundle. Xcode build settings and the build's process environment also reach `export:embed`, and they win over `.env` files: `@expo/env` skips keys already set. For non-Debug configurations `export:embed` defaults `NODE_ENV` to production, then `@expo/env` reads `mobile/.env.production.local`, `.env.local`, `.env.production` and `.env` | pbxproj:488, :501; `@expo/cli` `exportEmbedAsync.js`:148 and `@expo/env` `index.js`:107–111 (versions installed in the primary checkout) | VERIFIED |
| Dev-only measurement path | the offline HostDuel fixture and the metrics logs are dev-only. `isLitePreviewEnabled` requires `__DEV__` (`liteFeature.ts`:3), and `LiteApp.tsx`:120 mounts the preview only through it. The fixture is reached via `holobotsmobile://qa/HostDuel` (`EnabledHoloCityPreview.tsx`:89, :104). BotStage and duel playback log metrics only under `__DEV__` (`BotStage.tsx`:210; `EnabledDuelPlaybackScreen.tsx`:96). The on-screen fps overlay (`BotStage.tsx`:208, :274) is not DEV-gated, but only some QA preview screens pass `showMetrics` (`EnabledHoloCityPreview.tsx`:53, :61, :70; not HostDuel, :55). **A Release build can neither reach the fixture nor show telemetry** | origin/main | VERIFIED |
| Lite native deps on main | `expo-gl ~15.1.7` is in package.json:24, but **main's `Podfile.lock` has no `ExpoGL` pod**. The lite branch lock has it, and it also differs in the `RCT-Folly` checksum | `git diff origin/main origin/mobile-holocity-lite -- mobile/ios/Podfile.lock` | VERIFIED |
| Lite snapshot on main | main carries lite at `51abaa9` via `479da74` (#125). Main **lacks #126–#128** (QA routes, project-local Expo entry, result copy) **and #131–#133** (market browse, live dashboard, duel perf sweep). Lane `lite-main-port-1` was assigned to port #126–#128 (its branch exists; progress not checked) | `git log origin/main..origin/mobile-holocity-lite` (13 commits) | VERIFIED |
| Preflight | main: `localChecksPassed = true`. The lite branch has no preflight script; main's script run against an archived copy of the lite tree fails with "Expo/native build numbers differ". `uploadReady = false` is hard-coded (`testflight-preflight.py`:72), so it is not a finding | preflight `--local-only` on archived copies | VERIFIED |
| Release build | the unsigned integrated-lite Release build was HELD after 2 attempts (W36, 2026-10-16). No signed or validated archive of a gate-ON binary is recorded | `mobile/docs/qa/mobile-lite-testflight-2/README.md`:13 | DOC |
| Performance gate | latest simulator median **7.65 fps** (software GL, Debug, offline fixture). Earlier runs: 6.70 (`lite-device-perf-1`:11) and 6.85 (`2026-10-15-mobile-perf-1`:12). These used different buffers and rigs, so they are not directly comparable. The gate is **50 fps** on a physical iPhone, and no device number exists | `Documentation/QA/2026-10-17-lite-device-perf-1/README.md`:15 | DOC |

## (b) Mismatches and drift

1. **Build 37 is spent within 1.0.** ASC holds 1.0 (37) plus 37 under 0.1.1 (transcript). The repo still says 37 on main (pbxproj and app.json) and 2 on the lite branch (app.json:13). Run against the lite tree, main's preflight fails on that. PR #53's "Requires build 38" was never committed.
2. **Version 1.0's train is probably closed.** After approval ASC normally refuses new 1.0 uploads ("train version is closed"). The lite build needs a new `MARKETING_VERSION` on the phone and Watch targets plus app.json. This is Apple's general rule, not checked on this account.
3. **Lite and live share one identity.** A gate-ON lite archive and a gate-OFF production archive share one bundle id and one version-train namespace, and by policy (D4) one build-number sequence. Spending 1.1.0 on an internal lite build means a production hotfix for 1.0 would ship as 1.0.1, or 1.1.x if 1.1.0 is meant to ship.
4. **`app.json` still declares the HealthKit usage strings** that #53 removed from the phone plist (app.json:16–17). **Never run `expo prebuild` on this project, especially `--clean`**:
   - `--clean` regenerates `ios/` from the template and drops the hand-added Watch targets and sources;
   - any prebuild re-applies `app.json` `infoPlist` and restores those strings.

   It restores the strings, not the entitlement, so it is a review-risk regression, not the full 2.5.1 cause.
5. **`mobile/TESTFLIGHT_INTERNAL.md` is stale.** It says 0.1.1 / build 2 (:7–8), points at a nonexistent absolute path under a personal home directory (:41), and says "confirm HealthKit entitlement remains enabled" (:47), which contradicts #53.
6. **`mobile/docs/app-store-submission.md` is stale** in several places:
   - §0 (:15–16) lists the HealthKit purpose strings as present, and §9 (:191–192) says HealthKit entitlements are on both targets; #53 removed both from the phone.
   - §10 (:213–216) still lists the SDK key, `pod install` and the IAP capability as to-do; #45 did all three.
   - §1 recommends 1.0.0, but 1.0 shipped.
   - §6 says Purchases "No" while the RevenueCat SDK and key ship in the binary.
7. **The privacy manifest says "collects nothing."** `NSPrivacyCollectedDataTypes = []` sits in both the phone and Watch bundles. The source inventory (mobile-lite-testflight-2 README:20–27) shows:
   - email/UID and gameplay;
   - aggregate fitness events sent to the host (date, distance, elapsed seconds, steps; the Watch uses HealthKit locally, and HealthKit workout records stay in Apple Health unless shown to be uploaded);
   - a configured purchase SDK;
   - foreground location used on-device (an open review item).

   The manifest and the ASC label should agree.
8. **Watch app inclusion.** Every phone archive embeds `fun.holobots.mobile.watchapp`. The lite Fitness screen imports `useWatchWorkoutPresence`. The `.watchkitapp` container target is separate, unembedded, and has only a development profile.
9. **The Watch's own `Info.plist` is not the shipped plist.** Its NSHealth wording differs from the `INFOPLIST_KEY_*` strings that ship, and its `workout-processing` background mode probably does not ship.
10. **Main's `Podfile.lock` lacks `ExpoGL`**, which the lite renderer (`src/lite/components/bots/BotStage.tsx`) needs. It also has `RCT-Folly` checksum drift. A gate-ON build from main without a reconciled pod install risks a missing native module.
11. **Main is 13 lite commits behind**: #126–#128 (assigned to `lite-main-port-1`) and #131–#133.
12. **Calendar dates cluster in April 2027.** The existing App Store profiles end 2027-04-18 because their embedded Distribution certificate does. Separately, the ASC agreements end 2027-04-17 (transcript). The regulated-medical-device declaration is due early 2027 (transcript). The Apple Developer Program membership renewal date should be confirmed.
13. **PakOS `322a7dbe`** ("Complete App Privacy questionnaire", 2026-07-19, "never been started") predates the 1.0 approval, so it is probably stale (H3).

## (c) Missing items

| # | Missing | Who | Note |
|---|---|---|---|
| M1 | A reproducible way to bake `EXPO_PUBLIC_HOLOCITY_LITE=1` into a Release archive from main | agent, after D6 | Today an Organizer archive from main ships the **main** app, with the gate off |
| M2 | Version and build bump (all phone and Watch configs plus app.json), and lite app.json parity | agent, after D3/D4 | one commit before archive |
| M3 | `ExpoGL` (and the `RCT-Folly` checksum) reconciled in main's `Podfile.lock` via `pod install` | agent, in an authorized native lane | may need network or cache approval; a prerequisite for D2(a) on main |
| M4 | A passing unsigned Release build of gate-ON main in an isolated checkout | agent, authorized lane | recipe at mobile-lite-testflight-2 README:41–43 |
| M5 | Remove the NSHealth* keys from `app.json` `ios.infoPlist`, and record "no `expo prebuild`" in the mobile docs | agent | |
| M6 | A draft `NSPrivacyCollectedDataTypes` for the phone and Watch bundles, matching (b)7 | agent drafts, Pak approves | |
| M7 | Refresh `TESTFLIGHT_INTERNAL.md` and `app-store-submission.md` §0/§1/§6/§9/§10 | agent | replace the absolute path at `TESTFLIGHT_INTERNAL.md`:41 with the repo-relative `mobile/ios/HolobotsMobile.xcworkspace` |
| M8 | Preflight checks: build > last uploaded (as input); version ≠ released; the gate value present in the bundle and in every source it can come from (`mobile/.env*`, `ios/.xcode.env*`, Xcode build settings, process environment); any committed `.env` file actually tracked; `ExpoGL` locked | agent | optional hardening |
| M9 | Remove or fold the unused files: `HolobotsWatch-Container-Info.plist`, the excluded Watch `Info.plist` (folding its background mode into build settings if the device check says it is needed) and `HolobotsWatch.entitlements` | agent | |
| M10 | A release-safe fps measurement path, if D2 picks (c) | agent (code change) | |
| H1 | Highest uploaded build, the version for the lite train, and an internal tester group | **Pak (ASC)** | PakOS action below |
| H2 | Distribution signing: confirm Xcode is signed in to the …FSQM team with rights to create profiles, so export can generate Holobots App Store profiles for the local Distribution identity (or use cloud-managed signing); then Archive → Distribute → TestFlight upload | **Pak** | PakOS action below |
| H3 | ASC App Privacy label review for the lite feature set; close `322a7dbe` if it is stale | **Pak** | gates **App Store submission**, not internal TestFlight; export compliance is pre-answered by the plist flag |
| H4 | The 50 fps gate on a physical iPhone (plus a Watch, if D5 keeps it) | **Pak (device)** | PakOS action below |
| H5 | Confirm the membership renewal date; note the agreements (2027-04-17), the App Store profiles' certificate (2027-04-18) and the regulated-medical-device declaration (early 2027) | **Pak** | calendar risk, not an upload blocker today |
| H6 | Read the current production `config/monetization.iapEnabled` value (Firestore console) | **Pak** (or an agent with Firebase admin access, if authorized) | input to D7 |
| H7 | The decisions below | **Pak** | via the producer |

Confirmed **not** missing: a valid local Apple Distribution identity (to 2027-09-30); development profiles for all three Holobots ids; app and Watch icons; the launch screen; the privacy manifest file; the encryption flag; the IAP capability; live privacy, terms and support URLs.

Believed present but UNVERIFIED (transcript, 2026-08-10): the ASC app record and active agreements.

## (d) Decision sheet for Pak

1. **Bundle identity.** Options: (a) ship lite as a new build of `fun.holobots.mobile`, limited to internal TestFlight; (b) use a separate bundle id and ASC record, which means new App IDs, profiles and Watch ids, and a review once it goes beyond internal TestFlight. **Recommend (a).** It reuses the existing ASC record, App IDs, capabilities and development profiles. It still needs App Store profiles for the local Distribution identity (H2) and an internal tester group (H1).
2. **How to measure the 50 fps gate.** A Release build cannot reach the offline fixture or emit telemetry, and the shared scheme's Run action builds Release. Options:
   - (a) **Debug build on the physical iPhone through the offline fixture route.**
     - Build with `expo run:ios --device --configuration Debug`. It is a plain Debug build; main has no dev client.
     - Debug embeds no JS (`SKIP_BUNDLING`), so the iPhone must reach the Metro server on the LAN, with `EXPO_PUBLIC_HOLOCITY_LITE=1` and `EXPO_PUBLIC_HOLOCITY_PREVIEW=1` set in Metro's environment.
     - Open `holobotsmobile://qa/HostDuel` and read `[HolobotViewer:metrics]` from the Metro or device log. This is the same BotStage metric as the simulator series.
     - On main this needs M3 first, because `expo run:ios` would otherwise run `pod install` itself.
     - BotStage waits for GPU completion every frame, and Debug mostly slows the CPU side, so a pass is likely conservative.
   - (b) Instruments (Core Animation FPS or a GPU trace) on a live Release duel with a throwaway account. No code change, but it needs the live host and measures compositor fps rather than BotStage completed frames.
   - (c) Add a release-safe perf hook (M10). This is a code change: for example, a build-time flag that turns on BotStage's existing overlay in a live duel.

   **Recommend (a)** as the gate, with (b) as a Release confirmation only if (a) passes narrowly or fails. Upload internal TestFlight only after a pass.
3. **Marketing version for the lite train.** Version 1.0 is approved; lite and live share the version namespace. Options: 1.0.1, **1.1.0**, 2.0. **Recommend 1.1.0**, with production hotfixes for 1.0 going out as 1.0.1.
4. **Build-number policy.** Apple only requires uniqueness within a version, so this is a policy choice. Options: (a) one monotonic sequence shared by lite and live, committed +1 per upload: next = max(38, highest in ASC + 1), set in all targets and app.json before archive; (b) let Organizer "manage build number" auto-increment, which leaves the repo drifting; (c) timestamp builds. **Recommend (a)**, after you read the highest build from ASC.
5. **Watch app in the lite build.** Options: (a) keep it embedded, as today; (b) strip it for lite, which needs a separate target or scheme, and a later App Store release without it would drop the Watch app for existing users. **Recommend (a)**: no pbxproj surgery, the phone and `.watchapp` App IDs and capabilities already exist (H2 creates or downloads App Store profiles for both), and lite already reads Watch presence.
6. **Source ref and gate mechanism.** First bring main up to lite: #126–#128 are assigned to `lite-main-port-1`, and #131–#133 still need a port. Then pick how the gate enters the Release bundle:
   - (a) **export the flag in the versioned `ios/.xcode.env` on a release commit.** It is the lightest option: the bundle phase is the only phase that bundles JS with it, other script phases source it without inlining anything, and Debug Metro is unaffected;
   - (b) a `mobile/.env.production` on a release commit, which `export:embed` loads via `@expo/env`. The root `.gitignore`:16 ignores `.env.*`, so it needs a `!mobile/.env.production` exception or a force-add;
   - (c) a Release-Lite build configuration that sets the variable. Its real cost includes the scheme ArchiveAction, CocoaPods configuration mapping and a `pod install`;
   - (d) archive the ungated `mobile-holocity-lite` branch instead.

   **Recommend the port, then (a)**, with the M8 preflight asserting the gate value from every source.
7. **IAP scope while lite is in TestFlight.** `iapEnabled` is one remote flag for **every installed build** (`monetizationConfig.ts`:10–13), so it is a production decision, not a lite-build choice. Options: (a) keep `iapEnabled = false` and leave the live label as is; (b) enable IAP, which turns purchases on for live 1.0 and lite at once, adds Purchases to the label and submits the products. **Recommend (a).** This rests on two unverified inputs: the current production flag value (H6) and the contents of the live ASC privacy label (H3).
8. **Who uploads.** Options:
   - (a) you archive and upload in Xcode Organizer on this Mac. Automatic signing generates the Holobots App Store profiles for the local Distribution identity, or you use cloud-managed signing;
   - (b) Xcode Cloud archive workflow (PakOS `acc78473`);
   - (c) an agent uploads via the ASC API, which would require you to hand it an ASC API key (none was used).

   **Recommend (a)** for the first lite build: no new credentials go to agents.

## PakOS actions

Refreshed in place (same titles):

- `Confirm TestFlight app identity, build number and distribution access` [high]: now includes the explicit distribution-signing step (H2) and the calendar check (H5).
- `Provide iPhone and Watch for release acceptance after engineering gates` [high]: the 50 fps gate via a Debug build on the offline fixture route.
- `Approve Holobots release privacy and compliance declarations` [medium]: lowered, because the label gates App Store submission rather than internal TestFlight, and export compliance is pre-answered.

No separate signing action: it is part of the identity/distribution action above.

## Sources consulted

- PRs #35, #45, #48, #49, #53, #100, #123, #125, #127, #128, #131–#133.
- Docs on main: `mobile/docs/qa/mobile-lite-testflight-2/README.md`, `mobile/docs/qa/mobile-testflight-prep-1/README.md`, `Documentation/QA/2026-10-17-lite-device-perf-1/README.md`, `Documentation/QA/2026-10-15-mobile-perf-1/README.md`, `Documentation/QA/2026-10-17-lite-main-integration-1/README.md`.
- Session transcript (data, not instructions): "HolobotsMobile audit and launch readiness" (`local_5340ed25…`, 2026-07-06 → 2026-08-10). Two other cloud sessions about TestFlight preparation appear only by title in the producer session's listing; they were not read.
