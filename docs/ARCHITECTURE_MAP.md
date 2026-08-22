# HolobotsMobile architecture map

## Overview
- `mobile/` is the Expo SDK 53 / React Native 0.79 / React 19 app; it uses Firebase JS, Zustand, and React Navigation bottom tabs.
- `functions/` is the Firebase Cloud Functions TypeScript backend; `firestore.rules` and `rules-tests/` define and emulator-test data access.
- Root `package.json` + `src/App.tsx` are a sibling Vite/React/Pixi overworld preview, not the mobile app.
- Runtime integrations include RevenueCat, location/motion, local authentication, video, WebView, and an iOS Watch app.

## Entry & navigation
- `mobile/App.tsx` preloads fitness assets, then nests `GestureHandlerRootView` → `SafeAreaProvider` → `AuthProvider` → `AuthedApp`.
- `AuthedApp` shows `AppLoadingScreen` until assets/auth/profile load, `LoginScreen` when signed out or session-locked, otherwise `NavigationContainer` and `WatchRewardsSyncModal`.
- `createBottomTabNavigator<RootTabs>()` builds hidden-tab-bar routes, initially `Home`: Home, Fitness, Marketplace, Inventory, Arena, Gacha, Leaderboard, Training, Quests.
- `LoginScreen` is an auth gate, not a tab; `WebSectionScreen` is a reusable WebView sub-view not registered in `App.tsx`; screen/component modals are local overlays, not navigator routes.

## Screens
- `HomeScreen.tsx` — roster/dashboard and tab launcher; `AuthContext`, `partStats`.
- `ArenaScreen.tsx` — 1v1/3v3 arena UI and PvP modal; both arena Zustand stores, `arenaClient`/`arenaEconomy`.
- `GachaScreen.tsx` — pack selection/opening; `economyClient`, `gacha`, `AuthContext`.
- `InventoryScreen.tsx` — roster, mint/rank/sync upgrades and Move Lab; `progressionClient`, `genesisClient`, `minting`.
- `LeaderboardScreen.tsx` — live ranked list; Firestore `leaderboard` query via `onSnapshot`.
- `QuestsScreen.tsx` — quest runs and energy use; `progressionSystems`, `progressionClient`, `useEnergyRegen`.
- `TrainingScreen.tsx` — training sessions and energy refills; `progressionSystems`, `progressionClient`, `useEnergyRegen`.
- `MarketplaceScreen.tsx` — items/parts/boosters, referrals, Genesis and season IAP; `economyClient`, `genesisClient`, purchases UI.
- `FitnessScreen.tsx` — phone workouts and Watch presence; `useWorkout`, `useWatchWorkoutPresence`, profile/progression logic.
- `LoginScreen.tsx` — sign-in/sign-up and starter selection; `AuthContext`.
- `WebSectionScreen.tsx` — authenticated web content; `webAuthBridge`, `react-native-webview`.

## State
- `arena-battle-store.ts` — current 1v1 battle, fixed move kits, animation/pause/result and game-loop timer; Zustand memory only, no persistence.
- `arena-team-battle-store.ts` — current 3v3 team/duel, switching/send-in, animation/pause/result and timer; Zustand memory only, no persistence.
- No other Zustand `create(...)` store exists under `mobile/src`; auth/profile state lives in `AuthContext`, whose remembered auth/session data uses AsyncStorage.

## Services / clients (`mobile/src/lib`)
- Callable base: `callables.ts` normalizes server errors/fallback decisions; Firebase bindings live in `src/config/firebase.ts`.
- `economyClient.ts` → `openGachaPack`, `purchaseMarketplaceItem`, `purchaseMarketplacePart`, `purchaseMarketplaceBooster`, `claimDailyMission`.
- `arenaClient.ts` → `chargeArenaEntry`, `settleArenaBattle`; `genesisClient.ts` → `applyReferralCode`, `claimGenesisSquad`, `assignWildcardBlueprints`.
- `progressionClient.ts` → quest/training claims, sync/rank/mint upgrades, energy refill/rank skip/EXP booster, legendary redemption; `moveLabClient.ts` → `upgradeHolobotMove`, `saveHolobotCombatKit`.
- `fitnessSyncClient.ts` → `syncFitnessActivity`, `clearWorkoutCooldown`; `webAuthBridge.ts` → `createWebviewBridgeToken` plus origin validation.
- Domain logic: `progression*`, `syncProgression`, `energy`, `gacha`, `marketplace`, `minting`, `pvpMatchmaking`, `dailyMissions`, `partStats`, `arenaEconomy`, `fitnessSync`, `genesis`.
- Monetization: `purchases.ts` lazily wraps RevenueCat; `monetization.ts` declares products/entitlements; `monetizationConfig.ts` reads Firestore config.
- Config: `appConfig.ts` reads public app configuration (including invite URL) from Firestore.

## Hooks
- `useWatchBridge` / `useWatchWorkoutPresence` wrap iOS `WatchBridgeModule` events, pending workout payloads, Firestore workout state, and `syncWatchWorkoutRewards`.
- `useWorkout` wraps `expo-location`, `expo-sensors` Pedometer, iOS native workout/HealthKit methods, Firestore state, and fitness sync callables.
- `useEnergyRegen` periodically derives energy from profile time/steps and persists through `AuthContext.updateProfile`.
- `useRealtimeArena` wraps Firestore pool/room snapshots, transactions, matchmaking, and client battle engines for live PvP.

## Native / platform modules
- `expo-location` + `expo-sensors`: `useWorkout`; `expo-local-authentication` + AsyncStorage: `AuthContext`; AsyncStorage also backs Firebase RN auth persistence.
- `expo-video`: `HolobotAnimatedCharacter`; `react-native-purchases`: `purchases`/`SeasonStoreSection`; `react-native-webview`: `WebSectionScreen`.
- `react-native-svg`: shared frames/art and Inventory/Marketplace; gesture-handler, safe-area-context, Expo Asset/StatusBar are wired in `mobile/App.tsx`.
- `mobile/ios` exists and contains `WatchBridge.swift`/Objective-C module plus a `HolobotsWatch Watch App` target using WatchConnectivity and workout/reward views; `WatchRewardsSyncModal` confirms pending rewards on phone.

## Backend touchpoints
- `functions/src/index.ts` is re-exports only and exposes 28 account, arena, economy, fitness, growth, leaderboard, monetization, and progression functions.
- Mobile clients invoke 25 named callables; other exports include account deletion, leaderboard mirroring, and the RevenueCat webhook.
- Direct Firestore touchpoints include profiles/config, leaderboard snapshots, fitness state, and PvP pool/rooms.
- `firestore.rules` enforces owner-scoped user data, frozen server-awarded economy/referral fields, public leaderboard projections, and participant-scoped PvP access.
- `rules-tests/` runs Vitest against the local Firestore emulator; suites cover auth privilege, battle collections, economy freeze, equips, matchmaking, referrals, and mobile/web writes.

## Known gaps / unverified
- Android fitness behavior beyond the JavaScript location/Pedometer path was not verified in a native Android project.
