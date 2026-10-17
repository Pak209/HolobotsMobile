# Lite merge decision — 2026-10-17

**Recommendation: prepare a default-OFF, flagged integration onto main; keep #87 draft until its integration checks pass. Do not keep lite as an indefinite second product branch. This is a recommendation, not authorization to merge or release.** Existing preview flags do not gate the shipped lite UI; a production-safe integration gate still needs implementation and review.

## Pinned observation

Main `cbc5e3591b099568e7a2ccf58ba27830285c648d`; lite `92def490b28704e703731c3b2fd85d3817ec5151`; common ancestor `bad423e8da25cd56dd315166bbf838e59c7b5936`. GitHub branch API matched local refs. Main has 49 unique commits, lite 21. Lite's merge-base diff is **367 files, +16,503 / -2,433 lines**; no functions paths in that diff. This is not the full post-merge runtime validation.

Read-only merge-tree reports **2 conflicted paths**: `mobile/package.json`, `mobile/package-lock.json`. Package conflict is main's `@types/react-test-renderer` / `react-test-renderer` 19.0.0 versus lite's `@types/three` ^0.166.0; all three are needed for their existing consumers. A future authorized integration should retain them and reconcile the lockfile, then run fresh dependency-backed CI. No conflict resolution or dependency install was performed. First diagnostic could not write Git temporary objects in sandbox; the bounded escalated diagnostic succeeded. No checkout/index merge occurred.

## PR / CI snapshot

| PR | State / target | Evidence and remaining holds |
|---|---|---|
| [#87](https://github.com/Pak209/HolobotsMobile/pull/87) | OPEN, DRAFT → main; head 92def490 | No current check rollup. Historical integrated suite 537 passed / 4 skipped is not current-main acceptance. |
| [#117](https://github.com/Pak209/HolobotsMobile/pull/117) | MERGED → lite; head 382996e9 | 3/3 CI jobs green; historical 545 passed / 4 skipped. Own Arena native witness and opponent/PvP sources were held. |
| [#119](https://github.com/Pak209/HolobotsMobile/pull/119) | MERGED → lite; head 590d8614 | 3/3 CI jobs green. Full 549/4 before final tier guard, final focused 5/5. Adapter/fixture preparation did not close live CPU/PvP holds. |
| [#121](https://github.com/Pak209/HolobotsMobile/pull/121) | OPEN → lite; head 9c7570aa | 3/3 CI jobs green; reported 562 passed / 4 skipped, typecheck green. **Not in lite head.** Durable CPU admission code prepared, but simulator round1/result failed to reach fixture after two attempts; live witness held, PvP authority gap held, 3v3 refuses before charge. Client practice simulation remains unverified (Holocity #2 finding unchanged). |

CI jobs above are Mobile tests + typecheck, Functions build + unit tests, Firestore rules. #121 run39065347114. Green PR checks prove their tested PR contexts, not a resolved main+lite+#121 integration. No fresh tests/builds were run in this research lane.

## Why flagged integration

A long-lived branch keeps two dependency graphs and multiplies drift (already49/21 commits). A staged main integration can use one CI baseline while preserving disabled routes. Gate requirements are **proposed, not existing**: default OFF, cover CityHub navigation and direct entry/deep links, prevent disabled routes from mounting host/account consumers, preserve existing main flows, and test OFF/ON behavior. Existing `mobile/App.tsx:85` registers CityHub unconditionally; `App.tsx:119` only guards developer preview with `__DEV__ && EXPO_PUBLIC_HOLOCITY_PREVIEW === "1"`. Firebase's matching preview flag (`mobile/src/config/firebase.ts:45`) selects closed demo endpoints; receipt QA additionally requires its separate flag. Neither is a production rollout flag. Broad HUD/theme changes also need a review: a route flag alone cannot revert global styling/import dependencies.

Suggested next authorized lane: resolve two dependency conflicts; review #121 separately without treating its native hold as cleared; implement the actual gate and protect old paths; run full mobile/typecheck + existing host/rules CI on the resolved head; obtain native signed-out and later authorized throwaway live witness. Only then ask Pak whether to take #87 out of draft. No sibling-based new PR or merge performed here.

## Release decision is separate

Latest committed same-rig performance evidence is `Documentation/QA/2026-10-16-mobile-duel-perf-1/README.md`: **6.05 → 6.70 median completed-frame FPS**, 24 samples each, normal draws4→2; Apple Software Renderer/iPhone17Pro iOS26.5. **50 FPS remains HELD.** The 14,999-triangle ACE candidate was rejected for changed visual fidelity; original assets restored. Do not cite older6.85 FPS as latest or infer physical-device performance.

`mobile/app.json` declares bundle `fun.holobots.mobile`, version1.0, build2. Native pbxproj lines680/719 use build37 and team5YJJCSFSQM; Watch targets also exist. Existing1024px icons are present. Before a future TestFlight upload, the human-controlled steps are: confirm App Store Connect ownership/registered identity and next unused build number; authorize distribution signing/provisioning with matching Watch/health entitlements; approve accurate privacy/capability declarations; provide physical-device acceptance and explicit upload authorization. These are **unverified**, not proven absent. Agent-doable build-number reconciliation, native diagnostic cleanup, feature gating and integration testing must precede that handoff. EAS configuration absence alone does not block native Xcode distribution. No credentials, account console, signing, device, archive or upload inspected/performed here. No new PakOS action: this lane is a decision inventory, not a release operation blocked on human access.

## Evidence inventory

Vault `/Users/pak/HolobotsVault/QA/2026-10-17-lite-merge-prep-2/GATE_SHEET.png`: 1500×1100 diagnostic decision sheet, four cells: (1) known-bad current drift/conflicts; (2) PR/CI state, especially unmerged#121; (3) recommended default-OFF integration versus long-lived branch; (4) performance/store holds. No screenshots/native witness are implied. All numbers are pinned research or cited historical measurements. No editor, build, install, account, deploy, credits or merge.
