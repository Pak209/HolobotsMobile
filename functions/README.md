# Holobots Cloud Functions

## ⚠️ Deploy scope — read before deploying

This Firebase project (`holobots-24046`) hosts functions deployed from **two
repositories**:

- this repo (`syncWatchWorkoutRewards`, `syncFitnessActivity`,
  `clearWorkoutCooldown`, `openGachaPack`, `purchaseMarketplaceItem`,
  `purchaseMarketplaceBooster`, `useEnergyRefill`, `chargeArenaEntry`,
  `settleArenaBattle`, `claimQuestRun`, `claimTrainingSession`,
  `upgradeSyncStat`, `mintHolobot`, `upgradeHolobotRank`,
  `deleteUserAccountV2`, `revenuecatWebhook`)
- the `holobots-fun` web repo (`matchmaker`, `cleanupAbandonedRooms` — web PvP triggers; `createWebviewBridgeToken` moved INTO this repo 2026-07-12 after its source was lost and an old unscoped deploy removed it from prod)

A bare `firebase deploy --only functions` from this repo will offer to
**delete every function not defined here**, including the web app's WebView
auth bridge. Always deploy with an explicit function list:

```bash
firebase deploy --project holobots-24046 --only functions:applyReferralCode,functions:assignWildcardBlueprints,functions:chargeArenaEntry,functions:createGenesisProfile,functions:createWebviewBridgeToken,functions:claimDailyMission,functions:claimGenesisSquad,functions:claimQuestRun,functions:claimTrainingSession,functions:clearWorkoutCooldown,functions:deleteUserAccountV2,functions:mintHolobot,functions:mirrorLeaderboardEntry,functions:openGachaPack,functions:purchaseMarketplaceBooster,functions:purchaseMarketplaceItem,functions:redeemLegendaryBlueprint,functions:revenuecatWebhook,functions:purchaseMarketplacePart,functions:saveHolobotCombatKit,functions:settleArenaBattle,functions:syncFitnessActivity,functions:syncWatchWorkoutRewards,functions:upgradeHolobotRank,functions:upgradeHolobotMove,functions:upgradeSyncStat,functions:useEnergyRefill,functions:useExpBooster,functions:useRankSkip,functions:wildEncounterHost,functions:travelSquadHost,functions:desktopAccountSnapshot,functions:rivalBattleHost
```

That is all 33 functions exported from `src/index.ts` (2026-09-30: `rivalBattleHost`
added for DECISIONS #43; see `Documentation/QA/2026-09-30-buddy-units/CONTRACT.md`).

`revenuecatWebhook` requires the `REVENUECAT_WEBHOOK_AUTH` secret to exist
before its first deploy (`firebase functions:secrets:set
REVENUECAT_WEBHOOK_AUTH` — the same value goes into the RevenueCat webhook's
Authorization header field; see `mobile/docs/revenuecat-setup.md`).

Deliberately still client-side (documented, not forgotten): quest/training
STARTS (energy spend, board refresh, session records — the endsAt/startedAt
anchors are client-written, so true timer validation requires migrating the
starts themselves; the claims that pay out are server-side, so forged starts
only skip wait timers). The arena battle simulation also remains client-side
(C4): settlement derives payouts from the tier table with clamped
performance bonuses, so a dishonest client can claim a win but cannot
invent reward amounts.

## Rival battle cleanup (Firestore TTL) — one-time, Pak runs it

`rivalBattleHost` writes one document per issued battle at
`rivalBattles/{uid}/battles/{battleId}` (collection group **`battles`**). Each
carries `expireAt`, a Firestore Timestamp = `expiresAtMs` (issue + 2 h) +
`RIVAL_BATTLE_TTL_GRACE_MS` (7 days), both in `src/lib/rivalLadder.ts`. The
field does nothing until the TTL policy is enabled once per project:

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=battles \
  --database='(default)' \
  --enable-ttl \
  --project=holobots-24046
```

Check it with `gcloud firestore fields ttls list --project=holobots-24046`
(state goes `CREATING` → `ACTIVE`; it can take a while on first enable).

Recommended alongside it (same one-time step, optional): exempt the two
fields nothing queries from single-field indexing. `expireAt` is a
near-sequential timestamp (Google's TTL guidance: exempt it to avoid index
hot-spotting), and `lineup` is a nested map/array that otherwise produces a
dozen-plus index entries per battle:

```bash
gcloud firestore indexes fields update expireAt --collection-group=battles --database='(default)' --disable-indexes --project=holobots-24046
gcloud firestore indexes fields update lineup   --collection-group=battles --database='(default)' --disable-indexes --project=holobots-24046
```

Notes:

- The policy applies to **every** collection group named `battles`. Today
  only `rivalBattles/{uid}/battles` uses that name; don't reuse it for data
  that must not expire.
- Settlement is still gated by `expiresAtMs` (2 h), not by `expireAt`. A
  settled battle replays its ruling (`alreadyProcessed: true`) for the whole
  grace window. Deletion is not instant (typically within 24 h after
  `expireAt`); once the record is gone a late duplicate settle returns
  `unknown_battle` and writes nothing, so no ruling is ever re-granted.
- Battles issued before this change have no `expireAt` and are never
  deleted by TTL. `rivalBattleHost` **was** deployed to production on
  2026-09-30 (before this field existed), so production already holds
  some. They are small (about 1–2 KB each) and harmless. They expired for
  settlement 2 h after issue, and they are not in the open-battle ledger,
  so they never count toward the 3-open cap. To reclaim them, a one-time
  admin backfill would set `expireAt = expiresAtMs + 7 days` on each
  `battles` doc that lacks it; nothing in this repo runs one.
- Cost: TTL deletes are billed as ordinary document deletes (one per issued
  battle) and need no reads; no query, index or client read is added
  (settle/issue are point reads). The new field adds no write operations.
  Without the index exemptions above each battle write also maintains index
  entries for every field, which costs index storage, not extra billed ops.
- The parent doc `rivalBattles/{uid}` (the open-battle ledger, at most 3
  entries) is not in the `battles` group and is never TTL-deleted. It is a
  single small doc per pilot, removed by `deleteUserAccountV2`.
- `firestore.indexes.json` is not changed. If you later deploy it with
  `firebase deploy --only firestore:indexes --force`, the CLI may remove
  field overrides that the file does not list, so re-check the TTL policy
  (or add the overrides to the file first).

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
