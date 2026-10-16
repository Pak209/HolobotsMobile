# W36 — local TestFlight preparation

Focused PR against main `5deab8c`; no lite feature carry. Apply this config commit when #87 lands. Expo build is reconciled from **2 to existing native 37** for phone and Watch; **37 is not asserted unused in App Store Connect**. Bundle identities and signing settings are unchanged.

## Local checks

`python3 mobile/scripts/testflight-preflight.py --local-only` inventories identity/version, phone/Watch entitlement plists, usage text, privacy manifest syntax and actual PNG channel format. Phone, Expo and Watch icons are 1024 square **RGB PNG color type 2**, with no alpha channel or transparency chunk. Watch HealthKit entitlement exists; phone has no HealthKit API use (iPhone workouts use motion/location), so no capability is invented.

The default preflight exits **2 with uploadReady=false** while release holds remain. `--local-only` exits zero for local checks but still reports uploadReady=false. It never reads accounts, credentials or provisioning profiles and never asserts privacy approval. Six regression tests cover original build mismatch, missing capabilities/plist/icon, alpha-bearing PNG format and the readiness distinction.

- Main mobile: **439 passed / 1 existing skip**, 48 test files; TypeScript passed.
- Preflight: **6/6 passed**. Main local check passed. Same checker passed integrated #87 `e589fb6` with explicit `--expo-config` pointing to the corrected main app.json; no source carry or shared edit.
- **Unsigned integrated-lite Release validation HELD after two failed attempts.** Attempt 1: 11.4 s, explicit `-sdk iphonesimulator` incorrectly overrode the Watch dependency SDK and produced WatchKit resolution errors. Attempt 2: 421.9 s, SDK override removed, native compilation progressed but Metro bundling failed with one error resolving `../../App` from the symlinked shared `node_modules/expo/AppEntry.js`; 2,627 warning lines (mostly repeated dependency warnings). This is an isolated dependency/harness-path blocker, not a diagnosed application source bug. No third build run. No app installed/launched, no signing/account operation or simulator boot.
- Evidence outside git: `/Users/pak/HolobotsVault/QA/2026-10-16-mobile-lite-testflight-2/`: `holobots-w36-release-build.log`, `holobots-w36-release-build-retry.log`, `w36-preflight.json`, `w36-lite-preflight.json`, `w36-release-readiness.json`.

## Source-based privacy inventory for owner review

This is an engineering inventory, not a legal attestation. Existing `NSPrivacyCollectedDataTypes=[]` must not be read as proof that the app collects no data. Required-reason declarations and tracking=false are preserved; owner-reviewed disclosure decisions are not fabricated.

| Observed flow | Evidence | Questions for the owner / App Store disclosure review |
|---|---|---|
| Email/password authentication, username, authenticated UID and game profile | `src/contexts/AuthContext.tsx` signup/login; `src/types/profile.ts`; Firebase configuration | Confirm contact information/user ID categories, linkage, retention/deletion policy and app-functionality purpose. Password goes through Firebase Auth, not a new application storage field. |
| Gameplay progress, roster, rewards, wins/losses, leaderboard state | `src/types/profile.ts`; signup profile writes in AuthContext | Confirm gameplay/user-content categories and linkage to account; review public leaderboard scope. |
| Fitness activity submitted to host; Watch event includes date, distance, elapsed seconds and steps | `src/lib/fitnessSyncClient.ts`; `src/hooks/useWatchBridge.ts` `WatchWorkoutEvent`; Watch `WorkoutViewModel.swift` | Confirm fitness/health disclosure and intended uses. Watch uses HealthKit; distinguish local Apple Health storage from the aggregate workout event sent to host. |
| Foreground coordinates used to derive distance/speed on iPhone | `src/hooks/useWorkout.ts` previousCoordsRef and location callback | Raw coordinates were observed in local calculations; do not assume they are uploaded. Review full release paths before deciding location collection categories. |
| Purchase SDK configured; account-linked entitlements/purchase handling | `src/config/revenuecat.ts`, `src/lib/purchases.ts` | Review RevenueCat/App Store purchase-data processing, identifiers and processor declarations for the shipped SDK/configuration. |
| SDK required-reason API manifest | `ios/HolobotsMobile/PrivacyInfo.xcprivacy` | UserDefaults, boot time, timestamps and disk space reasons exist. Confirm they match release behavior and aggregated dependency manifests; syntax checks are not semantic approval. |

## Exact human-only steps (no operation performed)

1. **Apple account and build identity:** App Store Connect → My Apps → Holobots → App Information: confirm `fun.holobots.mobile`; TestFlight → iOS Builds: report the highest uploaded build and choose the next unused number. Developer account → Certificates, Identifiers & Profiles: confirm phone plus `fun.holobots.mobile.watchkitapp` / `fun.holobots.mobile.watchapp`, distribution provisioning and Watch HealthKit capability. Do not upload yet; return the approved number/capabilities to the agent so config and archive validation can be updated together.
2. **Privacy/compliance attestation:** review the inventory above, then App Store Connect → Holobots → App Privacy and release export-compliance questionnaire. Approve/correct linked-data categories, purposes, tracking status and required-reason manifest semantics. Supply decisions; the agent can implement reviewed manifest/config edits afterward. The existing native non-exempt-encryption=false value has not been independently attested here.
3. **Physical-device acceptance:** after engineering gates below clear, connect an authorized iPhone (and Watch if included), allow a separately authorized signed build, and run city/receipt/fitness/Watch permission flows plus measured native performance. Device interaction and permission approval require Pak; an agent can prepare and inspect the test run.

## Engineering holds — not human-only actions

New live citizen admission is still held; resolver readiness does not authorize a flag flip. Historical median **6.85 fps < 50 fps** remains held, with optimization explicitly not authorized here. Current native diagnostic investigation and live throwaway-account end-to-end remain engineering work. Signed device/archive/upload validation waits for the owner decisions above and separate authorization. No deploy, upload, production account, Unity editor or scene change.

## Prepared next native attempt — not executed

After a separately authorized bounded retry, create a fresh detached checkout of the accepted lite head, install dependencies physically inside its `mobile/node_modules` with the committed package lock (`npm ci`), and install Pods into that checkout with the committed Podfile/lock. Do not symlink node_modules or Pods from another checkout. Check `realpath mobile/node_modules/expo/AppEntry.js` remains under this new checkout before building; validate the generated Expo entry resolves the checkout's App. Reapply only reviewed app.json build parity.

Run the same unsigned Release command without a global SDK override, using a new isolated DerivedData path and a 15-minute process timeout: `xcodebuild -workspace mobile/ios/HolobotsMobile.xcworkspace -scheme HolobotsMobile -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath <isolated-path> CODE_SIGNING_ALLOWED=NO build`. Capture logs. Stop on timeout or error and inspect the local dependency resolution before another attempt. This recipe is preparation only; dependency install, Pods mutation and a third build were not run.

PakOS actions filed: `18feaddc-df15-41ae-a068-74856dda8352` (identity/build/distribution), `7fb0f8fc-b639-4067-b588-79b4f64bd2ff` (privacy/compliance), `14a32fdc-c7dd-425c-b9b1-58b5e7aa5859` (hardware after engineering gates).
