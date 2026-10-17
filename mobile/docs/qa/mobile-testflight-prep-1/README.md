# W21 — native city-to-receipt preparation

Target branch: `mobile-holocity-lite`. Base `ddc92c3`. This is an **offline development preview**, not production-host, account, reward, TestFlight, release-performance, or live resolver-migration validation.

## Scope and provenance

The existing city hub → citizen challenge and legacy **START RIVAL DUEL** path remain available. A separate **OFFLINE ACE / WOLF RECEIPT · NO REWARDS** button appears only when `__DEV__`, the city fixture and `EXPO_PUBLIC_HOLOCITY_RECEIPT_QA=1` are all true. The app's offline provider also requires `EXPO_PUBLIC_HOLOCITY_PREVIEW=1`. Neither flag is enabled by default. The fixture is ACE versus WOLF, explicitly separate from the selected citizen’s live challenge. This button plays W10's pinned eight-turn receipt through the real W15 viewer, then returns to the city; it never issues or settles a live battle.

The six receipt adapter/viewer/test/fixture files are taken unchanged from #90 (`b9956eabc6ec9475270eeaa6b622266d8fa7cd3c`). No host-stack code was imported. The lite branch already contains the compressed 12-bot pack. The fixture identifies its original resolver source and seed 17; all sixteen action rows and winner are host-generated fixture data.

Known-bad before: offline screens skipped `AuthProvider`, but importing their shared Firebase module still initialized the production project. Offline preview now selects a separately named `demo-holocity-offline` app and directs Auth, Firestore and Functions to closed `127.0.0.1:9` endpoints. Accidental backend calls fail closed. Named-app reuse does not reconnect initialized emulators, and returning to normal mode finds/creates the default app. Shipping configuration values are unchanged.

## Reproduction and isolation

Use a fresh isolated worktree and a separate Simulator app container. For this evidence only, replace `fun.holobots.mobile` with `fun.holobots.mobile.w21` in the worktree's `mobile/app.json`, `mobile/ios/HolobotsMobile.xcodeproj/project.pbxproj` and `mobile/ios/HolobotsMobile/Info.plist`. This temporary overlay is **not committed**. Restore these three files afterward. Do not apply the overlay to another lane's checkout.

From `mobile/`:

```sh
EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_RECEIPT_QA=1 CI=1 npx expo run:ios --device 70B47994-793B-44B3-BCF6-2CBE9519EF36 --port 8097
```

Existing Metro servers and the existing app container are not stopped or reused. The offline provider has no user and rejects account actions. No sign-in, production call, deploy, Apple account operation, certificate installation, provisioning update, or upload is part of this lane.

## Verification and attempts

- `Expo run:ios`: **first native build attempt passed**, 0 errors / 11 warnings; approximately seven minutes including 12-second Pod install and cold native compilation. iPhone 17 Pro Simulator, iOS 26.5, Debug; no distribution signing proof. Build output is in the vault's `expo-run-ios.log`.
- `npm run typecheck`: passed after the final Firebase reuse correction (`typecheck.txt`).
- Full mobile Vitest: **517 passed / 4 existing skips**, 59 passing files + 1 skipped, before two additional reuse cases. Final focused Firebase isolation check: **6/6 passed**. Do not add these counts as independent tests or call this a 519-test full-suite run. The first isolation test run could not resolve Firebase's native-only persistence import; the explicit Vitest native-entry alias fixed resolution and the retry passed. No test was skipped to make this lane pass.
- Twelve GLBs match their manifest byte counts and are each ≤ 2,000,000 bytes; hashes are in `asset-inventory.json`.
- Native legacy path: dashboard → city → Stall Linen challenge → **START RIVAL DUEL** rendered ACE / TSUIN, HP and command tiles, then LEAVE returned to the citizen list. This was offline local combat, not a host settlement.
- Host receipt preview: city → Stall Linen challenge → separately labelled **OFFLINE ACE / WOLF RECEIPT** → all eight host fixture turns / sixteen action rows → VICTORY. It is **not the selected Stall Linen battle** and does not issue, settle or grant anything.
- Recorder attempt 1 (`simctl` directly to vault) failed before producing video: Cocoa 513 / OSStatus -12204. Attempt 2 through XcodeBuildMCP to `/private/tmp` succeeded, then copied to vault. **Continuous unedited duration 60.21 seconds**, 1206×2622, measured by AVFoundation (`video-info.json`); requested stop at 60 seconds, encoder tail 0.21 seconds. No ffprobe was installed. The city occupies the opening frames, challenge is visible at 0.5 s, receipt at 3 s onward, and VICTORY at 59.9 s.
- Screens were visually inspected; no crash or error overlay occurred. Native logs still include CoreGraphics invalid-context / unsupported-format messages, Watch-not-paired and Expo GL extension diagnostics. This is **not a clean-console claim**; native diagnostic cleanup remains pending. W18 performance acceptance remains held.
- Cleanup: stopped only `fun.holobots.mobile.w21` and the lane's port-8097 Metro; restored all three temporary identity files exactly to the branch base. Shared checkout, existing app/container and other Metro processes were untouched.

## Evidence inventory

All media live under `/Users/pak/HolobotsVault/QA/2026-10-15-mobile-testflight-prep-1/` and are not committed:

| File | Meaning |
|---|---|
| `city-rival-receipt-60s.mp4` | Continuous 60.21-second offline navigation and receipt capture |
| `01-city.png` | Video frame 0.0 s, full city hub |
| `02-challenge.png` | Video frame 0.5 s, selected citizen and distinct offline fixture button |
| `03-playback.png` | Video frame 15.0 s, actual receipt playback |
| `04-result.png` | Video frame 59.9 s, round 8 VICTORY |
| `legacy-city-duel.jpg` | Separate native legacy combat verification, ACE / TSUIN |
| `video-info.json` | AVFoundation duration / dimensions |
| `expo-run-ios.log` | Native build and runtime console output |
| `capture-attempt1.log` | First recorder failure, no video produced |

## TestFlight blocker inventory — no upload work performed

| Area | Repository evidence | Remaining work / status |
|---|---|---|
| Bundle identity | `fun.holobots.mobile` in app config and native target; Watch companion identities also exist | Identity is present, not missing. App Store Connect registration/ownership and matching provisioning are **unverified**, not asserted absent. Temporary `.w21` is simulator evidence only. |
| Signing | Native team ID `5YJJCSFSQM`; automatic signing on Watch targets | Distribution certificate, provisioning entitlement match and account access were not inspected or changed. A successful simulator build does not prove device distribution signing. |
| Version/build | Expo version `1.0`, build `2`; native build `37` | Reconcile the two build-number sources before a release archive and confirm the next unused App Store Connect number. No number was changed. |
| App icon | Expo and native icons both 1024×1024, no alpha | Required icon exists. No missing icon was found. Final art approval is separate from technical presence. |
| Runtime/host | This evidence uses offline fixture; live city path is legacy until producer flip | Live throwaway-account end-to-end and migration acceptance remain pending. Do not ship a fixture preview as host validation. |
| Performance | W18 observed median 6.85 fps versus 50 fps gate | Performance acceptance and proposed optimizations remain HELD; this lane makes no performance fix or acceptance claim. |
| Privacy/capabilities | Native privacy manifest present; app entitlements empty; Watch/health features and usage strings exist | Review intended release capabilities/entitlements and privacy declarations against actual functionality before device archive. No legal declaration is inferred from simulator success. |
| Release evidence | No archive, device validation, upload or App Store Connect inspection | Release validation and explicit upload authorization remain separate future work. No EAS configuration is present; native Xcode distribution remains possible, so EAS absence alone is not a blocker. |

No PakOS action is filed: the requested deliverable is this inventory, not an upload, and no current lane task requires a human account operation.
