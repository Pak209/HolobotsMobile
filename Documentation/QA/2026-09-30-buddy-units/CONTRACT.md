# Contract-Change: Buddy Unit inventory, captures spend Units, rival battle host (DECISIONS #43) + Buddy Unit capture tiers (DECISIONS #44)

Server lane, HolobotsMobile functions. Local only: nothing deployed.

> **#44 (2026-10-01) supersedes parts of #43 below.** The current wire contract is **acquisition-2**. Read the section [DECISIONS #44: acquisition-1 → acquisition-2](#decisions-44-acquisition-1--acquisition-2) and the [Unity hand-off for #44](#unity-hand-off-for-44) first. The #43 text is kept as history: anything it says about an integer `buddyUnits`, "a refusal keeps the Unit" or `retryGuaranteed` is replaced.

## Storage (users/{uid}, server-only)

| Field | Type | Meaning |
|---|---|---|
| `buddyUnits` | `{light, medium, heavy}`, each int ≥ 0 (#44; was int ≥ 0 in #43) | Held Buddy Units per tier. No cap. A #43 integer `N` is migrated lazily to `{light: N, medium: 0, heavy: 0}`. |
| `rivalWins` | int ≥ 0 | Rival wins (losses never count). Missing = 0. |
| `rivalRewardDay` | `YYYY-MM-DD` | UTC day of the last daily rival reward. Missing = never. |

Firestore rules deny a client create carrying any of the three and any client add / change / delete (unchanged full-profile merges stay legal). Issued battles live at `rivalBattles/{uid}/battles/{battleId}`; the parent doc `rivalBattles/{uid}` is the server's open-battle ledger `{openBattles: {battleId: expiresAtMs}}` (both catch-all deny; no client read or write). Battle docs also carry `expireAt` (Timestamp, expiry + 7 days) for Firestore TTL cleanup. Since 2026-10-01 the client also cannot delete `users/{uid}` at all (account deletion goes through `deleteUserAccountV2`, which also removes `rivalBattles/{uid}` and `wildEncounterSessions/{uid}`).

**Starter Unit (exactly once).** `STARTING_BUDDY_UNITS = 1` (#44: one **Light** Unit, `{light: 1, medium: 0, heavy: 0}`). A missing `buddyUnits` field means the server has never seen the pilot: `createGenesisProfile` writes it at creation; otherwise the first transaction in `wildEncounterHost`, `desktopAccountSnapshot` or `rivalBattleHost` writes it. A present field (including 0, and an integer being migrated) never re-grants. A present but malformed value (null, partial map, extra keys, negatives) fails closed as `unavailable` and is never treated as missing. Clients cannot create or delete the field, nor delete and recreate the profile, so the grant cannot be replayed.

## acquisition-0 → acquisition-1 (wildEncounterHost, #43, superseded by acquisition-2)

Breaking: a capture intent with `schemaVersion: "acquisition-0"` is now `invalid_request`.

Request (only the version string changes):
`{operation:"capture", intent:{schemaVersion:"acquisition-1", requestId, encounterId, toyId, observedHealth01}}`.
`toyId` is still the encounter's `buddy_unit` itemId. `offerToy` / `worldState` / `refresh` and `capture-world-1` are unchanged.

Reply changes:
- New top-level `buddyUnits: int`. Present on every reply, including the empty new-pilot refresh.
- `encounters[].schemaVersion`, `roster.schemaVersion` and `captureResult.schemaVersion` are now `"acquisition-1"`.
- `captureResult.buddyUnitsSpent: int`. 1 on `captured`, else 0.
- `captureResult.outcome` adds `"no_buddy_units"`. The full set is `captured | refused | no_buddy_units`. It comes with `captured:false`, `retryGuaranteed:false`, `toyConsumedId:""`, `ownershipOutcome:""`, `blueprintDelta:0` and the unchanged `affinityTierAfter`. Nothing is mutated: no session revision, no receipt and no account write. The same requestId can therefore succeed once the player holds a Unit.
- `worldStates[].items[]` with `kind:"buddy_unit"`: `remaining` is now the player's `buddyUnits`, not the encounter stock, and `useAllowed` is false at 0. `encounters[].allowedToyIds` is empty at 0 Units. The encounter is still presented, so the player can meet it but cannot throw. Affinity Toys are unaffected.
- A refusal keeps the Unit. An accepted capture decrements `buddyUnits` by 1 in the same transaction as the #40 ownership write. Receipt replays show the current `buddyUnits` with the original `captureResult`.
- The provisioned session's buddy_unit `remaining` is no longer read or written. The item still supplies itemId / displayName / modelKey / useAllowed.

## desktop-account-1 (additive, version unchanged)

`desktopAccountSnapshot` adds `buddyUnits: int`. This shape was **deployed 2026-09-30** and a shipped Unity build parses it. #44 keeps serving it unchanged as `desktop-account-1` (`buddyUnits` = the total across tiers), and adds `desktop-account-2` for the tier object (see #44 below). It is now a transaction because it may write the starter Unit once. No other field changes. Unity's strict `schemaVersion == "desktop-account-1"` check keeps passing.

## rival-battle-1 (new callable `rivalBattleHost`)

Requests: `{operation:"status"}` · `{operation:"issue"}` · `{operation:"settle", battleId:string, didWin:boolean}`.

`status` object (in every reply): `{tier:int, tierLabel:string, rivalWins:int, winsToNextTier:int, rivalsThisTier:int, dailyRewardAvailable:bool, buddyUnits:int}` (unchanged in rival-battle-1: the total across tiers since #44; the tier object is rival-battle-2).

- **status** → `{schemaVersion:"rival-battle-1", status}`
- **issue** → `{schemaVersion, battleId, expiresAtMs, tier, encounter:{encounterId (= battleId), seed:int, opponentPilot:{pilotId, displayName, tier}, opponentSquad:CombatantSnapshot[]}, status}`. `opponentPilot` and `opponentSquad` match Unity's `NpcPilotSnapshot` and `CombatantSnapshot` (holobotId, level, maxHealth, attack, defense, maxStamina, staminaRegen, deployment{deployCost, drainPerSecond, rechargePerSecond}, moves[{moveId, staminaCost, damageScale, breakPower, chargeable}]). The squad holds 1–3 entries with distinct roster ids.
- **settle** → `{schemaVersion, battleId, alreadyProcessed:bool, didWin:bool, buddyUnitsGranted:int, tierBefore:int, tierAfter:int, status}`. A duplicate settle returns the original ruling (`alreadyProcessed:true`) with the current status and writes nothing. A settled battle's `didWin` cannot be changed.

Rejections (`details.rejectionCode`): `invalid_request` (invalid-argument), `unknown_battle` (not-found: never issued to this uid, or cleaned up by TTL ≥ 7 days after expiry), `battle_expired` (failed-precondition: unsettled past `expiresAtMs`, TTL 2 h), `too_many_open` (failed-precondition, `issue` only), `too_fast` (failed-precondition, `settle` only), `unavailable` (malformed stored ledger or missing profile), `unauthenticated`.

Limits (2026-10-01, `RIVAL_MAX_OPEN_BATTLES` / `RIVAL_MIN_WIN_MS` in `rivalLadder.ts`). Neither rejection writes anything.

- **`too_many_open`**: `issue` while the pilot already holds 3 open battles. Open means issued, unsettled and `now <= expiresAtMs`. Settling a battle (win or loss) or letting it expire frees its slot. Unity should settle or abandon a battle before asking for another. On `aborted`, either send `settle{didWin:false}` to free the slot, or wait for the 2 h expiry.
- **`too_fast`**: `settle{didWin:true}` less than 20 s after issue (server clock). The battle stays open and the same settle succeeds once 20 s have passed, so Unity may retry after a short delay. `didWin:false` is never too fast. A duplicate settle of an already-settled battle still replays `alreadyProcessed:true`.

Trust model is settleArenaBattle's: the client claims the win, and the server owns tier, lineup, amounts, the UTC day and once-per-battleId settlement.

### Tier table (functions/src/lib/rivalLadder.ts, producer defaults)

tier = floor(rivalWins / 10). Baseline (scale 1.0) = the wolf in Unity's pilot-battle sample: HP 285, ATK 52, DEF 18. HP, ATK and DEF scale with the tier; stamina, deployment and moves stay fixed.

| tier | wins | label | level | statScale | rivals |
|---|---|---|---|---|---|
| 0 | 0–9 | rookie | 5 | 0.80 | 1 |
| 1 | 10–19 | rookie | 8 | 0.90 | 1 |
| 2 | 20–29 | challenger | 11 | 1.00 | 2 |
| 3 | 30–39 | challenger | 14 | 1.10 | 2 |
| 4 | 40–49 | elite | 18 | 1.20 | 3 |
| 5 | 50–59 | elite | 22 | 1.30 | 3 |
| 6 | 60–69 | elite | 26 | 1.40 | 3 |
| 7 | 70–79 | legend | 30 | 1.50 | 3 |
| 8 | 80–89 | legend | 35 | 1.62 | 3 |
| 9 | 90–99 | legend | 40 | 1.75 | 3 |
| 10+ | | legend | +5 per tier (cap 99) | +0.12 per tier | 3 |

Rival ids are drawn from the 12-bot roster (`HOLOBOT_NAMES` → ace, kuma, shadow, era, hare, tora, wake, gama, ken, kurai, tsuin, wolf), the same set as Unity's HolobotRegistry.

## Unity hand-off for #43 (history; #44 below replaces items 1–4)

1. `AcquisitionSchema.Version` changes from `"acquisition-0"` to `"acquisition-1"`. Update `Schemas/` and the preview JSON in `Assets/HoloCity/Resources/AcquisitionPreview/` to match.
2. `CaptureResultSnapshot`: add `public int buddyUnitsSpent;`. `CaptureOutcome`: add `public const string NoBuddyUnits = "no_buddy_units";`. The overlay shows a "no Buddy Units" state for it and must not treat it as a refusal or retry.
3. Wild reply DTO: add `public int buddyUnits;` and show it as the player's Unit count. Read the buddy_unit item `remaining` / `useAllowed` as host-declared (they are now the player's inventory). Gate the throw on `useAllowed` / `allowedToyIds` only and never compare the count locally.
4. Desktop account view: read `buddyUnits` (int) from `desktopAccountSnapshot`. (This is what the shipped build does; it keeps working as `desktop-account-1` after #44.)
5. Rival battles: call `rivalBattleHost`. For `issue`, overlay `encounter.encounterId`, `encounter.seed`, `encounter.opponentPilot` and `encounter.opponentSquad` onto the existing EncounterPayload; the player-side `ace` / `squad` stay as Unity builds them today. Pass `opponentSquad[].holobotId` to `BeginChallenge`'s squad ids in place of the table row's `holobotId`. When the director's terminal detection fires, send `settle{battleId, didWin: outcome=="player"}` and show `buddyUnitsGranted`, `tierBefore` → `tierAfter` and `status`. On `aborted`, either send `settle{didWin:false}` (frees the open-battle slot) or let the battle expire. On `too_fast`, retry the same settle after a short delay. On `too_many_open`, settle or wait out an open battle first. Use `status` for the "daily reward available / wins to next tier" HUD.
6. No Unit counts, tiers, stats or grant logic in Unity: render replies only.

## DECISIONS #44: acquisition-1 → acquisition-2

Spec (Pak, 2026-10-01): Buddy Units come in three tiers. A refusal **consumes** the Unit, which supersedes #40/#43 (there is no more "refusal returns the Unit" and no `retryGuaranteed`). The server owns the odds; the roll is seeded per requestId.

### Tiers (`functions/src/lib/buddyUnits.ts`, one data module)

| Tier id (wire) | Storage key | Base chance | Affinity raises it? | Source today |
|---|---|---|---|---|
| `buddy_light` | `light` | 0.35 | yes | new-pilot starter (1), daily rival win (1) |
| `buddy_medium` | `medium` | 0.65 | yes | none yet (marketplace / arena later; admin seam for tests) |
| `buddy_heavy` | `heavy` | 1.00 | no (always 100%) | none yet (same) |

**Affinity formula** (producer default; `AFFINITY_LIFT_SCALE = 1`):

```
lift   = max(0, chanceByAffinity[affinityTier] − chanceByAffinity[0]) × AFFINITY_LIFT_SCALE
chance = Heavy ? 1 : min(1, baseChance + lift)          (rounded to 6 decimals)
captured ⇔ roll < chance
```

Each encounter's existing `chanceByAffinity` curve now says how much toys *raise* the odds over its affinity-0 value; the tier sets the base. At affinity 0 every tier throws at exactly its base. Example: an encounter with `chanceByAffinity [0.30, 0.65]` after one accepted toy (affinity 1) has lift 0.35, so Light = 0.70, Medium = 1.00 (clamped), Heavy = 1.00. A falling curve never lowers a tier below its base.

**Roll:** `roll = HMAC-SHA256(sessionSecret, "capture-roll-1|encounterId|requestId")`, the first 48 bits / 2^48, which gives a value in [0, 1). The secret (`rollSeed`) is created on the first rolled capture and stored on the server-only `wildEncounterSessions/{uid}` doc. It is never sent to a client, so a client can't search for requestIds that roll low. The same requestId always gives the same roll. On top of that, a retry replays its receipt, so a ruling is never re-rolled and a Unit is never spent twice. The roll does not depend on the tier. It is revealed only after a Unit was spent: `no_buddy_units` replies carry `rolled:false, roll:0`.

### Request

`{operation:"capture", intent:{schemaVersion:"acquisition-2", requestId, encounterId, toyId, observedHealth01}}`

- `toyId` must be a **tier id**: `buddy_light | buddy_medium | buddy_heavy`. Anything else, including the old per-encounter item id such as `"unit"`, is `invalid_request`.
- An `acquisition-1` (or `-0`) capture intent is `invalid_request`.
- `offerToy` / `worldState` / `refresh` requests are unchanged, as are `capture-world-1` world states (fields are only added, see below). The mobile bridge (`mobile/src/lib/unity/wildBridge.ts`) now forwards only `acquisition-2` capture intents.

### Reply (every wildEncounterHost reply)

- Top-level `buddyUnits` is now an **object** `{light:int, medium:int, heavy:int}` (was int). This includes the empty new-pilot refresh.
- `encounters[].schemaVersion`, `roster.schemaVersion` and `captureResult.schemaVersion` are `"acquisition-2"`.
- `encounters[].allowedToyIds`: the tier ids the player holds at least 1 of, e.g. `["buddy_light","buddy_heavy"]`. It is empty when the encounter's buddy gate is closed or the player holds none.
- `worldStates[].items[]`: the encounter's single provisioned `buddy_unit` item is presented as **three items**, one per tier, in the order light, medium, heavy:
  `{itemId:"buddy_light", kind:"buddy_unit", displayName:"Light Buddy Unit", modelKey:"buddy_unit_light", remaining:<player's count>, useAllowed:<gate && count>0 && open>, captureChance01:<that tier's chance>}`.
  Affinity Toy items are unchanged except for a new `captureChance01: 0`. Every item now carries `captureChance01`.
- `worldStates[].captureChance01` (top level) is the **Light** tier's chance. Per-tier chances are on the items.

`captureResult` (acquisition-2):

| Field | captured | refused | no_buddy_units |
|---|---|---|---|
| `outcome` | `"captured"` | `"refused"` | `"no_buddy_units"` |
| `captured` | true | false | false |
| `buddyUnitTier` **(new)** | tier id thrown | tier id thrown | tier id requested |
| `buddyUnitsSpent` | 1 | **1** (was 0) | 0 |
| `toyConsumedId` | tier id | **tier id** (was "") | "" |
| `retryGuaranteed` | false | **false** (was true) | false |
| `rolled` **(new)** | true | true | false |
| `roll` **(new)** | the roll, in [0, 1) | the roll, in [0, 1) | 0 |
| `captureChance01` **(new)** | chance used | chance used | that tier's current chance |
| `ownershipOutcome` / `blueprintDelta` | as #40 | "" / 0 | "" / 0 |
| `affinityTierAfter` | unchanged meaning | | |

- A refused encounter stays open, so the player can throw again, spending another Unit. A captured one is withdrawn as before.
- `no_buddy_units` names the tier and mutates nothing: no session revision, no receipt, no account write. The same requestId can therefore succeed once the player holds that tier.
- Receipt replays (same requestId and body) return the original `captureResult` with the current `buddyUnits` and presentation, and spend nothing. The same requestId with a different body, for example another tier, is `sequence_conflict`.
- `retryGuaranteed` is kept only for wire stability and is always false. Unity should stop reading it.

### desktop-account-2 and rival-battle-2 (version bumps, negotiated; v1 stays served)

`desktopAccountSnapshot` and `rivalBattleHost` were **deployed to production on 2026-09-30** with `buddyUnits` as an int (`desktop-account-1` / `rival-battle-1`), and a shipped Unity build parses that int under a strict `schemaVersion` check. Every reply where `buddyUnits` becomes the tier object therefore carries a new version. The client opts in through a request field, so the shipped build keeps working unchanged after this deploy.

| Callable | Request | Reply `schemaVersion` | `buddyUnits` |
|---|---|---|---|
| `desktopAccountSnapshot` | no data, `{}` or `{schemaVersion:"desktop-account-1"}` | `"desktop-account-1"` (unchanged deployed shape) | **int**: total across all tiers |
| `desktopAccountSnapshot` | `{schemaVersion:"desktop-account-2"}` | `"desktop-account-2"` | `{light, medium, heavy}` |
| `rivalBattleHost` | any operation without `schemaVersion`, or `"rival-battle-1"` | `"rival-battle-1"` (unchanged deployed shape) | `status.buddyUnits` **int**: total across all tiers |
| `rivalBattleHost` | any operation with `schemaVersion:"rival-battle-2"` | `"rival-battle-2"` | `status.buddyUnits` = `{light, medium, heavy}` |

Any other requested `schemaVersion` is `invalid-argument` / `invalid_request`.

**rival-battle-2 vs rival-battle-1:**
- `status.buddyUnits` is the object, not an int.
- `settle` adds `buddyUnitTierGranted: "buddy_light" | ""`: the tier of `buddyUnitsGranted`, or "" when nothing was granted. Duplicate settles replay it.
- Nothing else differs. Issue, settle, the open-battle cap, `too_fast` and every ruling are identical in both versions, and both share one ledger: a battle issued through v1 can be settled or replayed through v2, and the reverse.
- The daily reward is one **Light** Unit in both. In v1 it shows up as the total rising by 1.
- Stored battle records keep `schemaVersion: "rival-battle-1"`, the record format production battles already carry. It is independent of the wire version.

**v1 compatibility caveat:** v1 reports a single int, but #44 capture requests (acquisition-2) need a tier. A v1-only client can display the total but cannot throw. That's fine because the shipped build's acquisition-1 captures stop working when `wildEncounterHost` deploys anyway (the hard cut Pak chose).

Fixtures: `desktop-account-1_compat.json`, `desktop-account-2.json`, `rival-battle-1_settle_compat.json`, `rival-battle-2_status.json` and `rival-battle-2_settle.json` (uid redacted).

### Storage, migration and security

- `users/{uid}.buddyUnits = {light, medium, heavy}`.
- Every reader (wild host, desktop snapshot, rival host, the admin seam) migrates a #43 integer `N` to `{light: N, medium: 0, heavy: 0}` lazily in its own transaction. This is idempotent: once migrated there is nothing left to write.
- A missing field is the starter grant: one Light Unit, exactly once. `createGenesisProfile` writes `{light:1, medium:0, heavy:0}` at creation.
- Malformed values fail closed. This, together with PR #54's rule that clients cannot delete `users/{uid}`, keeps the starter farm closed.
- Rules: `buddyUnits` is in the protected MapDiff set, so a client create with it, and any client add, change or delete of the map or any tier (including dotted `buddyUnits.light` updates), is denied. Unchanged full-profile merges stay legal.
- The session secret `rollSeed` is on the server-only `wildEncounterSessions/{uid}` doc (catch-all deny).
- The #40 session flag `returnRefusedUnit` is now ignored. Sessions with or without it work.

**Admin / test-only seam:** `grantBuddyUnitsAdmin(db, uid, tierId, count)` in `functions/src/acquisition/buddyUnitAdmin.ts`.
- It is Admin SDK only and not exported from `src/index.ts`, so no client can reach it.
- `count` is 1..1000.
- It migrates and applies the starter grant first.

Fixtures (generated by the emulator suite): `Documentation/QA/2026-10-01-buddy-unit-tiers/fixtures/`.

## Unity hand-off for #44

1. `AcquisitionSchema.Version` changes from `"acquisition-1"` to `"acquisition-2"`. Update `Schemas/` and the preview JSON in `Assets/HoloCity/Resources/AcquisitionPreview/` from the new fixtures.
2. Capture intent: `toyId` is the **tier id** the player chose (`"buddy_light"`, `"buddy_medium"` or `"buddy_heavy"`), taken from the world item's `itemId`. Never send the old encounter item id.
3. Add a `BuddyUnitCounts { public int light; public int medium; public int heavy; }` DTO. Wild reply: `public BuddyUnitCounts buddyUnits;` replaces `public int buddyUnits;`. Show the three counts (or their total) from the reply only.
4. World items: render one Buddy Unit item per tier from `worldStates[].items[]` (`kind == "buddy_unit"`), using its `displayName`, `modelKey`, `remaining`, `useAllowed` and the new `public float captureChance01;`. Gate each throw on that item's `useAllowed` / `allowedToyIds` only. Never compute odds or counts locally.
5. `CaptureResultSnapshot`: add `public string buddyUnitTier; public bool rolled; public float roll; public float captureChance01;`. Remove or ignore `retryGuaranteed`, which is always false.
6. Outcomes: `captured | refused | no_buddy_units`. **`refused` now consumes the Unit**: the overlay must not promise a free retry ("the Unit was used"); the encounter stays open for another throw if the player has Units. `no_buddy_units` shows a "no <tier> Units" state using `buddyUnitTier`.
7. Desktop account view: send `{schemaVersion:"desktop-account-2"}` as the `desktopAccountSnapshot` request data, and accept reply `schemaVersion == "desktop-account-2"` (update the strict check). Read `buddyUnits` as `BuddyUnitCounts`, not int. Without the request field the server keeps answering `desktop-account-1` with the total as an int.
8. Rival battles: add `schemaVersion:"rival-battle-2"` to every `rivalBattleHost` request (status, issue and settle), and expect reply `schemaVersion == "rival-battle-2"`. `status.buddyUnits` is `BuddyUnitCounts`. Show `buddyUnitsGranted` together with `buddyUnitTierGranted` ("buddy_light"). Battles issued by an older build can be settled by the new one.
9. No tiers, odds, rolls or grant logic in Unity: render replies only.

## Verification (Node 22.23.1, #43 run; see PR for the #44 counts)

| Check | Result |
|---|---|
| `npm --prefix functions run build` (check:shared + tsc) | PASS |
| `npm --prefix functions test` (domain: wild 16, rival ladder 8) | 24/24 |
| `npm --prefix functions run test:emulator` (wild 21, travel squad 7, rival 7) | 35/35 |
| `npm run test:rules` (full rules suite incl. new buddy-units-rival) | 82/82 |
| mobile vitest: unity bridge + genesis/progression/travel-squad parity | 61 pass, 1 skipped (pre-existing) |

## Deploy (Pak approves; not run)

Rules first, then functions. Deploying `wildEncounterHost` makes every acquisition-0 / acquisition-1 capture fail with `invalid_request`, so ship it alongside the Unity acquisition-2 change (#44) and the mobile build whose bridge forwards acquisition-2.

```bash
firebase deploy --project holobots-24046 --only firestore:rules
firebase deploy --project holobots-24046 --only functions:rivalBattleHost,functions:wildEncounterHost,functions:desktopAccountSnapshot,functions:createGenesisProfile,functions:deleteUserAccountV2
```

Full list (now 33; use for any whole-codebase redeploy):

```bash
firebase deploy --project holobots-24046 --only functions:applyReferralCode,functions:assignWildcardBlueprints,functions:chargeArenaEntry,functions:createGenesisProfile,functions:createWebviewBridgeToken,functions:claimDailyMission,functions:claimGenesisSquad,functions:claimQuestRun,functions:claimTrainingSession,functions:clearWorkoutCooldown,functions:deleteUserAccountV2,functions:mintHolobot,functions:mirrorLeaderboardEntry,functions:openGachaPack,functions:purchaseMarketplaceBooster,functions:purchaseMarketplaceItem,functions:redeemLegendaryBlueprint,functions:revenuecatWebhook,functions:purchaseMarketplacePart,functions:saveHolobotCombatKit,functions:settleArenaBattle,functions:syncFitnessActivity,functions:syncWatchWorkoutRewards,functions:upgradeHolobotRank,functions:upgradeHolobotMove,functions:upgradeSyncStat,functions:useEnergyRefill,functions:useExpBooster,functions:useRankSkip,functions:wildEncounterHost,functions:travelSquadHost,functions:desktopAccountSnapshot,functions:rivalBattleHost
```
