# lite-cpu-capture-2 — route preparation; native witness HELD

Base: mobile-holocity-lite `51abaa9e79013005570bec6c31f34b2ed11f7f3b` (#121 merged). This QA-only change adds an own-key-allowlisted `EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN` initial route and three explicit buttons: KNOWN BAD → ROUND 1 → RESULT. Existing URL listener and production navigation are unchanged. The app already gates this harness behind `__DEV__` and `EXPO_PUBLIC_HOLOCITY_PREVIEW=1`.

## Diagnosis and checks

The cached `fun.holobots.mobile.w64` app registers `holobotsw64` and `fun.holobots.mobile`, while the existing JS listener accepts only `holobotsmobile://qa/...`; another cached `.w21` app registers that scheme. This explains the incompatibility in the prior Home-screen attempt, without claiming delivery logs from that run.

- Selector tests: **10 passed**, 355 ms total / 2 ms assertions. First discovery run found no tests because the file was outside configured `__tests__`; moved it once, then passed.
- Full TypeScript check: **passed**. First run lacked two tracked `docs/contracts` files due sparse checkout; restored the tracked directory, then passed.
- No production navigation, account, reward, battle outcome, or host logic changed.

## Authorized third native attempt — HELD

2026-10-17, iPhone 17 Pro / iOS 26.5 / simulator `70B47994-793B-44B3-BCF6-2CBE9519EF36`. Existing cached app only. Boot succeeded. Metro initial CLI setup rejected mutually exclusive `--offline --localhost` before a server or app existed; corrected once to `--offline --port 8081` with CI=1 and both preview environment variables (initial screen ArenaAdmittedKnownBad).

One app launch succeeded, PID **39723**. One owned Metro session **19956** served port 8081. Bundling failed after **2460 ms / 1 module**: the linked cached dependency's `expo/AppEntry.js` imports `../../App` relative to `/private/tmp/holobots-mobile-testflight-prep-1/mobile`, where App no longer exists. Native redbox captured; no QA route rendered. No reload, second app launch, fourth attempt, build, install, download, account access, deployment or credits. App stop succeeded; Metro terminated exit 0.

Current lite package entry is `expo/AppEntry`; there is no tracked local `mobile/index.js`. The historical successful capture had an untracked local entry. A future separately authorized attempt needs a reviewed local-entry/Metro resolution strategy; this PR does not change that strategy or consume another attempt.

**Round 1 and result images remain HELD.** The intended fixture would show actual BattleArenaView and BattleResultsModal with ACE LV 4 / HARE LV 12, labeled QA / SIMULATED / NO REWARDS. Its card callbacks are no-ops: even a successful future image would prove fixture presentation, not a live account fight, reward, or combat authority. Native route-picker behavior also remains unwitnessed.

## Evidence inventory

Vault: `/Users/pak/HolobotsVault/QA/2026-10-17-lite-cpu-capture-2/`.

Sheet `GATE_SHEET.png`, 1500 × 860, all four cells inventoried:

1. Known-bad first: prior attempt's Home-screen image, reproduced from 2026-10-17-lite-arena-admitted-flow-1; intended route absent.
2. Actual third-attempt redbox image, before any QA view rendered.
3. Text diagnostic: 10 selector tests and typecheck passed; source-only QA navigation change. Not a native screenshot.
4. Text diagnostic: round/result HELD; cleanup completed; no fourth attempt. Not a native screenshot.

Raw image `03-native-entry-error.jpg`; prior image `01-prior-home.jpg`. No evidence images committed. All existing live-account, authority, build, deploy and native-witness holds remain.
