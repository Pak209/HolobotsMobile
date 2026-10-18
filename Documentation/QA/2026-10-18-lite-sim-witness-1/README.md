# lite-sim-witness-1: one simulator witness of the merged HoloCity lite screens

This PR is docs-only. It records one bounded simulator session of the merged lite screens on the GitHub-verified `mobile-holocity-lite` tip `d14e1d3`. That tip includes #131, #132, #133, #137, #139, #141, #142 and #144. Only offline QA routes were used. No account, sign-in, build, install, network install or deploy was involved, and no product code changed.

**Result:** 20 cells captured in one pass, with the known-bad control first in each section.

- Dashboard HOME: PASS, except one coverage gap. The squad LV tabs cannot be reached offline (F1).
- Marketplace: PASS.
- Arena polish: PASS (#144 merged before the run, so step 4 was in scope).
- Duel perf sweep: all 11 arms recorded on the simulator's software renderer.
- DECISIONS #71: no "host" in any product string on screen. See the section below for the QA-only exceptions.

## Run

- **Device:** iPhone 17 Pro, iOS 26.5, simulator `70B47994-793B-44B3-BCF6-2CBE9519EF36`. It was already booted, and port 8081 was free.
- **App:** the cached `fun.holobots.mobile.w64` (build 37, no embedded bundle), launched once with `simctl launch` (PID 48531). Nothing was built or installed.
- **Metro:** run from this lane's sparse worktree at `d14e1d3`. The tree was clean apart from the untracked `node_modules` symlink to the primary checkout's modules (vault `source-head.txt`).
  - Environment: `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN=HomeUnavailable`.
  - Command: `npx expo start --offline --port 8081 --clear`.
  - Result: `iOS Bundled 44792ms index.js (1640 modules)`. No error line and no redbox. The only warning is the known @firebase/auth exports warning (vault `metro.log`).
- **Navigation:**
  - Driver: a scratch mirror of `mobile/scripts/capture-holocity-preview.mjs`. It keeps the same `qa/Login` interstitial (650 ms) before each route, uses the `holobotsw64` scheme (see F4), and waits 6 s per cell.
  - Taps and swipes: simulator input in device points.
  - Each step is timestamped in vault `launch.txt`.
- **Cleanup:** the app was terminated and Metro (PID 48267) was stopped. `lsof -i :8081` came back empty and no Holobots process was left in the simulator. The simulator was left booted, as found.

## Screen → route → capture → result

Captures are in `~/HolobotsVault/QA/2026-10-18-lite-sim-witness-1/`, and every cell is on `GATE_SHEET.png`. I reviewed every cell at full resolution.

| # | Screen | Route / action | Capture | Result |
|---|---|---|---|---|
| 01 | HOME, known-bad control | `qa/HomeUnavailable` (initial screen) | `01-HomeUnavailable.png` | **KNOWN BAD, as designed.** "HOLOS UNAVAILABLE · SYNC UNAVAILABLE", "PILOT UNAVAILABLE · RETRY", ZONES UNAVAILABLE, CONNECT TO VIEW SQUAD. No profile defaults leak in. |
| 02 | HOME (#132, #142) | `qa/Home` (desktop-account-3 identity fixture through `readDashboardAccount`) | `02-Home.png` | **PASS.** Header "TIER 2 · 2,480 HOLOS · 37 SYNC" (Holos is synthetic offline data). Pilot line "PILOT Throwaway Pilot". ZONES "2 OF 4 OPEN". Uniform scale: the round side buttons measure 156 × 156 px. Centred footer: label centroid 603.0 px on a 1206 px screen, pitch 251–253 px; outer frame margins 36 / 38 px. **Squad LV tabs: not reachable offline (F1).** |
| 03 | HOME zones panel | tap ZONES (108, 509 pt) | `03-Home-ZonesModal.png` | **PASS.** The City's place names print verbatim: HoloCity OPEN, Neon Forest OPEN, Tide Hollow NOT YET AVAILABLE, Sky Reach NOT YET AVAILABLE. Subtitle: "Destination status from your account." |
| 04 | HOME → MARKET | BACK, then tap MARKET (327, 677 pt) | `04-Home-MarketTap.png` | **PASS.** MARKET opens CityMarket ("HOLOCITY / MARKETPLACE · BROWSE THE STALLS."). The harness label still reads "Home", because it tracks deep links, not in-app navigation. |
| 05 | CityMarket → back | tap back chevron (355, 100 pt) | `05-Market-BackToHome.png` | **PASS.** Back returns to the opener, Home (`{ from: "Home" }`). |
| 06 | Marketplace, known-bad control | `qa/CityMarketUnavailable` (catalog schema `vendor-1`) | `06-CityMarketUnavailable.png` | **KNOWN BAD, as designed.** UNAVAILABLE, "The market catalog could not be verified. Refresh to retry.", REFRESH. No stale rows. |
| 07 | Marketplace browse (#131, #142) | `qa/CityMarket` | `07-CityMarket.png` | **PASS.** CITY CATALOG, 5,000 HOLOS (this market fixture's balance, separate from Home's), and "The City sets every price and keeps your stock." BUY on the three supplies. |
| 08 | Marketplace browse, scrolled | swipe 620 → 180 pt | `08-CityMarket-scroll1.png` | **PASS.** NOT SOLD HERE on every non-requestId row: Arena Pass, Gacha Ticket, Energy Refill, EXP Booster, Rank Skip, Wildcard Blueprints and Champion Booster. Cosmetic note F3. |
| 09 | Marketplace browse, end | swipe 620 → 180 pt | `09-CityMarket-scroll2.png` | **PASS.** NOT SOLD HERE on the Common, Elite and Rare boosters. BUY on the Medium and Heavy Buddy Units. Footer: "PRICES, STOCK AND HOLOS COME FROM THE CITY." |
| 10 | Purchase confirm | `qa/CityMarketConfirm` | `10-CityMarketConfirm.png` | **PASS.** "BUY MEDIUM BUDDY UNIT FOR 300 HOLOS? Your Holos and stock update after the City confirms." CONFIRM / CANCEL. |
| 11 | Purchase confirmed | `qa/CityMarketBought` | `11-CityMarketBought.png` | **PASS.** "PURCHASE CONFIRMED · Medium Buddy Unit". Holos re-read 5,000 → 4,700. |
| 12 | Purchase refused | `qa/CityMarketRefused` | `12-CityMarketRefused.png` | **PASS.** "Not enough Holos." with no raw code. Holos stay at 5,000. |
| 13 | Signed out | `qa/CityMarketSignedOut` | `13-CityMarketSignedOut.png` | **PASS.** "SIGN IN FIRST · The City prices every stall for your account. Sign in to browse." |
| 14 | Arena, known-bad replica | `qa/ArenaPolishKnownBad` | `14-ArenaPolishKnownBad.png` | **KNOWN BAD, as designed.** Raw `too_fast`, "RESUME HOST MATCH", unframed. |
| 15 | Arena admitted (#144) | `qa/ArenaPolishAdmitted` | `15-ArenaPolishAdmitted.png` | **PASS.** ARENA ENTRY ACCEPTED · READY TO FIGHT. ACE and HARE cards with the LV 4 / LV 12 lower-left corner tab. START FIGHT and CANCEL · REFUND ENTRY. |
| 16 | Arena pending confirm | `qa/ArenaPolishConfirming` | `16-ArenaPolishConfirming.png` | **PASS.** "CITY CONFIRMING · The City is confirming your win…", "saved on this device and is sent again automatically", spinner, FORFEIT MATCH. No code is shown. |
| 17 | Arena withheld receipt | `qa/ArenaPolishWithheld` | `17-ArenaPolishWithheld.png` | **PASS.** VICTORY!, "ACE LV 4 · HARE LV 12 · CITY RECEIPT · NO REWARDS", "Daily Arena rewards reached · resets 00:00 UTC", EXIT ARENA. |
| 18 | Arena payoutCapped notice | `qa/ArenaPolishCapped` | `18-ArenaPolishCapped.png` | **PASS (ANTICIPATED field).** "Daily Arena rewards reached · this match pays no rewards" above START FIGHT. |
| 19 | Arena refund closure | `qa/ArenaPolishRefund` | `19-ArenaPolishRefund.png` | **PASS.** First on-screen witness: #144's run captured this cell blank. ENTRY REFUNDED, "ACE LV 4 · HARE LV 12 · CITY RECEIPT", "Cancelled before the fight · 50 Holos returned". |
| 20 | Duel perf sweep (#133) | `qa/HostDuelPerfSweep` | `20-HostDuelPerfSweep-complete.png` | **RECORDED.** "PERF SWEEP COMPLETE · last baselineLive 4.6 fps" over the park-arena duel. "OFFLINE FIXTURE · NO REWARDS". |

## Duel perf baseline: simulator software-GL baseline, not a device number

**Renderer:** `"renderer":"Apple Software Renderer"`, `"vendor":"Apple Inc."`, `"version":"OpenGL ES 3.0 APPLE-23.1.1"`, `defaultFramebufferSamples` 4.

- All 11 `[HolobotViewer:probe]` lines report the same renderer.
- This is the iOS 26.5 simulator's CPU rasteriser. It says nothing about the iPhone GPU path.

**Every number below is a simulator software-GL baseline, not a device number.** The 50 fps gate stays HELD on Pak's physical-iPhone sweep. The method is in `Documentation/QA/2026-10-17-lite-duel-perf-2/README.md`, "Device run".

**Method (unchanged from #133):**

- Each arm remounts the GL context, warms up for 1 s, then counts completed frames for 5 s.
- `fps` = completed frames ÷ 5 s. The 1 s spread is the completed frames in each whole second.
- Nothing touched the simulator during the sweep: no input and no screenshot. The sweep ran for about 99 s.
- Raw data: vault `arms.jsonl`, `probes.jsonl`, `inventories.jsonl` and `sweep-summary.json`.

| # | Arm | Knobs | fps (this run) | 1 s spread | Native completion ms | Buffer × samples | × baseline | #133 fps (× its baseline) |
|---|---|---|---|---|---|---|---|---|
| 1 | baseline | production | **4.6** | 4–5 | 220.8 | 402×788×4 | 1.00× | 8.2 (1.00×) |
| 2 | shadowOff | null control | 5.0 | 3–7 | 201.2 | 402×788×4 | 1.09× | 8.2 (1.00×) |
| 3 | postOff | null control | 4.6 | 4–5 | 214.0 | 402×788×4 | 1.00× | 8.4 (1.02×) |
| 4 | msaa0 | `msaaSamples` 1 → 0 | **9.6** | 9–10 | 103.6 | 402×788×0 | 2.09× | 18.6 (2.27×) |
| 5 | halfRes | buffer ½ per axis | **10.8** | 10–12 | 92.3 | 201×394×4 | 2.35× | 18.8 (2.29×) |
| 6 | anim30 | mixer 30 Hz | 4.8 | 4–5 | 209.9 | 402×788×4 | 1.04× | 7.4 (0.90×) |
| 7 | cullBack | look-changing, measurement only | 7.0 | 7–7 | 144.1 | 402×788×4 | 1.52× | 10.4 (1.27×) |
| 8 | combo | msaa0 + halfRes + anim30 | **18.0** | 18–18 | 54.2 | 201×394×0 | 3.91× | 29.2 (3.56×) |
| 9 | comboHideRival | combo, WOLF hidden (triangle probe) | 31.2 | 31–32 | 30.8 | 201×394×0 | 6.78× | 52.4 (6.39×) |
| 10 | baselineEnd | production (drift control) | 4.8 | 4–5 | 209.4 | 402×788×4 | 1.04× | 8.6 (1.05×) |
| 11 | baselineLive | production, cue runner on | 4.6 | 4–5 | 211.1 | 402×788×4 | 1.00× | 8.0 (0.98×) |

JS submit stayed under 1 ms on every arm (`renderMs` 0.52–0.89). `baselineLive` re-rendered React 4.8 times per second, about once per completed frame, as in #133.

**Why the absolute fps is about half of #133's:**

- The software renderer runs on the Mac's CPU. During this run, Unity Editor 6000.5.4f1 was using about 458 % CPU, and the load average was 11.4 on the 10-core M4 (vault `host-load.txt`).
- The ratios between arms match #133 within the noise: msaa0 2.09× vs 2.27×, halfRes 2.35× vs 2.29×, combo 3.91× vs 3.56×. The noise floor is the five null or no-op arms, at 4.6–5.0 fps.
- So this is not a regression signal, and it is no evidence about the device.

## DECISIONS #71 ("the City", never "host")

No product string on any of the 20 cells says "host". The authority reads "the City" throughout: Home "CITY ›", the Marketplace copy and footer, CITY CONFIRMING, CITY RECEIPT, and the duel's "‹ CITY".

"HOST" appears in two places, and neither is a violation:

- **Cell 14,** the deliberate pre-fix replica ("RESUME HOST MATCH").
- **The dev-only QA captions** that `src/qa/ArenaPolishPreview.tsx` draws under cells 14–19 ("says HOST", "host-economy-hardening-2 payoutCapped…", "host #143 payoutWithheld…"). These are QA-harness strings. #144's offline release export found the QA cells absent from the release bundle (vault `2026-10-18-lite-arena-polish-1/bundle-hits.txt`). I did not re-run that export here.

## Findings

Screenshots are referenced by vault path under `~/HolobotsVault/QA/2026-10-18-lite-sim-witness-1/`. No product code was changed in this lane.

- **F1. Squad LV tabs can't be reached offline (coverage gap, not a fail).**
  - Route: `qa/Home`. Cells: `02-Home.png`, `01-HomeUnavailable.png`.
  - Seen: TRAVEL SQUAD always reads "CONNECT TO VIEW SQUAD".
  - Why:
    - `TravelSquadPanel` loads a squad only when it has a uid (`HomeScreen.tsx:597`), and `OfflinePreviewAuthProvider` sets `user: null` (`AuthContext.tsx:608`).
    - The desktop-account-3 fixture's `travelSquad.holobotIds` is `[]` anyway.
  - So the "ACE LV n" squad title (`presentSquadTitle`, `hostDashboard.ts:265`) has unit-test coverage only, with no on-screen witness.
- **F2. Home info card level vs the City's level (question for the producer, not a fail).**
  - Cell: `02-Home.png`.
  - Seen: the info card shows "ACE · CHAMPION · Lv 12". That comes from the preview profile roster (`HomeScreen.tsx:394`, `selectedHolobot.level`). The City fixture on the same screen has ACE at level 2.
  - The two sources disagree on one screen in this preview. #132 scoped the City LV to the squad title. Whether the main card should also read the City snapshot is a product call.
- **F3. The Marketplace list scrolls under the status bar (cosmetic, low).**
  - Cells: `08-CityMarket-scroll1.png`, `09-CityMarket-scroll2.png`.
  - Seen: once the header scrolls away, rows pass behind the clock and the Dynamic Island. There is no top safe-area mask.
- **F4. The repo capture script can't drive the cached app as-is (tooling).**
  - `mobile/scripts/capture-holocity-preview.mjs` hard-codes `holobotsmobile://` and writes into `Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots`.
  - The cached w64 build registers only `holobotsw64` and `fun.holobots.mobile` (its Info.plist `CFBundleURLTypes`).
  - This run used a scratch mirror with the same Login interstitial: vault `capture-driver.mjs.txt`.
- **F5. Brief/route mismatch (note).** `src/qa/HoloCityPreview.tsx` has no "before-identity" fixture route. The registered known-bad dashboard control is `HomeUnavailable` (both City reads failed), so that is cell 01.
- **F6. Perf absolute numbers ran low because of Mac CPU load (note).** See above. The ratios hold, and no device claim is made.

On cell 19: the refund closure presented this time, unlike #144's run. This run opens `qa/Login` for 650 ms between cells, and #144's run did not. So the cell witnesses the closure copy. It does not by itself prove that the in-app Modal-on-Modal race is gone. The quit-confirm overlay (`3239459`) still needs a live fight to witness.

## Not witnessed

- The squad LV tabs (F1).
- `ArenaPolishStalled` and `ArenaPolishPaid`. They were outside this brief, and #144's run witnessed both.
- A live fight, the quit confirm, CONTINUE FIGHT and the KO guard. Each needs a live `start`.
- Any device fps. Pak runs the physical-iPhone sweep separately.

## Follow-ups (for other lanes; nothing fixed here)

1. Add a QA route that injects a confirmed squad state (for example `HomeSquad`), so the next witness can show the squad LV title (F1).
2. Producer call on F2: should the Home info card's LV come from the City snapshot?
3. Add a top safe-area mask or inset to the Marketplace scroll content (F3).
4. Give `capture-holocity-preview.mjs` `HOLOCITY_SCHEME` and output-directory overrides, so lanes can drive the cached w64 app without a scratch copy (F4).

## Evidence (`~/HolobotsVault/QA/2026-10-18-lite-sim-witness-1/`)

- `GATE_SHEET.png`: all 20 cells, labelled, known-bad first.
- `01-…png` to `20-…png`: full-resolution captures (1206 × 2622).
- `metro.log`, `launch.txt` (launch, every route, tap and swipe with UTC timestamps, and cleanup), `source-head.txt`.
- `arms.jsonl`, `probes.jsonl`, `inventories.jsonl`, `sweep-summary.json`, `host-load.txt`.
- `capture-driver.mjs.txt`.
