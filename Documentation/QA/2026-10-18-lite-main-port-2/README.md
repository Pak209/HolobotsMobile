# lite-main-port-2: port lite #131, #132, #133, #137, #142 and #144 into main's gated lite tree

Base: `origin/main` `3c35c7e4e2c23e3269a3b87c068b7cf07ad4999d` (#150). The branch was ported on `a90d061` (#138) and rebased onto `3c35c7e` after #147 (`bca7fa8`) and #150 landed, with no conflicts; all proofs below are re-run on `3c35c7e`. Branch `claude/lite-main-port-2`. Lite reference: `origin/mobile-holocity-lite` `0756650` (#148, docs only). Its `mobile/` is identical to `d14e1d37dddc4baf70bc433d664e92502aad4c9b` (#144).

Main's gated copy (`mobile/src/lite/**` + `mobile/LiteApp.tsx`, behind `EXPO_PUBLIC_HOLOCITY_LITE === "1"`) matched lite `e281819` after #138. Since then lite merged #131, #132, #133, #139, #137, #141, #142 and #144. This PR ports six of them, one commit per source PR, in merge order. It skips #139 (except what #144 needs to compile) and #141. The original app is untouched. The only file changed outside `mobile/src/lite/**` is `mobile/LiteApp.tsx` (CityMarket tab, `RootTabs.CityMarket { from? }`, the first-read loading condition, and the HELD-adaptation guard against rendering Home before the profile read starts).

That matters for TestFlight: main's copy now has #144's `too_fast` handling. A CPU settle refused by host #145's 3 s floor is shown as "not yet", not a raw error. The exact report is persisted per account and resent, honouring `retryAfterMs` or falling back to a 1/2/4/8/16 s backoff, then TRY AGAIN.

## How the port was made

The port worked file by file, as a 3-way merge in main's import form:
- `ours` = main's lite file;
- `base` = the lite file at `<merge>^1`;
- `theirs` = the lite file at `<merge>`.

`base` and `theirs` were rendered with main's import mapping:
- `@/X` becomes `@/lite/X` when a lite copy exists;
- relative paths are re-rooted;
- `../../App` becomes `../../../LiteApp`;
- `Enabled*` is used for the five lazy-split modules.

Because the merge applies only each PR's own delta, hunks from #139 and #141 that sit in a PR's base stayed out by construction. There were 14 conflict hunks, all resolved by hand. Twelve in #144 and one in #137 sit next to #139 lines (see Skips). The other, in #142's forked `nativeUnitySession.test.ts`, is one import line that took #142's version.

## Source PR → files

| Source PR (merge) | Lite-branch file (`mobile/src/…` unless noted) | Main file | How |
|---|---|---|---|
| #131 `875935d` Marketplace from vendorCatalogHost | `mobile/App.tsx` | `mobile/LiteApp.tsx` | hunks applied by hand |
|  | `lib/__tests__/cityMarket.test.ts` | `lite/lib/__tests__/cityMarket.test.ts` | new |
|  | `lib/__tests__/cityMarketClient.test.ts` | `lite/lib/__tests__/cityMarketClient.test.ts` | new |
|  | `lib/cityHub.ts` | `lite/lib/cityHub.ts` | fork of shared file |
|  | `lib/cityMarket.ts` | `lite/lib/cityMarket.ts` | new |
|  | `lib/cityMarketClient.ts` | `lite/lib/cityMarketClient.ts` | new |
|  | `qa/CityMarketPreview.tsx` | `lite/qa/CityMarketPreview.tsx` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `qa/__tests__/cityMarketPreviewRoutes.test.ts` | `lite/qa/__tests__/cityMarketPreviewRoutes.test.ts` | new |
|  | `qa/cityMarketFixtures.ts` | `lite/qa/cityMarketFixtures.ts` | new |
|  | `qa/fixtures/city-market-vendor-3.json` | `lite/qa/fixtures/city-market-vendor-3.json` | new |
|  | `screens/CityHubScreen.tsx` | `lite/screens/EnabledCityHubScreen.tsx` | ported |
|  | `screens/CityMarketplaceScreen.tsx` | `lite/screens/CityMarketplaceScreen.tsx` | new |
| #132 `59d30c9` dashboard live | `components/UserStatsModal.tsx` | `lite/components/UserStatsModal.tsx` | ported |
|  | `components/dashboard/DashboardZonesPanel.tsx` | `lite/components/dashboard/DashboardZonesPanel.tsx` | new |
|  | `components/dashboard/TravelSquadPanel.tsx` | `lite/components/dashboard/TravelSquadPanel.tsx` | ported |
|  | `hooks/useHostDashboard.ts` | `lite/hooks/useHostDashboard.ts` | new |
|  | `lib/__tests__/hostDashboard.test.ts` | `lite/lib/__tests__/hostDashboard.test.ts` | new |
|  | `lib/__tests__/hostDashboardFirebase.test.ts` | `lite/lib/__tests__/hostDashboardFirebase.test.ts` | new |
|  | `lib/hostDashboard.ts` | `lite/lib/hostDashboard.ts` | new |
|  | `lib/hostDashboardFirebase.ts` | `lite/lib/hostDashboardFirebase.ts` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `qa/fixtures/desktop-account-3-before-identity.json` | `lite/qa/fixtures/desktop-account-3-before-identity.json` | new |
|  | `qa/fixtures/desktop-account-3-identity.json` | `lite/qa/fixtures/desktop-account-3-identity.json` | new |
|  | `screens/ArenaScreen.tsx` | `lite/screens/ArenaScreen.tsx` | ported |
|  | `screens/HomeScreen.tsx` | `lite/screens/HomeScreen.tsx` | ported |
| #133 `c187921` 3D duel perf knobs (dev-only sweep) | `Documentation/QA/2026-10-17-lite-duel-perf-2/README.md` | not ported | lite-branch evidence |
|  | `components/bots/BotStage.tsx` | `lite/components/bots/BotStage.tsx` | ported |
|  | `lib/__tests__/stagePerf.test.ts` | `lite/lib/__tests__/stagePerf.test.ts` | new |
|  | `lib/bots/stagePerf.ts` | `lite/lib/bots/stagePerf.ts` | new |
|  | `lib/bots/stageProbe.ts` | `lite/lib/bots/stageProbe.ts` | new |
|  | `qa/DuelPerfSweepPreview.tsx` | `lite/qa/DuelPerfSweepPreview.tsx` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `screens/DuelPlaybackScreen.tsx` | `lite/screens/EnabledDuelPlaybackScreen.tsx` | ported |
| #137 `2ead51e` PvP level badges client | `Documentation/QA/2026-10-17-lite-pvp-fighters-1/README.md` | not ported | lite-branch evidence |
|  | `components/arena/PvpArenaModal.tsx` | `lite/components/arena/PvpArenaModal.tsx` | ported |
|  | `components/arena/PvpSeatBadges.tsx` | `lite/components/arena/PvpSeatBadges.tsx` | new |
|  | `hooks/useRealtimeArena.ts` | `lite/hooks/useRealtimeArena.ts` | ported |
|  | `lib/__tests__/pvpFighterLevel.test.ts` | `lite/lib/__tests__/pvpFighterLevel.test.ts` | new |
|  | `lib/__tests__/pvpHostSeatState.test.ts` | `lite/lib/__tests__/pvpHostSeatState.test.ts` | new |
|  | `lib/__tests__/pvpRoomFightersClient.test.ts` | `lite/lib/__tests__/pvpRoomFightersClient.test.ts` | new |
|  | `lib/bots/pvpFighterLevel.ts` | `lite/lib/bots/pvpFighterLevel.ts` | new |
|  | `lib/pvpHostSeatState.ts` | `lite/lib/pvpHostSeatState.ts` | new |
|  | `lib/pvpRoomFightersClient.ts` | `lite/lib/pvpRoomFightersClient.ts` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `qa/PvpFightersPreview.tsx` | `lite/qa/PvpFightersPreview.tsx` | new |
|  | `qa/__tests__/pvpFightersPreviewRoutes.test.ts` | `lite/qa/__tests__/pvpFightersPreviewRoutes.test.ts` | new |
|  | `qa/fixtures/pvp-room-fighters-1.json` | `lite/qa/fixtures/pvp-room-fighters-1.json` | new |
|  | `qa/pvpFightersFixtures.ts` | `lite/qa/pvpFightersFixtures.ts` | new |
| #142 `038038b` home polish | `Documentation/QA/2026-10-17-lite-home-polish-1/README.md` | not ported | lite-branch evidence |
|  | `mobile/App.tsx` | `mobile/LiteApp.tsx` | hunks applied by hand |
|  | `components/FigmaCanvas.tsx` | `lite/components/FigmaCanvas.tsx` | ported |
|  | `components/HomeCogButton.tsx` | `lite/components/HomeCogButton.tsx` | ported |
|  | `components/city/CityRivalBattle.tsx` | `lite/components/city/CityRivalBattle.tsx` | ported |
|  | `components/dashboard/TravelSquadPanel.tsx` | `lite/components/dashboard/TravelSquadPanel.tsx` | ported |
|  | `components/dashboard/UnityLaunchButton.tsx` | `lite/components/dashboard/UnityLaunchButton.tsx` | ported |
|  | `config/__tests__/homeLayout.test.ts` | `lite/config/__tests__/homeLayout.test.ts` | new |
|  | `config/__tests__/storyMode.test.ts` | `lite/config/__tests__/storyMode.test.ts` | new |
|  | `config/figmaAssets.ts` | `lite/config/figmaAssets.ts` | fork of shared file |
|  | `config/homeLayout.ts` | `lite/config/homeLayout.ts` | new |
|  | `config/storyMode.ts` | `lite/config/storyMode.ts` | fork of shared file |
|  | `contexts/AuthContext.tsx` | not ported | **HELD** (shared original-app file) |
|  | `lib/__tests__/cityHubClient.test.ts` | `lite/lib/__tests__/cityHubClient.test.ts` | ported |
|  | `lib/__tests__/cityMarket.test.ts` | `lite/lib/__tests__/cityMarket.test.ts` | ported |
|  | `lib/__tests__/cityMarketClient.test.ts` | `lite/lib/__tests__/cityMarketClient.test.ts` | ported |
|  | `lib/__tests__/homeRoster.test.ts` | `lite/lib/__tests__/homeRoster.test.ts` | new |
|  | `lib/__tests__/hostDashboard.test.ts` | `lite/lib/__tests__/hostDashboard.test.ts` | ported |
|  | `lib/__tests__/liteCopy.test.ts` | `lite/lib/__tests__/liteCopy.test.ts` | new |
|  | `lib/cityHub.ts` | `lite/lib/cityHub.ts` | fork of shared file |
|  | `lib/cityHubClient.ts` | `lite/lib/cityHubClient.ts` | ported |
|  | `lib/cityMarket.ts` | `lite/lib/cityMarket.ts` | ported |
|  | `lib/cityMarketClient.ts` | `lite/lib/cityMarketClient.ts` | ported |
|  | `lib/cityRivalBattle.ts` | `lite/lib/cityRivalBattle.ts` | ported |
|  | `lib/homeRoster.ts` | `lite/lib/homeRoster.ts` | new |
|  | `lib/hostDashboard.ts` | `lite/lib/hostDashboard.ts` | ported |
|  | `lib/unity/__tests__/nativeUnitySession.test.ts` | `lite/lib/unity/__tests__/nativeUnitySession.test.ts` | fork of shared file |
|  | `lib/unity/nativeUnitySession.ts` | `lite/lib/unity/nativeUnitySession.ts` | fork of shared file |
|  | `qa/CityRivalPreview.tsx` | `lite/qa/CityRivalPreview.tsx` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `screens/CityHubScreen.tsx` | `lite/screens/EnabledCityHubScreen.tsx` | ported |
|  | `screens/CityMarketplaceScreen.tsx` | `lite/screens/CityMarketplaceScreen.tsx` | ported |
|  | `screens/HomeScreen.tsx` | `lite/screens/HomeScreen.tsx` | ported |
|  | `screens/OverworldScreen.tsx` | `lite/screens/OverworldScreen.tsx` | ported |
| #144 `d14e1d3` arena polish | `Documentation/QA/2026-10-18-lite-arena-polish-1/README.md` | not ported | lite-branch evidence |
|  | `components/arena/ArenaInterstitial.tsx` | `lite/components/arena/ArenaInterstitial.tsx` | new |
|  | `components/arena/ArenaPrebattleMenu.tsx` | `lite/components/arena/ArenaPrebattleMenu.tsx` | ported |
|  | `components/arena/BattleArenaView.tsx` | `lite/components/arena/BattleArenaView.tsx` | ported |
|  | `components/arena/BattleResultsModal.tsx` | `lite/components/arena/BattleResultsModal.tsx` | ported |
|  | `components/arena/__tests__/arenaResultPresenter.test.ts` | `lite/components/arena/__tests__/arenaResultPresenter.test.ts` | ported |
|  | `components/arena/__tests__/arenaUxGuards.test.ts` | `lite/components/arena/__tests__/arenaUxGuards.test.ts` | new |
|  | `components/arena/arenaResultPresenter.ts` | `lite/components/arena/arenaResultPresenter.ts` | ported |
|  | `lib/__tests__/arenaPolish.test.ts` | `lite/lib/__tests__/arenaPolish.test.ts` | new |
|  | `lib/__tests__/arenaSettleConfirm.test.ts` | `lite/lib/__tests__/arenaSettleConfirm.test.ts` | new |
|  | `lib/__tests__/liteCopy.test.ts` | `lite/lib/__tests__/liteCopy.test.ts` | ported |
|  | `lib/arenaCopy.ts` | `lite/lib/arenaCopy.ts` | new |
|  | `lib/arenaHostBattle.ts` | `lite/lib/arenaHostBattle.ts` | ported |
|  | `lib/arenaMatchClient.ts` | `lite/lib/arenaMatchClient.ts` | ported |
|  | `lib/arenaMatchFlow.ts` | `lite/lib/arenaMatchFlow.ts` | ported |
|  | `lib/arenaSettleConfirm.ts` | `lite/lib/arenaSettleConfirm.ts` | new |
|  | `lib/arenaVitals.ts` | `lite/lib/arenaVitals.ts` | new |
|  | `lib/bots/hostDuelReceipt.ts` | `lite/lib/bots/hostDuelReceipt.ts` | ported |
|  | `lib/bots/liveRivalPlayback.ts` | `lite/lib/bots/liveRivalPlayback.ts` | ported |
|  | `lib/profile.ts` | not ported | **HELD** (shared original-app file) |
|  | `qa/ArenaAdmittedPreview.tsx` | `lite/qa/EnabledArenaAdmittedPreview.tsx` | ported |
|  | `qa/ArenaPolishPreview.tsx` | `lite/qa/ArenaPolishPreview.tsx` | new |
|  | `qa/HoloCityPreview.tsx` | `lite/qa/EnabledHoloCityPreview.tsx` | ported |
|  | `qa/__tests__/arenaPolishPreviewRoutes.test.ts` | `lite/qa/__tests__/arenaPolishPreviewRoutes.test.ts` | new |
|  | `qa/arenaPolishFixtures.ts` | `lite/qa/arenaPolishFixtures.ts` | new |
|  | `screens/ArenaScreen.tsx` | `lite/screens/ArenaScreen.tsx` | ported |
|  | `screens/DuelPlaybackScreen.tsx` | `lite/screens/EnabledDuelPlaybackScreen.tsx` | ported |
|  | `types/profile.ts` | not ported | **HELD** (shared original-app file) |

None of the six PRs touches a quest, training or daily-mission file. #132's `UserStatsModal.tsx` hunk is pilot, SYNC and HOLOS only, so no hunk was skipped for #147. #147's files are untouched: `screens/QuestsScreen.tsx`, `screens/TrainingScreen.tsx`, `lib/progressionHost*`, `hooks/useCityProgression.ts` and `qa/fixtures/progression-timers-1.json`.

## Shared original-app files

The source PRs edit 7 files that main's original app also uses. The rule for this lane is that no original-app file outside `mobile/src/lite` and `LiteApp` may change, so each of them went one of two ways.

**Forked into the lite tree.** The shared file is untouched. The fork is main's shared file (byte-equal to lite's pre-PR version) plus the PR's hunks, with imports re-rooted, and every lite import was re-pointed to it.
- `lib/cityHub.ts` → `src/lite/lib/cityHub.ts`. Forked in the #131 commit (`CityDestination` `"CityMarket"`); #142's City copy was added there. Nine lite files were re-pointed, including the existing `cityHub.test.ts`, `cityHost.integration.test.ts` and `cityRivalCooldowns.test.ts`.
- `config/storyMode.ts` → `src/lite/config/storyMode.ts` (#142, `isStoryOverworldAvailable`). The shared `lib/story/storyBridge.ts` keeps the shared copy. Both are constants and pure functions.
- `config/figmaAssets.ts` → `src/lite/config/figmaAssets.ts` (#142, `ARTBOARD_*` re-exported from `homeLayout.ts`, same 1800 × 3200). Asset `require`s are re-rooted, and all 55 relative `require`s in the lite tree resolve.
- `lib/unity/nativeUnitySession.ts` (+ its test) → `src/lite/lib/unity/…` (#142, `hasNativeUnity`, `NATIVE_CITY_COPY`, `nativeCityErrorText`). Its module state (`activeClose`) is used only by the lite fork in a lite build: the shared copy is reachable only from `MainApp`.

**HELD.** These files are not ported. They need a change to a shared original-app file, which is the producer's call.
- `contexts/AuthContext.tsx` (#142): `retryProfile`, the same-batch `setProfileLoading(true)`, and keeping the error during a retry. It cannot be forked, because `QuestsScreen`/`TrainingScreen` (owned by #147) and the shared `hooks/useEnergyRegen.ts` read the shared context. A second provider would break them.
  - Adaptation in `src/lite/screens/HomeScreen.tsx`: `retryProfile` is `undefined`, and a failed read is passed as `profileError: null`. Home therefore shows homeRoster `"missing"` (CAN'T LOAD YOUR ROSTER with no RETRY), never a RETRY that cannot re-subscribe.
  - Adaptation in `mobile/LiteApp.tsx` (critic F1). The shared AuthContext sets the user one render before it starts the profile read; lite #142 closes that gap inside AuthContext. On main, `AuthedApp` tracks which account's read has started (`profileReadFor`) and shows the loading screen while it has not. So no render shows Home, or its CAN'T LOAD roster, for a signed-in account whose read has not begun.
  - `homeRoster.test.ts` replaces lite's 4 AuthContext assertions with a tripwire. It goes red when the shared AuthContext gains `retryProfile`; at that point, restore lite's assertions and drop the adaptation.
  - #142's `LiteApp` loading condition (`&& !profileError`) is ported. With main's AuthContext it changes nothing, because loading and error never co-occur there.
- `lib/profile.ts` + `types/profile.ts` (#144): the `holobotVitals` mapping and type.
  - Adaptation in `src/lite/screens/ArenaScreen.tsx`: `readHostVitals(hostVitalsField(profile))`, a typed read. Main's shared mapping drops the field, so the F2 KO guard shows "unknown" (never KO, never healthy). The City still refuses `holobot_ko`. The guard lights up unchanged once the mapping lands.

## Skips

**#139 (3v3 client prep)** is not ported, except the parts #144 needs to compile:
- `src/lite/lib/arenaMatch3v3.ts`, **trimmed** to lite tip's header, `ARENA_3V3_SCHEMA`, `ARENA_3V3_COPY`, `ARENA_3V3_UNAVAILABLE_COPY` and the `Arena3v3Swap` type (critic F5). `ArenaScreen` needs the copy, and the flow's constructor slot type needs the swap type. The reader, bench presenters and buddy slot stay on lite with their test, so no caller-less, untested 3v3 code lands on main.
- The honest 3v3 entry in `ArenaPrebattleMenu.tsx`: `unavailable3v3Copy`, optional `onStart3v3`, the disabled state and the hint. That file now equals lite tip. Without it, main's lite 3v3 Alert reads "The host currently admits one fighter". That breaks DECISIONS #71, and #144's widened `liteCopy` guard, which scans `ArenaScreen.tsx`, fails.
- In `arenaMatchFlow.ts`: `arenaHostRejection`, the `intents?: Arena3v3IntentStorage` constructor slot (#144's tests pass `undefined` there), and the generic `run<T>` / `flight: Promise<unknown>` (#144's `discardPendingIssue` runs a void command).
- In `arenaMatchClient.ts`: #139's `accountStorage<T>` helper, which #144 uses for its settle, ack and checkpoint stores.
- In `ArenaScreen.tsx`: the `Alert` import is gone, as on lite. #139 removed the 3v3 Alert, and #144's rewrite has none.

Skipped from #139:
- the flow's 3v3 transport: `team`, `teamReply`, `teamRequest`, `resumeTeam`, `swap`/`swapIn`, `retrySwap`, `discardPendingSwap`, and the value imports `ARENA_3V3_SCHEMA`/`readArena3v3Reply`;
- the client's swap-intent store (`arenaMatchClient.ts` passes `undefined` in that slot, with a comment);
- `ArenaBenchCards.tsx` and its render test, `qa/ArenaBenchPreview.tsx`, `qa/arenaBenchFixtures.ts`, `qa/fixtures/arena-match-3v3-lifecycle.json` and `lib/__tests__/arenaMatch3v3.test.ts`;
- the bench preview registration and #139's README.

**#141 (lite test host-pin)** is not ported, and no ported test needs it. `cityMarket.test.ts`, `hostDashboard.test.ts` and `hostDashboardFirebase.test.ts` import `functions/src/...` as they did before #141, which on main is main's own host (it includes #145). `mobile/test-fixtures/host-pin/`, `scripts/pin-host.mjs`, `hostPin.test.ts` and the `vitest.config.ts` load guard stay lite-only. The existing `arenaServerParity.test.ts` and `cityHost.integration.test.ts` keep main's pre-#141 form.

**Lite-branch evidence:** the QA READMEs of #133, #137, #142 and #144 are not copied.

**Test path reads** are not imports, so they were mapped by hand to main's layout:
- `"../../screens/CityHubScreen.tsx"` → `EnabledCityHubScreen.tsx` in `cityHubClient.test.ts`, `storyMode.test.ts` and `liteCopy.test.ts` (×2);
- `"../../screens/DuelPlaybackScreen.tsx"` → `EnabledDuelPlaybackScreen.tsx` in `liteCopy.test.ts`. Without this, the guard reads the string-free lazy wrapper and passes vacuously;
- `"../HoloCityPreview.tsx"` → `EnabledHoloCityPreview.tsx` in `pvpFightersPreviewRoutes.test.ts` and `arenaPolishPreviewRoutes.test.ts`;
- `App.tsx` → `../../../../LiteApp.tsx` in `homeRoster.test.ts`;
- `assets/figma/home` one level up in `homeLayout.test.ts`.

## Fidelity check

Every file in main's lite tree was compared with its lite-tip counterpart after import canonicalisation: 191 files (the five lazy wrappers are main-only). **162 are equal**, 24 differ, and 5 exist only on main. Those 5 are #147's new files; their lite twin #146 is unmerged. Each difference is listed above or is not this PR's:
- path reads: `homeLayout.test.ts`, `storyMode.test.ts`, `cityHubClient.test.ts`, `liteCopy.test.ts`, `pvpFightersPreviewRoutes.test.ts`, `arenaPolishPreviewRoutes.test.ts`;
- #141 host-pin: `cityMarket.test.ts`, `hostDashboard.test.ts`, `hostDashboardFirebase.test.ts`, `arenaServerParity.test.ts`*, `cityHost.integration.test.ts`*;
- #139: `arenaMatchFlow.ts`, `arenaMatchClient.ts`, `arenaMatch3v3.ts` (trimmed), `EnabledHoloCityPreview.tsx` (bench import and spread only);
- #147 (merged on main, untouched here): `QuestsScreen.tsx`, `TrainingScreen.tsx`;
- HELD adaptations: `HomeScreen.tsx`, `ArenaScreen.tsx`, `homeRoster.test.ts`;
- main-only and untouched here*: `offlineFirebase.test.ts` (main's env stub), `pvpBattle.test.ts` (an `importActual` spec style the tool does not canonicalise), `repairHareLocomotion.test.ts` (asset URL depth), and `qa/fixtures/arena-admitted-lifecycle.json` (#145's newer host fixture on main).

Every other ported file equals lite tip, including the four forks. `LiteApp.tsx` carries exactly lite `App.tsx`'s #131 and #142 hunks, plus the critic-F1 guard. That was checked as a diff of the lite→main deltas before and after. The #141 skips were also cross-checked by reverse-applying #141's own diff to the lite-tip file: `cityMarket.test.ts`, `hostDashboard.test.ts` and `hostDashboardFirebase.test.ts` then equal main's port exactly.

## Flag-off proof (`EXPO_PUBLIC_HOLOCITY_LITE` unset)

"Before" is `origin/main` `3c35c7e`; "after" is this branch rebased on it. Both trees were exported with `git archive`. No install and no network were used.

1. **Diff scope.** `git diff --name-only 3c35c7e..HEAD` lists 91 files: 56 added, including this README, and 35 modified. All are under `mobile/src/lite/**`, plus `mobile/LiteApp.tsx` and this README. No edits to `App.tsx`, `MainApp.tsx`, `package.json`, `src/config/liteFeature.ts`, any shared original-app file, `functions/`, `firestore.rules` or `Schemas/`. No shared assets were added. Every asset the lite tree `require`s already exists on main.
2. **Import graph.** A walk of runtime imports (static, `import()`, `require`; type-only skipped) from `MainApp.tsx` + `src/config/liteFeature.ts` reaches **229 modules before and 229 after, the identical set, with 0** under `src/lite/**` or `LiteApp.tsx`. Across the 537 files outside `src/lite` and `LiteApp`, nothing imports a module this PR adds or changes, except `App.tsx -[import()]-> LiteApp.tsx`, the existing gated lazy edge. `LiteApp` reaches 401 → 434 modules. It no longer reaches the shared `figmaAssets.ts` or `nativeUnitySession.ts` (forked), and reaches no new shared module.
3. **Offline `expo export --platform ios`, env unset.** Run with `CI=1 EXPO_OFFLINE=1 … --no-bytecode --no-minify --source-maps --clear`, with an APFS clone of the same local `node_modules` and `EXPO_PUBLIC_HOLOCITY_LITE` / `_PREVIEW` / `_PREVIEW_SCREEN` unset. **Both exit 0** (13.7 s / 13.6 s).
   - Bundle `AppEntry-61b5b72c….js` 11,974,448 B → `AppEntry-55dba04d….js` 12,267,075 B. The entry is `node_modules/expo/AppEntry.js` in both, and `index.js` is in neither. Metro does not split `lazy(import())` on native, so the flag-off bundle carries the gated lite modules (+292 KB), as it already did. They are evaluated only through `LiteApp`.
   - Source-map modules go from 1,583 to 1,618. All 35 added modules are under `src/lite/**`, and none were removed. Changed `sourcesContent` is limited to 29 `src/lite/**` files and `LiteApp.tsx`. **The 357 non-lite project modules and all 1,122 `node_modules` modules are byte-identical.**
   - In both bundles `isLiteEnabled` compiles to `function isLiteEnabled() { return false; }`, with 0 raw `EXPO_PUBLIC_HOLOCITY_LITE` references left.
4. **Boundary behaviour.** `src/config/__tests__/liteBoundary.test.ts` cannot load here (see HELD), so a scratch stand-in ran its assertions with React 19 `react-dom/static` `prerenderToNodeStream` in both trees. It was not committed. For `EXPO_PUBLIC_HOLOCITY_LITE` unset / `"0"` / `"true"` / `"01"`, `App` renders the main flow and the `LiteApp` module is never evaluated. Only `"1"` renders lite. A disabled direct CityHub mount evaluates nothing. Preview needs dev, the preview flag and the lite flag. **7/7 pass before and 7/7 pass after.**
5. **Per-file test results.** Each of the 87 pre-existing test files has the same result before and after, except two lite files that gained #142/#144 tests: `src/lite/lib/__tests__/cityHubClient.test.ts` and `src/lite/components/arena/__tests__/arenaResultPresenter.test.ts`.

## Offline QA-route check (bounded, no simulator)

Evidence is in `~/HolobotsVault/QA/2026-10-18-lite-main-port-2/`.
- `npx vitest run src/lite/qa`: 5 files and 62 tests pass, including the ported `cityMarketPreviewRoutes`, `pvpFightersPreviewRoutes` and `arenaPolishPreviewRoutes`.
- Main's preview registry (`EnabledHoloCityPreview.tsx` `screens`) has the same 28 direct routes as lite tip. Its spread groups match too, except #139's `arenaBenchPreviewScreens`, which is not ported.

## Test counts (full mobile suite, same worktree, same shared `node_modules`)

| Run | Before (`origin/main` 3c35c7e) | After (this branch) |
|---|---|---|
| `npx vitest run` test files | 84 passed, 2 failed, 1 skipped (87) | 103 passed, 2 failed, 1 skipped (106) |
| `npx vitest run` tests | 942 passed, 4 skipped (946) | 1,344 passed, 4 skipped (1,348) |
| of which `src/lite/**` tests passed | 307 | 709 |
| `npx tsc --noEmit` | 2 errors | 2 errors (identical) |

The 2 failing files and both tsc errors are the same before and after. All of them are `Cannot find module 'react-test-renderer'` in `src/config/__tests__/liteBoundary.test.ts` and `src/lib/hostState/__tests__/hooks.test.ts`, the known local gap. The +402 tests are 396 from the 19 new test files and 6 more in the two grown lite files, all passing. The worktree's sparse set adds `functions/` and `docs/` read-only, because main's parity tests import them. Neither is edited.

## HELD

- **`contexts/AuthContext.tsx` `retryProfile` (#142)** and **`lib/profile.ts` / `types/profile.ts` `holobotVitals` (#144).** Both need an original-app file change. The producer decides whether a gated shared edit (the pattern #125 used) is acceptable. Until then, main's lite Home offers no roster RETRY and the Arena KO guard reads "unknown". Both adaptations are marked `HELD on main (lite-main-port-2)` in code.
- **`react-test-renderer` local gap.** Main declares it, but the shared local `node_modules` lacks it. This PR's CI (`npm ci`, then `tsc` + `vitest`) is the run of record for `liteBoundary.test.ts` and `hostState/__tests__/hooks.test.ts`.
- **#139's 3v3 transport and bench UI** stay off main (see Skips) until the 3v3 host runtime is un-HELD.
- **#147 (merged as `bca7fa8`)** owns main's gated quests and training. This PR does not touch its files; its tests pass on this branch.
- **No simulator witness, native build, deploy or account.** None was required, and none was taken.

## Adversarial self-review

A read-only critic subagent ran refute-first on flag-off safety, port fidelity and #71 copy. It had no ref writes and made no edits. It could not refute any of these: the diff scope, MainApp's zero-lite reach, fidelity of all 86 source-PR files (every DIFF matches this list), the soundness of the partial #139 revert in `arenaMatchFlow`, the honesty of the HELD adaptations, the tripwire, #71 copy, test path reads, or AsyncStorage key isolation.

Findings and what was done:
- **F1 (MAJOR), fixed.** The sign-in render could flash CAN'T LOAD YOUR ROSTER before the read started; it now gets the loading screen (the `LiteApp` guard above, asserted in `homeRoster.test.ts`).
- **F2, fixed.** `homeRoster.test.ts` now asserts the guard. A comment marks the unreachable unavailable state while it is HELD.
- **F3, covered.** The boundary test cannot load locally; it was covered by the 7/7 stand-in, and CI is the run of record.
- **F4, fixed.** The branch was rebased onto `3c35c7e` (with #147), and everything was re-run.
- **F5, fixed.** `arenaMatch3v3.ts` was trimmed.
- **F6, listed.** The remaining #139 hunks are now listed in Skips.
- **F7, already listed.** The lite QA READMEs are not copied, and that was already stated.
- **F8, F9: noted.** See the bundle note above and the follow-ups below.

## Known LOW follow-ups

- The shared `src/lib/cityHub.ts` has no direct test on main any more, because the lite tests now exercise the lite fork. Flag-off never calls it. The original app only imports its `CityStoryFlags` type and calls `readCityStoryFlags` behind `isLiteEnabled()` in `lib/profile.ts`.
- The fork split means a later lite change to `cityHub.ts`, `storyMode.ts`, `figmaAssets.ts` or `nativeUnitySession.ts` must be ported to `src/lite/…`, not to the shared file.
  - In a lite build the shared `cityHub.ts` (via the shared `profile.ts`) and the shared `storyMode.ts` (via `storyBridge`) also load. Both copies are stateless today. A future stateful edit to either fork would split state (critic F9).
- `arenaMatch3v3.ts` holds player copy but is not in the `liteCopy` FILES list on either branch (critic F5). Its strings say "the City".
