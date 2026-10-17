# Lite main integration candidate — DRAFT / mobile checks passed

Main base `35f8f70a6dc5994aa0d62da63b70bfff91aebfaa`, integrated lite `51abaa9e79013005570bec6c31f34b2ed11f7f3b` (includes merged #121). This is a main-based integration candidate, **not a merge to main, release, or verified build**. #87 remains draft. No account, deploy, native build, install from network, credits or editor.

## Result and boundaries

`EXPO_PUBLIC_HOLOCITY_LITE === "1"` enables the lite application. Missing/other values select the original main app through a lazy entry. `MainApp.tsx` is byte-identical to main's original App.tsx. Existing main screens/components remain at their original paths; changed lite presentation and its necessary consumers live under `src/lite`. This avoids applying the global lite theme/HUD or new Arena flow while the flag is OFF. The app bundle still contains integration dependencies/assets; the gate controls evaluation/presentation, not binary size.

CityHub, receipt, and QA entry exports defer their implementation imports until an enabled mount; OFF returns null before consumer hooks mount. QA additionally uses the existing DEV/PREVIEW restrictions. A new startup/deep-link selector being developed by another lane is not included.

The deterministic import census isolated **124 modules / 97 runtime** from the merged tree, rather than cloning src. `isolation-manifest.json` records pinned source paths/hashes and destinations. `Tools/LiteIntegration/integrate.py` then `gate.py` describe the one-time transformation of a freshly merged pinned tree; they are not an idempotent update command for the resulting candidate. Guarded route implementations are renamed `Enabled*` after manifest isolation. The scripts use the authorized fixed scratch checkout path.

Six shared seams are deliberately retained: AuthContext, Firebase, holobots display mapping, profile mapping, profile types, and pure cityHub parsing. AuthContext and SDK identities are not duplicated. The offline AuthProvider/demo backend requires LITE+DEV+PREVIEW; OFF Firebase reuses an existing [DEFAULT] app or initializes production. Review corrected the original length-only selection for the newly possible named-offline-only registry: getApp() would throw there. Empty/default production behavior is preserved; the recovery regression is authored but unrun. Added hostRank/storyFlags mapping properties are conditional on LITE, preserving OFF reply shape; optional types are shared. No new host authority or settlement policy is introduced.

Main native/config is preserved: **134 files under ios/android/app.json compare byte-for-byte**. In particular main Podfile.lock is retained, so an eventual native ON build must reconcile any new Expo dependencies through a separately authorized native lane. Metro's existing lite asset extensions and JS dependency union are included. Package conflicts preserve both main test-renderer packages and lite Three types. No lockfile install/regeneration or native build was performed; package/lock correctness remains unverified until checks.

## Verification / attempt ledger

Static checks passed: original MainApp bytes, 134 native/config files, no duplicated AuthContext/Firebase modules, Python syntax for generation scripts, and working-diff whitespace check. The final whole-integration whitespace scan reports three inherited blank-at-EOF warnings in the old mobile-testflight-prep-1 text logs; it is not wholly green. A reviewer caught a missing getApp import in the prepared exact-OFF branch; source and generator were corrected without a test invocation.

**Initial dependency setup was HELD after two failures. The subsequent explicitly approved exact-URL cache restore and single full mobile/typecheck run passed (details below). No local host/rules or native run.**

1. `npm install --prefix /private/tmp/astra-integration-deps --offline --ignore-scripts --no-audit --no-fund react-test-renderer@19.0.0 @types/react-test-renderer@19.0.0` failed ENOTCACHED for react-is metadata. Log `/Users/pak/.npm/_logs/2026-10-17T22_32_58_103Z-debug-0.log`.
2. Authorized final route: `npm pack react-test-renderer@19.0.0 @types/react-test-renderer@19.0.0 --offline --ignore-scripts --pack-destination /private/tmp/astra-integration-deps` failed ENOTCACHED for react-test-renderer metadata. Log `/Users/pak/.npm/_logs/2026-10-17T22_33_27_488Z-debug-0.log`.

No network fallback or foreign cache mutation followed those failures. The producer then explicitly approved one exact-URL offline restore and one full mobile/typecheck run. Proposed regression tests cover actual lazy entry evaluation OFF/ON, direct disabled CityHub mount, and preview flag conjunction; existing Firebase tests were updated for the additional rollout gate and original default-app branch. They were initially source-only; the approved follow-up run now executes them. Shared-provider identity currently has static singleton evidence, not a new runtime provider test. The candidate remains draft pending producer review and remaining native/live acceptance.

## Holds and handoff

#121's native round-one/result capture and live acceptance remain HELD; PvP authority and 3v3 limitations remain. Client practice simulation remains unverified, including the existing Holocity #2 finding. Simulator performance stays at historical6.70 median FPS versus50 target; no new performance claim. Native distribution/build-number/signing/privacy/device decisions are unchanged. The JS gate does not clear any release hold.

## Approved validation follow-up

Initial CI typecheck passed, but mobile reported4 failing files,5 failed/869 passed/6 skipped and3 suite-load errors. Corrections add React imports to the classic-JSX lazy entry/wrappers, align the item mock and HARE asset URL with isolated paths, and make the mock factory import the intended main move-kit/ability modules. The generation script reproduces each correction.

The explicitly approved exact cached tarball URLs restored react-test-renderer19.0.0 and its types without metadata resolution/network. Own `/private/tmp/astra-integration-deps` overlay reuses existing cached dependencies; app and renderer resolve the same React19.0.0 file and object. Existing HARE LFS asset hydrated locally (1,681,480 bytes; no fetch).

**One approved run: TypeScript noEmit exit0 in3.652s; full mobile82 files passed/1 skipped,888 tests passed/4 existing skipped,0 failed, Vitest4.43s.** No repeat. Logs `typecheck.txt`, `mobile-tests.txt`, `results.json` accompany this README. Previous Functions/rules CI was green before these client-only corrections; no fresh local host/rules claim. No native build or live-account test.


Evidence: `/Users/pak/HolobotsVault/QA/2026-10-17-lite-main-integration-1/GATE_SHEET.png`,1500×1000, four inventoried diagnostic cells:1 original unconditional CityHub/global presentation;2 proposed isolated lazy gate;3 static preservation checks;4 approved mobile/typecheck results with native/live holds. No native screenshots or acceptance implied; only the recorded mobile/typecheck success is claimed. Root owns inbox and clean worktree handover.

## Merge-path guidance

#125 is the flagged integration candidate; the older ungated #87 remains draft and is a superseded integration path. Do not separately merge ungated #87 after #125. A normal merge of #125 preserves lite51abaa9 ancestry and may auto-close #87; a squash may not. No PR was merged or closed by this lane. Producer review still decides readiness, and the6.70FPS/native/live/authority holds remain despite888 passing tests.
