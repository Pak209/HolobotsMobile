# Client write census: `users/{uid}.holobots` and `.inventory` (critic review S4)

Lane `host-economy-hardening-1`, 2026-10-17. Census only: no code or rules change.

**Refs read.**
- Main: `origin/main` 3b1e790. Paths are relative to `mobile/` unless noted.
- Main's gated lite copy: `src/lite/*` and `LiteApp.tsx`.
- Lite branch: `origin/mobile-holocity-lite`. The lines cited for it were re-checked at c187921; the full sweep ran at 59d30c9. Its screens live at `src/screens/*`, not `src/lite/screens/*`.
- Root `src/`, `overworld/` and `ui-experiments/` have no Firebase dependency and write nothing.
- **Not covered:** the separate holobots-fun web app (`../holobots-fun`). Its Firestore patterns are replayed in `rules-tests/tests/web-writes.test.ts`, so the Phase 2 rules flip must account for that app too.

**The finding (S4).**
- `holobots` and `inventory` are owner-writable. They are outside `protectedFieldsUntouched` (`firestore.rules`), and the comment above it calls them "client-writable on purpose".
- The host still builds trusted state from them:
  - rival and zone combatants: `playerCombatant`, `lib/rivalLadder.ts:291-305`;
  - Arena admission and settle: `uniqueEntrant`, `arena/arenaMatchStore.ts`;
  - the desktop snapshot levels and stats: `desktop/desktopAccountReply.ts`;
  - the #117/#119 level badges.
- A modified client can therefore mint bots or set LV 99.

## How the client writes

- **The funnel.** Every profile write goes `AuthContext.updateProfile` (`src/contexts/AuthContext.tsx:546-551`) → `updateUserProfile` → `updateDoc(userRef, …)` (`src/lib/profile.ts:346`).
- **Key mapping.** `inventory` is mapped at `profile.ts:308`, `holobots` at `:317`.
- **Leaderboard side effect.** Any write that carries `holobots` also re-reads the doc and recomputes `leaderboardScore` (`profile.ts:324-340`). That is S6: the score is client-authored.
- **Other writes.** The only other direct `users/*` writes in the app are the signup `setDoc` calls.
- **Native code.** iOS and Android native code has no Firestore writes.

## `holobots`: live write paths

| # | Call site (main) | What changes | When | Lite copy / lite branch | Callable today? |
|---|---|---|---|---|---|
| H1 | `src/contexts/AuthContext.tsx:426` (`setDoc` merge; payload `holobots: [starterHolobotProfile]` at `:337`) | Starter bot: level 1, exp 0, `attributePoints` 1, `boostedAttributes` {} | Signup, after `createUserWithEmailAndPassword` | Shared by the lite copy; lite branch `:425` / `:336` | `createGenesisProfile` exists (HoloCity desktop signup) but mobile does not call it |
| H2 | `src/contexts/AuthContext.tsx:450` (`setDoc` merge, same payload) | Same starter payload | Signup when the email exists but the profile doc is missing ("restore") | Shared; lite branch `:449` | Same as H1 |
| H3 | `src/contexts/AuthContext.tsx:253` (`updateUserProfile`) | Rewrites the whole array from the client snapshot, plus `syncPoints` / `lifetimeSyncPoints` / `seasonSyncPoints` / `syncRank` | Effect on `[profile, user]` when any of `leaderboardScore`, `lifetimeSyncPoints`, `seasonSyncPoints`, `syncRank` is undefined | Shared; lite branch `:252` | None. In practice it only fires on the optimistic signup profile (`setProfile(localProfile)`, `:418`). That is a code-reading inference, not a runtime check. The sync fields are protected, so a changed value is denied and the error is swallowed. |
| H4 | `src/screens/InventoryScreen.tsx:171` (`handleEquipSyncAbility`, `:163`) | Whole-array rewrite setting `equippedSyncAbilityId` on one bot | Inventory → Holobot stats → equip a Sync Ability | Lite copy `src/lite/screens/InventoryScreen.tsx:155`; lite branch `src/screens/InventoryScreen.tsx:155` | None |
| H5 | `src/lib/moveLabClient.ts:62` (kit-save fallback) | `holobots[i].combatKit {slots, revision}` + `moveSystemVersion` (`buildKitSaveUpdates`, `src/features/arena/moveProgression.ts:160-199`) | Move Lab equip, only when the `saveHolobotCombatKit` callable fails (`shouldFallBackToLocal`, `src/lib/callables.ts:15-27`: no code / not-found / unavailable / deadline-exceeded / internal) | Called from `src/components/MoveLabPanel.tsx:204`; lite copy `src/lite/components/MoveLabPanel.tsx:205`; lite branch `src/components/MoveLabPanel.tsx:205` | `saveHolobotCombatKit` exists. The fallback is the leak. The rules allow it today. |
| H6 | `src/lib/moveLabClient.ts:42` (move-upgrade fallback) | `holobots[i].moveProgress[move]` + `syncPoints - cost` (`buildMoveUpgradeUpdates`, `moveProgression.ts:88-147`) | Move Lab upgrade, only when `upgradeHolobotMove` fails | `MoveLabPanel.tsx:225`; lite copy `:226`; lite branch `:226` | `upgradeHolobotMove` exists. `syncPoints` is protected, so the rules should deny this whole write (reading, not tested). |

Attribute-point spends are no longer client writes.
- `handleUpgradeStat` (`InventoryScreen.tsx` ~124-144) calls the `boostHolobotAttribute` callable.
- The rules comment "holobots (attribute-point spends)" is stale.

Workout EXP, levels and career come only from the `syncFitnessActivity` / `syncWatchWorkoutRewards` callables (`src/hooks/useWorkout.ts:318`, `src/hooks/useWatchBridge.ts:182`).

**Dead client builders.** These are never passed to a write; parity tests import them.
- `src/lib/fitnessSync.ts:338` (`syncFitnessActivity`, never imported; `fitness_daily` is server-only anyway)
- `src/lib/progressionClaims.ts:39`, `:62`
- `src/lib/arenaEconomy.ts:262`
- `src/lib/minting.ts:80`, `:150`
- `src/lib/syncProgression.ts:241`

## `inventory`: live write paths

| # | Call site | What changes | When | Lite | Callable today? |
|---|---|---|---|---|---|
| I1 | `src/contexts/AuthContext.tsx:339` (`inventory: {}` inside the H1/H2 `setDoc` at `:426` / `:450`) | Initial empty map | Signup / restore | Shared; lite branch `:338` | Same as H1 |

- That is the only live client write of `inventory`.
- `src/lib/progressionClaims.ts:40` (quest reward items) is dead and test-only; the `claimQuestRun` callable pays quest items.
- The generic mapping at `profile.ts:308` has no live caller.
- The marketplace and gacha builders do not touch `inventory`.

## Phased plan (one callable per write, then the rules flip)

Phase 0 is in place: host readers already validate before trusting. Arena `uniqueEntrant` checks level, exp, threshold and `boostedAttributes` shape. The gap is plausibility: a self-consistent LV 99 record passes.

| Phase | Write | Change | Repo | Gate |
|---|---|---|---|---|
| 1a | H5, H6 | Delete the Move Lab local fallbacks (`moveLabClient.ts:35-43`, `:55-63`); surface the callable error instead | mobile main + lite copy + lite branch | None (the callables already exist and are deployed) |
| 1b | H4 | New `equipSyncAbility` callable: server reads the bot, checks `syncAbilityUnlocks` from host-computed sync stats, writes only `holobots[i].equippedSyncAbilityId`; the client calls it | host + mobile + lite | Host deploy before the client ships |
| 1c | H1, H2, I1 | Route signup / restore through `createGenesisProfile` (already the desktop path), or pin the create shape in rules: `holobots` = exactly one starter record (level 1, exp 0, `attributePoints` 1, empty boosts) and `inventory` = {} | mobile + (rules) | Decide callable vs pinned create shape (producer pick: callable; one starter source) |
| 1d | H3 | Delete the client backfill; the host lazily backfills `lifetimeSyncPoints` / `seasonSyncPoints` / `syncRank` / `leaderboardScore` on its next read (desktopAccountSnapshot already lazily backfills story flags and pilot rank) | mobile + host | None |
| 2 | all | `firestore.rules`: add `holobots` and `inventory` to `protectedFieldsUntouched` and frozen-on-create; flip `rules-tests/tests/economy-freeze.test.ts:55-58` (asserts a client holobots write succeeds) and the holobots writes in `equip-repro.test.ts` / `web-writes.test.ts` / `FITNESS_USER_UPDATES` (`rules-tests/src/fixtures.ts`); keep the 1000-evaluation budget (one MapDiff) | host rules | Only after 1a–1d ship in main **and** lite and a minimum app version is enforced: older installed builds still use H4 and the H5 fallback and would start failing |
| 3 | dead | Keep the dead builders only as parity-test subjects or delete them with their parity tests; correct the stale rules comment | mobile | None |

**Related, not in this census.**
- `leaderboardScore` is recomputed client-side on every `holobots` write (S6). It needs a host-computed score in the same Phase 2.
- `rewardSystem` quest and training starts are owner-writable (S3). They live in `QuestsScreen.tsx:76`/`:105` and `TrainingScreen.tsx:76`/`:104`, plus the lite copies. They block protecting `rewardSystem` itself; this lane moved only the daily-mission authority to the server-only `dailyMissionLedger`.
