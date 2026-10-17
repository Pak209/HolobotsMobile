# W64 — lite simulator end-to-end witness

This main-based report witnesses the integrated `mobile-holocity-lite` source at `e589fb605506b4e1bf1b520371289759dc695147` (open #87). It does not carry the lite feature branch into main. Main and lite differ by 392 files at the start of this run.

## Isolation and reproduction

A detached worktree at `/private/tmp/holobots-w64-run` uses physical `mobile/node_modules` installed with `npm ci --ignore-scripts --no-audit --no-fund`, and physical Pods (`pod install`, 93 pods). No dependency directory is symlinked. Debug Xcode build uses `/private/tmp/w64-derived`, iPhone 17 Pro / iOS 26.5, UDID `70B47994-793B-44B3-BCF6-2CBE9519EF36`, and `CODE_SIGNING_ALLOWED=NO`.

The disposable overlay changes the simulator identity to `fun.holobots.mobile.w64`, URL scheme to `holobotsw64`, and Metro URL to `127.0.0.1:8098`. It also journals the existing completed-native-render metrics from the explicit receipt QA route. It changes no renderer, combat result or gameplay logic. The shared checkout is unchanged.

Metro: `EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_RECEIPT_QA=1 EXPO_NO_TELEMETRY=1 npm run start -- --localhost --port 8098`. Both preview flags are opt-in and default off. The named demo Firebase app uses closed loopback ports, so the route cannot touch production. The displayed ACE/WOLF receipt is the clearly labelled offline host fixture; selecting a citizen does not make that fixture a live citizen battle. No Pak account, credentials, cloud deployment, upload, or Unity editor use.

## Evidence

Vault root: `/Users/pak/HolobotsVault/QA/2026-10-16-lite-sim-build-1/`. `run-overlay.patch` records every temporary source edit. Dependency logs are `w64-npm-ci.log` and `w64-pods.log`. Media stays outside git.

## Verified native results

- Native Debug compilation succeeded. The first MCP call lost its response at its 300-second transport timeout while xcodebuild continued; an incremental confirmation returned exit 0 / `BUILD SUCCEEDED`. Pod installation had overwritten an identity overlay applied before it finished: the first app was installed with the default identifier, detected from its built Info.plist, and **never launched**. No account/data was read. The post-Pods identity-only incremental build returned exit 0 and its built `CFBundleIdentifier=fun.holobots.mobile.w64` was verified before installation/launch. No application-source defect was found or fixed. The reproducible order is Pods first, overlay second, build third, built-identity assert before install.
- Isolated `.w64` app launched, CityDay offline fixture opened, Line Cyan challenge opened, explicit ACE/WOLF host-receipt fixture selected, all **8 rounds / 16 actions** completed to recorded **VICTORY**. The ordinary native-city entry correctly refused signed-out access; no login was attempted. The development-only URL parser was aligned with the isolated URL scheme.
- TypeScript passed. Focused city hub / host adapter tests **20/20 passed**. Main `testflight-preflight.py --local-only` passed local inventory, with upload readiness still false. No full-suite or Release validation is claimed.
- Final continuous **60.0117-second** recording, **1206×2622**, warm assets: `city-rival-receipt-60s.mp4`. Playback speed unchanged, no edits. Earlier first-receipt recording **75.755 seconds** retained as `city-rival-receipt-first.mp4`.
- Reviewed five-cell sheet: `/Users/pak/HolobotsVault/QA/2026-10-16-lite-sim-build-1/CONTACT_SHEET_WARM_VERIFIED.png`. Every cell comes from the final 60-second recording: `frame-5.png` at 0.5 s city map; `frame-30.png` at 3 s challenge; `frame-150.png` at 15 s playback; `frame-400.png` at 40 s playback; `frame-598.png` at **59.8117 s**, ROUND 08 / VICTORY, 2219 ms load label. `first-frame-59.9.png` is a separately labelled cold-run frame, not a final-sheet cell.

| Completed-native-draw measurement | First receipt | Warm receipt |
| --- | ---: | ---: |
| Active samples | 24 | 24 |
| Median fps | **6.1** | **5.4** |
| Sample min–max fps | 5.7–6.9 | 3.8–6.5 |
| Measured wall window | 50.376 s | 50.157 s |
| Completed frames in window | 309 | 270 |
| Window frames / wall seconds | 6.134 fps | 5.383 fps |
| GL context → first draw | 3241 ms | 2219 ms |
| Drawing surface | 402×874 | 402×874 |
| ACE + WOLF compressed bytes | 1,787,952 | 1,787,952 |

These are **iPhone 17 Pro / iOS 26.5 Simulator, Debug, Apple software-renderer completed GL draw batches**, with existing native completion barriers. They are not video fps, compositor-presented fps, physical-device performance, or app cold-start latency. First receipt used a fresh app container but retained OS/Metro caches; second reused loaded assets. `loadMs` begins at GL context setup, not process launch. Playback metrics were selected from the existing `DuelPlayback:metrics` logs where `0 < elapsedMs < 51200` (16 actions × 3200 ms); result-card idle samples are excluded. The wall window starts at the initial zero-frame journal and ends at the final included sample. The 50 fps gate **fails in both runs**. No optimization applied. Raw journals, Metro logs and [numeric summary](performance-summary.json) preserve scope/provenance. Recording was active during measurement; instrument overhead is not subtracted.

Metro reports existing `expo-local-authentication@55.0.13` versus Expo-expected `~16.0.5` and environment colour warnings. No Metro application error was observed. Runtime log capture returned no error lines, but that is not a clean-console acceptance claim for every native subsystem; prior native diagnostic holds remain. The isolated app and Metro are stopped after capture.

## Remaining TestFlight gates

No upload readiness is implied by a Debug simulator witness. The previous W36 unsigned Release bundle failure used a symlinked Expo dependency; physical dependencies correct that harness arrangement here, but a fresh unsigned Release/archive gate remains separate. Main local preflight remains an inventory, not distribution approval.

Engineering gates: merge/review lite #87 and reconcile main build parity; unsigned Release validation; live throwaway-account acceptance once authorized; measured device performance, remaining native diagnostics, privacy manifest decisions implemented after owner review. The existing 50 fps acceptance gate remains held until fresh accepted evidence clears it. No performance optimization is authorized by this witness.

Existing PakOS human actions were checked and remain open (no duplicate filed):

- `18feaddc-df15-41ae-a068-74856dda8352` — Confirm TestFlight app identity, build number and distribution access. App Store Connect → My Apps → Holobots → App Information: confirm `fun.holobots.mobile`; TestFlight → iOS Builds: select a build number above the highest uploaded. Developer account → Certificates, Identifiers & Profiles: confirm phone and Watch identifiers, distribution provisioning, Watch HealthKit capability. Return decisions before a separately authorized archive/upload.
- `7fb0f8fc-b639-4067-b588-79b4f64bd2ff` — Approve Holobots release privacy and compliance declarations. Review W36's source inventory; App Store Connect → App Privacy and export-compliance questionnaire: approve collected-data categories, linkage/purposes, tracking and required-reason manifest semantics. No legal attestation is invented.
- `14a32fdc-c7dd-425c-b9b1-58b5e7aa5859` — Provide iPhone and Watch for release acceptance after engineering gates. Connect authorized devices and approve the separately authorized signed build and permission flows; run city/receipt/fitness/Watch acceptance and performance.
