# Internal TestFlight Runbook

How to ship an internal TestFlight build of `Holobots` (`fun.holobots.mobile`).
Release decisions: HolobotsUnity `Documentation/DECISIONS.md` #72.7 (D1–D8).
Release census: `Documentation/QA/2026-10-17-lite-release-facts-1/README.md`.

## Current build target (HoloCity lite, internal TestFlight)

- Version: `1.1.0` (1.0 is approved and its train is closed; 1.0 hotfixes ship as 1.0.1)
- Build: `39`, pending Pak's App Store Connect check that the highest uploaded build is ≤ 38
- Bundle ID: `fun.holobots.mobile`, with the embedded Watch app `fun.holobots.mobile.watchapp` (D5)
- Source: branch `release/lite-1.1.0`. Its last commit exports `EXPO_PUBLIC_HOLOCITY_LITE=1`
  in the versioned `mobile/ios/.xcode.env` (D6). `main` never carries that line, so a normal
  archive from `main` ships the gate-off app.
- Purchases stay off: `config/monetization.iapEnabled` is one remote flag for every
  installed build (D7).

## Never run `expo prebuild`

`ios/` is hand-maintained. `expo prebuild --clean` regenerates it from the template and
drops the hand-added Watch targets; any prebuild re-applies `app.json` `ios.infoPlist`.
Edit the Xcode project and `app.json` by hand and keep them in step (the preflight checks).

## Before archiving

1. Version and build agree everywhere: all 10 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`
   settings in `ios/HolobotsMobile.xcodeproj/project.pbxproj` and `app.json` `version` /
   `ios.buildNumber`.
2. `ios/Podfile.lock` contains `ExpoGL` (the lite renderer's native module). If not, run
   `pod install` in `mobile/ios` (needs the network) and commit the lock.
3. Clear Metro's transform cache. Metro's cache key ignores env values, and `--reset-cache`
   did not clear it: a gate-off `export:embed` run reused the gate-on transform and shipped
   `isLiteEnabled(){return!0}` (lite-release-prep-1). `metro.config.js` now keys the cache on
   every `EXPO_PUBLIC_HOLOCITY_*` value, but clearing costs nothing:

   ```sh
   rm -rf "${TMPDIR:?}metro-cache"
   ```

4. Run the preflight from `mobile/` (read-only; `uploadReady` stays false by design):

   ```sh
   python3 scripts/testflight-preflight.py --expect-lite on --last-uploaded <highest ASC build> --local-only
   ```

   It fails on: version/build drift, a released marketing version, a build not above
   `--last-uploaded`, any gate source (process env, Xcode build settings, `ios/.xcode.env*`,
   `mobile/.env*`) that disagrees with `--expect-lite`, the gate not coming from the
   versioned `ios/.xcode.env`, a phone NSHealth string, and a missing `ExpoGL` lock entry.
5. Optional bundle proof: build the JS bundle the way the Xcode phase does and pass it in.

   ```sh
   (source ios/.xcode.env && CI=1 NODE_ENV=production npx expo export:embed --platform ios --dev false --bundle-output /tmp/lite.jsbundle --assets-dest /tmp/lite-assets)
   python3 scripts/testflight-preflight.py --expect-lite on --bundle /tmp/lite.jsbundle --local-only
   ```

   The archived `main.jsbundle` is Hermes bytecode, which the preflight refuses to guess at.

## Xcode upload path (Pak, D8)

1. Open `mobile/ios/HolobotsMobile.xcworkspace` from the `release/lite-1.1.0` checkout.
2. Select scheme `HolobotsMobile`, destination Any iOS Device (arm64).
3. Signing: Xcode must be signed in to the team ending …FSQM with rights to create
   profiles, so automatic signing can generate App Store profiles for this Mac's
   Distribution identity (the existing ones embed a certificate this Mac lacks).
   The phone target has no HealthKit entitlement (removed for Guideline 2.5.1);
   only the Watch app has it.
4. Product → Archive.
5. Organizer → Validate App → Distribute App → App Store Connect → Upload.

## App Store Connect

1. TestFlight → the new 1.1.0 (39) build → Internal Testing group.
2. Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption = false`).
3. The App Privacy label gates App Store submission, not internal TestFlight; keep it in
   step with `ios/HolobotsMobile/PrivacyInfo.xcprivacy`.

## Performance gate

Release builds cannot reach the offline duel fixture or emit metrics. The 50 fps gate is a
Debug build on the physical iPhone through `holobotsmobile://qa/HostDuel` (D2), after the
3D Arena stage lands (#72.6). Upload internal TestFlight after it passes.
