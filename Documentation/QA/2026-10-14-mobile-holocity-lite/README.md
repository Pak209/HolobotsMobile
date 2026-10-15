# HoloCity mobile lite — simulator QA

Shared draft PR: [#87 — HoloCity lite](https://github.com/Pak209/HolobotsMobile/pull/87), `mobile-holocity-lite` → `main`. Left unmerged; CI results are attached to that PR.

Work is isolated in `HolobotsMobile-lite`, branch `mobile-holocity-lite`, based on `5d57afa` on main. W5, W6 and W7 share one integration PR because they share the requested branch. Nothing is merged or deployed. No production game account is used.

## Worker deliveries

- [W5 — mobile skin](W5.md): shared HUD tokens, source item icons, typography, dashboard, roster pattern and existing screens. [Implementation notes](../../../mobile/docs/HOLOCITY_SKIN.md).
- [W6 — native bots and portrait playback](W6.md): all twelve compressed rigs, native Expo GL renderer, receipt-only animation and the ACE/WOLF three-round fixture. [Asset and renderer notes](../../../mobile/docs/bot-assets.md).
- [W7 — city hub](../../../mobile/docs/qa/mobile-holocity-lite/w7/README.md): Unity-layout district map, story gates, host roster rings, workshop and citizen rival integration.

## Environment and evidence boundaries

The native Debug app builds with Xcode 26.6 on an Apple M4 Mac with 16 GiB RAM and runs on iPhone 17 Pro Simulator, iOS 26.5. The simulator's OpenGL renderer is Apple Software Renderer. Screenshots are native 1206 × 2622 captures. They use the explicitly labeled, opt-in offline fixture harness; they do not claim a played production account.

`EXPO_PUBLIC_HOLOCITY_PREVIEW=1` is gated by `__DEV__`; it mounts no Firebase auth provider. Synthetic values supply screen data, and fixture account mutations are disabled. `holobotsmobile://qa/<Route>` remounts a preview screen. The capture script is `mobile/scripts/capture-holocity-preview.mjs`.

The actual #80 host code was exercised separately against a loopback Firestore emulator and a disposable demo UID: 3 integration cases and 13 existing host/rules cases passed. The demo documents were deleted and the emulator stopped. [Captured replies and exact commands](../../../mobile/docs/qa/mobile-holocity-lite/w7/README.md).

## Portrait concept interpretation

The park and skyline are a [generated static environment plate](../../../mobile/assets/battle/README.md). Robots remain live GLB meshes. The scene uses a low 0.9 m camera with a 35 mm focal length, a large foreground player in three-quarter back view, and a smaller rival at greater depth. Source rigs receive an outer presentation scale to give them comparable 1.45 m display heights; their source geometry and animations stay intact.

The HUD uses the app's rectangular Carbon command plates, adapted to two rows. Source trigger glyphs are display-only during replay. HP, stamina, costs, damage, misses and the result are copied from the fixture. No combat decision runs inside DuelPlayback. Each captured round runs the real cue sequence and pauses after its recorded impact.

The current `rivalBattleHost` contract has no round trace. The dedicated `holocity-duel-preview-1` fixture is explicitly synthetic. Existing observed mobile combat can be passed separately and is labeled as a client trace; real host replies without a trace show only their recorded settlement. Live host-authoritative round playback is HELD on a future host trace contract. The open #80 gathering dependency remains unmerged and undeployed, as requested.

Differences from the concept: the backdrop is painted and does not move with the camera or receive dynamic shadows; the actual promo GLB silhouettes and source motion differ from the painted robots; source rigs have no hit-flinch take, so hit reaction holds Idle with an 8 cm recoil and a two-frame shake. Guard falls back to Idle plus cyan rim when the asset has no guard clip. Physical-device performance is not measured in this simulator-only task.

## Reproduce

From `mobile/`, start Metro with `EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_NO_TELEMETRY=1 npm run start -- --localhost --port 8083`, build the iOS Debug scheme using that Metro port, then open the desired QA deep link.

From repository root, with the simulator booted:

```sh
HOLOCITY_CAPTURE_WAIT_MS=16000 node mobile/scripts/capture-holocity-preview.mjs DuelRound1 DuelRound2 DuelRound3
```

Bot routes are `BotACE`, `BotWOLF`, and the other ten manifest IDs in upper case. General routes include Home, Roster, Detail, Inventory, Fitness, Marketplace, Arena, Gacha, Training, Quests, Login, Leaderboard, Settings, Overworld and WebSection. City routes include CityDay, CityNight, CityLocked, CityZones, CityRivals and CityWorkshop. Overworld and WebSection captures show offline loading/blocked states, not a verified authenticated web session.

## Final measurements

All numbers below are measured, and decimal MB are used. The integrated branch has one shared bundle; sizes cannot be independently attributed to three workers.

| Item | Result |
| --- | ---: |
| Production iOS Hermes bundle | **7,452,173 bytes / 7.452 MB** |
| Same bundle, gzip | **3,119,148 bytes / 3.119 MB** |
| Entire Expo iOS export, 197 files | **107,763,524 bytes / 107.764 MB** |
| W5 indexed item icons | **105 files / 18,938,563 bytes** |
| W6 all twelve GLBs | **12,102,060 bytes / 12.102 MB** |
| Largest bot, HARE | **1,681,480 bytes / 1.681 MB** |
| Fleet route first native draw | **927–2,656 ms** |
| Fleet per-bot median native fps, 370×520 | **8.4–12.9 fps** |
| Final duel after other screens, 402×832 | **2,009 ms; 3.0–3.9 fps** |
| Final duel, app launched directly into replay | **2,632 ms; 6.9–8.2 fps** |
| W7 new raster assets / new dependencies | **0 / 0** |

[Bundle byte evidence](evidence/bundle-size.json), [all twelve bot measurements](W6.md), [slower warm duel run](evidence/duel-native-performance.json), and [direct-launch control](evidence/duel-cold-control.json). Both final duel runs use the same finished-action guard and complete all 9,600 ms / three rounds. Logs show no concurrent detail-renderer loop; the cause of the run-to-run difference is unresolved. Both results are retained. City-map UI fps was not separately profiled.

FPS counts completed native render batches with backpressure, not queued JavaScript submissions. Earlier apparent 60 fps measurements accompanied blank/overloaded native rendering and were discarded. Load time starts at the GL context callback and includes decode, texture/rig setup and first native draw; it excludes app startup before context creation. Even the direct-launch control retains the filesystem asset cache. Balanced textured lighting and a logical-pixel 3D backing surface are used; the UI and background remain full resolution. These are Debug software-renderer measurements, not physical-device or display-compositor claims. The export size is not an IPA or App Store download size.

## Final validation

- Native iOS Debug build: **succeeded**. [Build record](evidence/native-build.txt).
- TypeScript: **passed**, no diagnostics. [Output](evidence/typecheck-final.txt).
- Mobile suite: **495 passed, 4 skipped** across 57 passing files and one skipped integration file. Three emulator integration cases are opt-in and passed separately; the fourth skip already existed on main. [Final output](evidence/mobile-tests-final.txt). Baseline was 439 passed / one skip.
- Functions CI build/shared parity: **passed**. [Output](evidence/functions-build-final.txt).
- Production Expo iOS export: **succeeded**. [Output](evidence/export-ios-final.txt).
- Items: all 105 filenames, generated entries, hashes and bytes verified. [Output](evidence/holo-ui-final.txt).
- GLBs: twelve bots, all 86 clips, zero Khronos validation errors; 148 compressed buffer views decoded byte-identically by native JS and upstream WASM. [Output](evidence/bot-validation.txt).
- Actual #80 host: **3 mobile integration + 13 host/rules cases passed** against loopback Firestore; disposable data removed. [W7 evidence](../../../mobile/docs/qa/mobile-holocity-lite/w7/README.md).
- Native city interaction: a ring pin opened the correct pilot/ACE challenge; Return reopened the citizen panel. [Smoke record](evidence/navigation-smoke.txt).
- **41 native screenshots** reviewed, including every primary screen, city gate state, all twelve bots and all three recorded rounds. The capture helper now allows native modals to finish dismissing before opening the next route.

Live authenticated purchases, workouts/watch sensors, remote web content and physical-device performance were not exercised under the requested no-account simulator setup. Live gathering remains HELD on separately authorized #80 integration/deployment, and authoritative host-round replay on a host trace contract. No merge or deployment is requested tonight.

## Screenshot gallery

The footer marks offline fixture data. Each thumbnail links to its original native capture. Long screens remain scrollable; a single initial-viewport capture does not show every row. Overworld shows loading chrome and WebSection shows blocked-address chrome.


### W5 — existing screens and roster pattern

| | | |
| --- | --- | --- |
| **Home**<br>![Home](screenshots/Home.png) | **Inventory**<br>![Inventory](screenshots/Inventory.png) | **Roster**<br>![Roster](screenshots/Roster.png) |
| **Detail**<br>![Detail](screenshots/Detail.png) | **Fitness**<br>![Fitness](screenshots/Fitness.png) | **Marketplace**<br>![Marketplace](screenshots/Marketplace.png) |
| **Arena**<br>![Arena](screenshots/Arena.png) | **Gacha**<br>![Gacha](screenshots/Gacha.png) | **Training**<br>![Training](screenshots/Training.png) |
| **Quests**<br>![Quests](screenshots/Quests.png) | **Login**<br>![Login](screenshots/Login.png) | **Leaderboard**<br>![Leaderboard](screenshots/Leaderboard.png) |
| **Settings**<br>![Settings](screenshots/Settings.png) | **Overworld**<br>![Overworld](screenshots/Overworld.png) | **WebSection**<br>![WebSection](screenshots/WebSection.png) |

### W7 — city, gates and rival flow

| | | |
| --- | --- | --- |
| **CityDay**<br>![CityDay](screenshots/CityDay.png) | **CityNight**<br>![CityNight](screenshots/CityNight.png) | **CityLocked**<br>![CityLocked](screenshots/CityLocked.png) |
| **CityZones**<br>![CityZones](screenshots/CityZones.png) | **CityRivals**<br>![CityRivals](screenshots/CityRivals.png) | **CityWorkshop**<br>![CityWorkshop](screenshots/CityWorkshop.png) |
| **RivalEntry**<br>![RivalEntry](screenshots/RivalEntry.png) | **CityBattle**<br>![CityBattle](screenshots/CityBattle.png) | **DuelReceipt**<br>![DuelReceipt](screenshots/DuelReceipt.png) |

### W6 — each recorded round and result

| | | |
| --- | --- | --- |
| **DuelRound1**<br>![DuelRound1](screenshots/DuelRound1.png) | **DuelRound2**<br>![DuelRound2](screenshots/DuelRound2.png) | **DuelRound3**<br>![DuelRound3](screenshots/DuelRound3.png) |
| **Duel**<br>![Duel](screenshots/Duel.png) | **DuelColdControl**<br>![DuelColdControl](screenshots/DuelColdControl.png) |  |

### W6 — all twelve real bots

| | | |
| --- | --- | --- |
| **BotACE**<br>![BotACE](screenshots/BotACE.png) | **BotWOLF**<br>![BotWOLF](screenshots/BotWOLF.png) | **BotKUMA**<br>![BotKUMA](screenshots/BotKUMA.png) |
| **BotKEN**<br>![BotKEN](screenshots/BotKEN.png) | **BotTSUIN**<br>![BotTSUIN](screenshots/BotTSUIN.png) | **BotHARE**<br>![BotHARE](screenshots/BotHARE.png) |
| **BotSHADOW**<br>![BotSHADOW](screenshots/BotSHADOW.png) | **BotWAKE**<br>![BotWAKE](screenshots/BotWAKE.png) | **BotTORA**<br>![BotTORA](screenshots/BotTORA.png) |
| **BotGAMA**<br>![BotGAMA](screenshots/BotGAMA.png) | **BotKURAI**<br>![BotKURAI](screenshots/BotKURAI.png) | **BotERA**<br>![BotERA](screenshots/BotERA.png) |
