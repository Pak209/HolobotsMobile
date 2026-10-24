# Lite vs OG mobile: harsh UX critique (2026-10-24)

Lane `lite-vs-og-ux-critic-1`, report only. No app code changed on main.

Pak's ask: Lite feels clunky on the simulator. The OG layout, nav positions and responsiveness should stay; only the look should change.

**Verdict.** The HoloCity restyle is not what makes Lite feel clunky. Three changes made outside the restyle do:

1. **Live three.js / expo-gl bots on non-battle screens.** They starve the JS thread. Inventory runs at a **14.2 fps median** against OG's 60. Sync freezes for **2.18 s**. The Change Holobot picker freezes for **1.58 s**.
2. **OG's one-tap nav keys were folded into a ≡ "pilot menu".** Every section-to-Home, Stats, Settings, Story or PvP trip now costs **2 taps instead of 1**.
3. **Every screen uses a different back/home control.** Lite has four idioms in four positions. The Home rail also moved **44 pt down**, so an OG-trained thumb misses it.

## Method (reproducible)

- **Build.** Own detached worktree at `origin/main` `7178bcb`. One Debug simulator build (`CODE_SIGNING_ALLOWED=NO`) with an isolated identity `fun.holobots.mobile.uxcritic`. Metro ran on `127.0.0.1:8099` and was started and killed by PID. The disposable overlay is not committed; it is at `~/HolobotsVault/QA/2026-10-24-lite-vs-og-ux-critique/raw/run-overlay.patch`.
- **Harness.** `UxHarness.tsx` mounts the **real tab navigator and real screen set** of either `MainApp.tsx` (OG) or `LiteApp.tsx` (Lite). It runs under `OfflinePreviewAuthProvider`, which supplies the synthetic `previewProfile` plus 4 fixture parts. It uses the offline Firebase app; no account was used and no network writes were made. Lite Home and CityHub get the same offline fixtures the existing preview harness uses.
- **Gates and flags.**
  - OG: `EXPO_PUBLIC_UX_HARNESS=og`.
  - Lite: `EXPO_PUBLIC_UX_HARNESS=lite EXPO_PUBLIC_HOLOCITY_LITE=1 EXPO_PUBLIC_HOLOCITY_PREVIEW=1`.
  - The production Lite gate is the build-time `EXPO_PUBLIC_HOLOCITY_LITE=1` in `src/config/liteFeature.ts`. Changing it needs a Metro restart with `--clear`.
- **OG baseline.** OG on main is still the pre-Lite tree (`src/screens`, `MainApp.tsx`). Lite has lived separately in `src/lite` since `479da74`, so main's OG has not drifted and is the reference.
- **Devices.** iPhone 17 Pro (402×874 pt) for the full flows. A created-then-deleted iPhone SE 3rd gen (375×667 pt) for Home only. The simulator panel permission for the SE was not granted, so SE is static screenshots plus layout math.
- **Instruments.** JS-side logs: TOUCH, NAV (state change, then 2 rAF), FPS (1 s windows) and STALL (rAF gap >50 ms). Tap-to-visible latency comes from `simctl recordVideo` frame signatures aligned to the TOUCH wall clock (±1 frame).
- **Caveats.** These are Debug builds on the simulator's software GL, so absolute numbers are worse than on a device. The OG-vs-Lite *gaps* are like-for-like: same binary, same harness, same fixtures. Signed-out stubs (Lite CityMarket "SIGN IN FIRST", Quests/Training "can't show your runs") are an offline artefact on both sides and are not scored.

## Evidence

Everything below is in `~/HolobotsVault/QA/2026-10-24-lite-vs-og-ux-critique/`:

- **`SHEET_og_vs_lite.png`** (1500×5574): 12 OG|Lite pairs. Every cell is labelled with the screen and its measurement.
- **`OG_vs_LITE_side_by_side.mp4`** (5.8 MB, 20 s): 6 synced flows. Operator idle time between Lite's two menu taps is cut and labelled.
- **`shots/`**: the screenshots.
- **`raw/`**: Metro UXLOG journals, `latency-*.jsonl`, the harness and the tool scripts.

## Measured side by side (iPhone 17 Pro, Debug)

| Action | OG | Lite | Δ |
|---|---|---|---|
| Home → Arena (visible) | 164 ms, 1 tap | 163 ms, 1 tap | = |
| Home → Inventory (visible) | 165 ms | 248 ms | +50 % |
| Home → Sync (visible / settled) | 257 / 621 ms | 154 ms, then a **2,180 ms JS freeze** | **much worse** |
| Section → Home | **1 tap**, 72–90 ms | **2 taps** (≡ 61–90 ms + DASHBOARD 164–316 ms) | +1 tap |
| Change Holobot picker | 182 ms, then smooth | 228 ms, then **1,576 + 657 + 392 ms freezes** | much worse |
| Equip-part modal | 126 ms | 176 ms | +40 % |
| JS fps median, Inventory | **60** (0 stalls ≥100 ms) | **14.2** (min 3.3; 76 stalls ≥100 ms) | **−76 %** |
| JS fps median, Sync | **60** | **17.1** (min 0.8; 12 stalls) | **−72 %** |
| JS fps, Arena / Quests / Training / Home | 60 / 60 / 59 / 60 | 59 / 59 / 59 / 58 | = |

Screens with no 3D are as fast as OG. Every Lite screen that embeds `HolobotViewer` is not. The recording shows the same thing: OG wrote 455 frames because it is idle when nothing changes. Lite wrote 2,571 frames over a similar session because the GL bot is always animating.

### Taps to key flows

| Flow | OG | Lite |
|---|---|---|
| Start an arena battle | 2 (ARENA → PAY HOLOS) | 2, but PAY HOLOS sits about 70 pt lower behind the new 3v3 notice |
| PvP | 2 (ARENA → PvP key) | **3** (ARENA → ≡ → PVP ARENA) |
| Story | 2 (any section → STORY key) | **3** (≡ → STORY) |
| Stats or Settings from a section | 1 | **2** (≡ → …). Inventory's menu has **no PILOT STATS at all** |
| Back to Home from a section | 1 | **2** on Arena/Inventory/Quests/Training. 1 on Fitness/CityMarket/CityHub, each with a different icon |
| Start training | 2 | 2 (dimmer SELECT) |
| Workout | 2 (SYNC → GO, mid-screen) | 2 (GO pushed to the bottom edge, about y 835 of 874 pt) |
| Equip a part | 2 | 2 |
| Check Holobot stats | 1 (Home) | 1 |
| Rival / city fight (Lite only) | n/a | ≥4 (10 pt "CITY › RIVALS" text → MEET YOUR RIVALS → rival → challenge) |

## Top problems (harsh, ranked by felt impact)

1. **3D bots on non-battle screens make Lite clunky.** This is the root cause of the feel. `HolobotRosterCard` passes `live` to `HolobotViewer` on Inventory (first card), Fitness (partner card) and the picker modal (selected row); `HolobotStatsModal` also embeds it. `BotStage` renders three.js on the JS thread and calls `gl.finish()` synchronously every frame (`src/lite/components/bots/BotStage.tsx` ~L445). That deliberately bounds GPU backlog, but on these screens it pins the JS thread to the GL rate. Taps, scroll handlers and setState all queue behind it: 14 fps on Inventory, 0.8–17 fps with a 2.2 s freeze on Sync, 1.6 s frozen after opening the picker. OG shows a static PNG in the same spots and holds 60.
2. **OG's direct nav keys were replaced by ≡.** OG's `HomeCogButton` is a vertical column of 52 pt circular keys: Home, Stats, Settings, Story, plus PvP on Arena. Lite's version (`src/lite/components/HomeCogButton.tsx`) is a single 48 pt ≡ that opens a 224 pt menu. That adds 1 tap and about 0.6–0.9 s of human time to every trip, and makes Home, Story and PvP invisible until opened.
3. **Four different back/home idioms in four places:**
   - ≡ at (359, 97) on Arena, Inventory, Quests and Training.
   - ⌂ + ⚙ squares at (311, 105) on Fitness.
   - ‹ at (356, 101) on CityMarket.
   - ⌂ square at (356, 101) on CityHub.

   OG used one control: the same yellow circle cluster.
4. **The Home rail moved 44 pt down.** OG's rail is pinned at `top: 72` inside the canvas; the first key's centre is at 177 pt. Lite uses `top: "14.5%"` plus the safe-area padding (`HOME_PAGE_PADDING`), so the centre is at 221 pt. A tap where OG's Stats key was (y 177) hits nothing on Lite.
5. **Footer hotspots were re-spaced.** Labels moved from x 210/622/1008/1398 to a 400-unit pitch, which shifts the columns +10 to +23 pt right. The footer also sits 19 pt lower (y 715 → 734). The hotspots are still wide enough to catch OG taps, but the icons visibly moved. That is the "Nav Icon Buttons locations have changed" Pak noticed.
6. **Primary CTAs lost prominence.** OG's SEND, SELECT and BUY are filled bright yellow. Lite's SEND and SELECT are dim teal on navy and read as disabled. GO dropped from mid-screen to the bottom edge.
7. **Arena's start buttons were pushed down.** A two-line 3v3 notice was inserted above ARENA TIERS, so PAY HOLOS / USE PASS moved from about y 573 to y 642 pt. PvP moved from a visible key into the menu.
8. **Whole-Home re-render every second, forever.** In `useRivalStatus` (`src/lite/hooks/useRivalStatus.ts` L59–63), `setInterval(() => setNow(Date.now()), 1000)` re-renders the entire SVG artboard in `HomeScreen` once per second. Tab screens stay mounted, so this keeps running while Home is hidden behind Inventory or Sync and competes with the GL loop there.
9. **On SE, Lite shrinks its tap targets.** `homeCompactFactor` scales the rail to 0.877, so 52 → 45.6 pt keys, and the status strip to 8.8 pt text. "CITY › RIVALS", the only Home entry to the city/rival loop besides ENTER HOLOCITY, is 10 pt text (8.8 pt on SE).
10. **The picker and menus are less dense.** The picker fits 3.5 rows on screen against OG's 6, so more scrolling to choose a bot. The Inventory ≡ menu overlaps the tab row (HOLOBOTS/PARTS) and leaves out PILOT STATS.

Minor issues:
- The Equip modal title falls back to the bold system font instead of HoloDisplay.
- The header status strip shows "UNAVAILABLE · RETRY" in a 10 pt muted line. That is offline-only here, but it sits in prime real estate.

### Where Lite is genuinely better (keep these)

- **Safe areas.** On SE, OG's art runs under the status bar ("HOLOBOTS" is clipped by the clock row). Lite insets correctly.
- **No overlap.** OG's 5-key column overlaps content (STORY sits over the 3V3 tile and the Training energy box). Lite's single ≡ never covers content. The fix below keeps the keys but moves them clear of content.
- **Footer and part slots are centred.** Footer and part slots are centred on x = 900 with one hotspot per column. Empty part slots show "+".
- **CityHub** is a clear new loop. It runs at 58 fps with no 3D.
- **Screens without 3D match OG speed.** Arena, Quests, Training and CityHub navigation are as fast as OG (≈160 ms visible).

## Fixes: keep the HoloCity look, restore OG layout, flow and speed

Ranked by impact × effort.

| # | Fix | Effort | Files |
|---|---|---|---|
| 1 | **No live 3D outside battles and the explicit detail view.** Default `HolobotRosterCard live={false}` and render the static full-art PNG, as OG does. Remove `live` from Inventory (L102), Fitness (L191) and HolobotPickerModal (L51). Mount `HolobotViewer` only after an explicit "VIEW 3D" tap in HolobotStatsModal. Expected: Inventory and Sync back to about 60 fps, no 1.5–2.2 s freezes. | **S** | `src/lite/components/HolobotRosterCard.tsx`, `src/lite/screens/InventoryScreen.tsx`, `src/lite/screens/FitnessScreen.tsx`, `src/lite/components/HolobotPickerModal.tsx`, `src/lite/components/HolobotStatsModal.tsx` |
| 2 | **Restore OG's direct key column in `HomeCogButton`.** Use the same keys, order, 52 pt size and offsets as `src/components/HomeCogButton.tsx` (Home, Stats, Settings, Story, PvP-when-provided), skinned with Lite keycap art. Add HOLOCITY as one more key, or keep ≡ only for overflow (HoloCity, legal). Push the column right of content and below the header so OG's overlaps are not reintroduced. | **S** | `src/lite/components/HomeCogButton.tsx` |
| 3 | **One back/home control everywhere.** Fitness, CityMarket and CityHub should use the same `HomeCogButton` at the same coordinates instead of bespoke ⌂/‹/⚙ squares. | **S** | `src/lite/screens/FitnessScreen.tsx`, `src/lite/screens/CityMarketplaceScreen.tsx`, `src/lite/screens/EnabledCityHubScreen.tsx` |
| 4 | **Put Home geometry back on OG's coordinates.** Rail at `top: 72` (canvas-relative) as OG. Footer label and icon x back to 210/622/1008/1398 with OG icon boxes. On width-bound phones (≥ 390 pt) drop `HOME_PAGE_PADDING` so the canvas sits where OG's does. Keep the inset only when height-bound (SE), where Lite is better. Do not shrink the rail below 48 pt on SE. | **S–M** | `src/lite/config/homeLayout.ts`, `src/lite/screens/HomeScreen.tsx` (`utilityStack`, `HomeUtilityRail`) |
| 5 | **Stop the 1 Hz full-Home re-render.** Move `now` into a small `<RivalCountdown/>` leaf (or `useSyncExternalStore` with a per-second subscription) and pause it with `useIsFocused`. Set `freezeOnBlur: true` in the Lite `Tab.Navigator` `screenOptions` so hidden tabs stop rendering. | **S** | `src/lite/hooks/useRivalStatus.ts`, `src/lite/screens/HomeScreen.tsx`, `LiteApp.tsx` |
| 6 | **Make primary CTAs loud again.** Filled `theme.colors.accent` for SEND, SELECT, BUY and GO (OG's filled-yellow hierarchy in cyan). Move GO back above the fold, in OG's slot under the reward row. | **S–M** | `src/lite/screens/QuestsScreen.tsx`, `src/lite/screens/TrainingScreen.tsx`, `src/lite/screens/FitnessScreen.tsx` |
| 7 | **Arena order as OG.** Put the 3v3 "not open yet" copy inside the disabled 3V3 tile or under the start buttons so PAY HOLOS / USE PASS return to OG's y. Restore the PvP key (via fix 2). | **S** | `src/lite/screens/ArenaScreen.tsx` |
| 8 | **City entry as a real button.** Give HOLOCITY a ≥44 pt key in the rail or a header plate instead of the 10 pt "CITY › RIVALS" text. That cuts the rival-fight path by one tap and fixes the SE size. | **S** | `src/lite/screens/HomeScreen.tsx` |
| 9 | **If 3D must stay somewhere outside battle,** make `BotStage` cheap: render at 30 fps, stop the rAF loop when the idle clip is static, drop `antialias`/MSAA for thumbnails, and do not call `gl.finish()` per frame outside duel playback. | **M** | `src/lite/components/bots/BotStage.tsx` |
| 10 | **Polish.** HoloDisplay on modal titles, Inventory menu includes PILOT STATS, picker row height closer to OG (6 visible rows). | **S** | `src/lite/components/HolobotPickerModal.tsx`, `src/lite/components/HomeCogButton.tsx`, the equip-modal styles in `src/lite/screens/HomeScreen.tsx` |

Fixes 1–5 are all S. Together they remove both root causes: JS-thread starvation from GL, and the nav relocation and indirection. They touch no contract, payload or authoritative logic; this is presentation only.

## Root causes of the "clunky" feel

1. **expo-gl / three.js on the JS thread, synchronously finished every frame,** placed on everyday screens: Inventory, Sync and the picker. This is the dominant cause, and it is measured.
2. **Indirection:** a menu replaced the visible one-tap keys, adding 1 tap to most section exits.
3. **Inconsistency:** four nav idioms, and nav anchors moved 10–44 pt from OG muscle memory.
4. **Continuous re-render:** a 1 Hz Home timer on an always-mounted, SVG-heavy screen, with no `freezeOnBlur`.
5. **Not causes** (measured, ruled out): navigation stack choice (both use the same bottom-tabs navigator with the tab bar hidden), image sizes, and screens without 3D. Those are within ±10 ms of OG.

## Cleanup

The worktree `/private/tmp/holobots-lite-vs-og-ux`, Metro (PID-killed), the isolated app, the derived data and the SE simulator are all removed at hand-back.
