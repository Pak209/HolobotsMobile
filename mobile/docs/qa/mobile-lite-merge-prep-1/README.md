# W33 — lite draft integration

2026-10-15. Existing PR #87 remains a draft, base `main`; no new sibling-base PR. Integration started from `mobile-holocity-lite` `ddc92c30888fc6aa91623e70b54000a426c483a0`, rebased its six commits onto main `bad423e` (includes #99), then folded:

| PR | Reviewed source head | Integrated content |
|---|---|---|
| #88 | `29b756e93a75958e2768e9fb6fe07ac47bb63e55` | GLB pack manifest, validator, evidence |
| #90 | `e05844ca3d774f7ec6d23cdf953d929cbc152881` | host receipt playback, fixtures, tests |
| #91 | `150d91f0798c9a5b3965629dd93fec663d686990` | simulator performance evidence (includes `0143525`) |
| #95 | `380c342d6de964cc06be8e22eecbf5292db558d4` | isolated offline Firebase, dev receipt button, native capture evidence |
| #97 | `786cd6f6d36cb05ae84faa40f742746ee4fea9e7` | host hub roster/story flags/cooldowns; live admission hold |
| #98 | `9043ef88ced0ec65e64af56c77147497a9744fc9` | mode-pinned live settlement consumer and already-issued resolver transport |

#97 is folded once before its #98 child. #90/#95 common receipt files converge; #98 viewer is retained exactly. Two UI conflict locations retain both the explicitly offline development receipt button from #95 and the #97 admission hold/#98 live-mode consumer. No runtime behavior beyond these existing PRs is added. GLB files and manifest match #88 byte-for-byte. No Functions diff against main.

## Verification

- Full `npm --prefix mobile test -- --reporter=dot`: **537 passed / 4 existing skips**, **61 passed files / 1 skipped file**, 1.57 seconds.
- `npm --prefix mobile run typecheck`: passed. An initial invocation ran before the last cherry-pick conflict was resolved and reported conflict markers; the completed tree passes.
- `node mobile/scripts/validate-bots.mjs`: **12 bots, 86 clips, 148 identical JS/WASM buffers, 12,102,060 bytes total; zero validation errors**. All individual files below 2,000,000 bytes; maximum 1,681,480. First invocation lacked the isolated tools dependency link; linking the existing pinned tool environment fixed it, with no install or asset rewrite.
- `git diff --check`: passed. Only local dependency links remain untracked; none staged.

## What blocks taking the draft to release-ready review

1. **Live citizen admission remains HELD.** The current legacy host requires a client outcome, the gathering contract omits playable combatants, and there is no pre-issue capability probe. This integration does not create an admission merely to discover its mode. Resolver transport consumes already-issued battles; it does not add an approved intent-selection/admission UX.
2. **Native acceptance is historical, not rerun for this integrated tree.** #95's 60.21-second offline capture is retained, not presented as a live host or current integration run. Native CoreGraphics/Expo GL diagnostics were present. This lane used no simulator, Unity editor or account.
3. **Performance gate remains HELD:** #91 measured simulator median **6.85 fps** versus **50 fps**, launch-to-first-draw **4,194 ms**, peak sampled RSS **550,480 KiB**. No proposed optimization is applied. These are simulator observations, not physical-device claims.
4. **Distribution readiness remains unverified:** Expo build **2** versus native **37** needs reconciliation; signing/provisioning/registered bundle identity, release privacy/capabilities and physical-device validation remain to be checked before any TestFlight upload. No credentials, account, deploy, archive or upload used.

These inherited holds are explicit, not a new request to deploy or operate Pak's account. No GitHub PR is closed or merged by this integration. Producer decides when the draft is ready; #87 stays draft.
