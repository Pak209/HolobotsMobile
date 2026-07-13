# Holobots Cloud Functions

## ⚠️ Deploy scope — read before deploying

This Firebase project (`holobots-24046`) hosts functions deployed from **two
repositories**:

- this repo (`syncWatchWorkoutRewards`, `syncFitnessActivity`,
  `clearWorkoutCooldown`, `openGachaPack`, `purchaseMarketplaceItem`,
  `purchaseMarketplaceBooster`, `useEnergyRefill`, `chargeArenaEntry`,
  `settleArenaBattle`, `claimQuestRun`, `claimTrainingSession`,
  `upgradeSyncStat`, `mintHolobot`, `upgradeHolobotRank`,
  `deleteUserAccountV2`)
- the `holobots-fun` web repo (`matchmaker`, `cleanupAbandonedRooms` — web PvP triggers; `createWebviewBridgeToken` moved INTO this repo 2026-07-12 after its source was lost and an old unscoped deploy removed it from prod)

A bare `firebase deploy --only functions` from this repo will offer to
**delete every function not defined here**, including the web app's WebView
auth bridge. Always deploy with an explicit function list:

```bash
firebase deploy --only functions:syncWatchWorkoutRewards,functions:syncFitnessActivity,functions:clearWorkoutCooldown,functions:openGachaPack,functions:purchaseMarketplaceItem,functions:purchaseMarketplaceBooster,functions:purchaseMarketplacePart,functions:useEnergyRefill,functions:chargeArenaEntry,functions:settleArenaBattle,functions:claimQuestRun,functions:claimTrainingSession,functions:upgradeSyncStat,functions:upgradeHolobotMove,functions:saveHolobotCombatKit,functions:mintHolobot,functions:upgradeHolobotRank,functions:deleteUserAccountV2,functions:applyReferralCode,functions:claimGenesisSquad,functions:assignWildcardBlueprints,functions:createWebviewBridgeToken,functions:claimDailyMission,functions:redeemLegendaryBlueprint,functions:useExpBooster,functions:useRankSkip,functions:mirrorLeaderboardEntry
```

Deliberately still client-side (documented, not forgotten): quest/training
STARTS (energy spend, board refresh, session records — the endsAt/startedAt
anchors are client-written, so true timer validation requires migrating the
starts themselves; the claims that pay out are server-side, so forged starts
only skip wait timers). The arena battle simulation also remains client-side
(C4): settlement derives payouts from the tier table with clamped
performance bonuses, so a dishonest client can claim a win but cannot
invent reward amounts.

## Layout

Functions are TypeScript, compiled to `lib/` (`npm run build`, which also
runs the shared-file parity check). `src/index.ts` is re-exports only:

- `src/account/` — auth / account lifecycle (`deleteUserAccountV2`)
- `src/fitness/` — watch workout reward syncing (`syncWatchWorkoutRewards`)
- `src/lib/` — server-side domain logic (progression, scoring)
- `src/shared/` — files kept **byte-identical** with the mobile app,
  enforced by `scripts/check-shared-parity.mjs` on every build

## Shared progression math

`src/lib/progression.ts` is the server mirror of the mobile app's canonical
progression module (`mobile/src/lib/progression.ts` plus the sync-rank
thresholds in `mobile/src/lib/syncProgression.ts`). The two sides must stay
behaviorally identical — `mobile/src/lib/__tests__/progressionParity.test.ts`
imports this file directly and fails CI if they drift. If you change a
formula, change it in both places and run `npm test` in `mobile/`.

## Shared Firestore fields

`users/{uid}` documents are read and written by the mobile app, the watch
sync function, and the `holobots-fun` web app. Treat field shapes as a
cross-repo contract (see `docs/firebase-sync-contract.md`). Notably:

- `lastEnergyRefresh` is a Firestore **Timestamp** (the web app reads it via
  `.toDate()`); never write it as a string.
- `holobots[]` entries carry optional extra keys (`career`, sync stats).
  Any code that rewrites a holobot must spread the existing object rather
  than reconstructing it field-by-field.
