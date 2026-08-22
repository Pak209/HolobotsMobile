# UI / Art Notes

Five code-backed proposals. Visual claims marked inferred from code (no screenshots).

## 1. Gold + header chrome
Targets: `mobile/src/components/ui/GameSurfaceFrame.tsx` (default `#f0bf14`), `mobile/src/components/navigation/GameSectionChrome.tsx` (eyebrow `#f5c40d`, `paddingTop: 62`), `mobile/src/components/FigmaCanvas.tsx` (page `#f5c40d`), `mobile/src/components/AppLoadingScreen.tsx` (`#ffc107`), `mobile/src/screens/HomeScreen.tsx` (radar `#fdb813`, EXP `#f4c312`), `mobile/src/screens/GachaScreen.tsx` (hand-rolled header `paddingTop: 94`, page `#2a2a2a`). Marketplace still has unused leftover `styles.header` (`paddingTop: 94`).
Problem: Gold and section headers don't match across Home/Gacha vs Inventory/Marketplace/Leaderboard (inferred from code).
Change: One gold token. Route Gacha through `CompactSectionHeader`. Delete dead Marketplace header styles.
Effort: S. Benefits: Gacha, Home, Loading, Quests/Training.

## 2. Gacha reveal is a pulsing square
Targets: `mobile/src/components/gacha/PackOpeningAnimation.tsx` — 170×170 `packFrame`, `Animated.loop` scale 0.92–1.04, items via `setTimeout` 360ms; no pack PNG. `mobile/src/screens/GachaScreen.tsx` already has `PACK_ICONS` unused in the reveal. Marketplace uses `BoosterPackOutline` in `mobile/src/components/marketplace/BoosterPackFrames.tsx`.
Problem: Pack-open is a bordered box + stacked text, not the pack art already on the picker (inferred from code).
Change: Put `PACK_ICONS[pack.id]` in `GameSurfaceFrame`/`BoosterPackOutline`; stagger scale+opacity per card; legendary `#ff3366` flash; COLLECT uses `ArenaControlFrame`.
Effort: M. Benefits: Gacha (reuse on Marketplace boosters).

## 3. Arena fighters stay idle; ACE-only overlay
Targets: `mobile/src/components/arena/BattleArenaView.tsx` — `HolobotAnimatedCharacter` only if `name === "ACE"`, always `animationState="idle"`; others static `Image`; `lastAction` is a text `actionTicker`. `mobile/src/components/character/holobotAnimationAssets.ts` defines `attackBasic`/`hit`/`victory`/`defeat` but nothing passes them.
Problem: Hits/finishers don't animate; non-ACE duels are two stills plus a ticker (inferred from code).
Change: Drive `animationState` from `lastAction`/`isAnimating`; flash the receiving fighter; keep idle fallback for bots without sheets.
Effort: M. Benefits: Arena 1v1 + 3v3, later `BattleResultsModal`.

## 4. Sync rewards are three different boxes
Targets: `mobile/src/screens/FitnessScreen.tsx` inlines a "SYNC RESULT" `settingsCard`. `mobile/src/components/fitness/SyncRewardsModal.tsx` + `SyncCooldownModal.tsx` exist but have no importers. `mobile/src/components/WatchRewardsSyncModal.tsx` (used in `mobile/App.tsx`) is a raw `#111111` card. `mobile/src/components/arena/BattleResultsModal.tsx` already uses `GameDialogFrame` + `GameSurfaceFrame` reward rows.
Problem: Workout collect, cooldown, and Watch sync don't share Arena's framed reward sheet (inferred from code).
Change: Fitness completion should render `SyncRewardsModal`; wrap all three in `GameDialogFrame` with the Arena reward-row pattern.
Effort: S. Benefits: Fitness, Watch overlay.

## 5. In-app loading is a spinner
Targets: `mobile/src/screens/ArenaScreen.tsx` `isStartingBattle` overlay is a bare `ActivityIndicator`; same on `mobile/src/screens/LeaderboardScreen.tsx`, `mobile/src/screens/WebSectionScreen.tsx` (`#f5c40d`), `mobile/src/screens/LoginScreen.tsx` Face ID. `AppLoadingScreen.tsx` has logo + scan bar but is boot-only. Leaderboard with zero rows has no empty card.
Problem: Battle start / leaderboard / web-bridge wait look like system spinners, not the boot sequence (inferred from code).
Change: Extract AppLoading corner rails + scan bar into a compact overlay; Leaderboard empty uses `GameSurfaceFrame`.
Effort: S. Benefits: Arena, Leaderboard, WebSection, Login.

Do first: #4 — unused Sync modals already exist; Fitness is duplicating them.
