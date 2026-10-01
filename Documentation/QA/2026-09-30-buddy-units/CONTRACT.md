# Contract-Change: Buddy Unit inventory, captures spend Units, rival battle host (DECISIONS #43)

Server lane, HolobotsMobile functions. Local only: nothing deployed or pushed.

## Storage (users/{uid}, server-only)

| Field | Type | Meaning |
|---|---|---|
| `buddyUnits` | int ≥ 0 | Held Buddy Units. No cap. |
| `rivalWins` | int ≥ 0 | Rival wins (losses never count). Missing = 0. |
| `rivalRewardDay` | `YYYY-MM-DD` | UTC day of the last daily rival reward. Missing = never. |

Firestore rules deny a client create carrying any of the three and any client add / change / delete (unchanged full-profile merges stay legal). Issued battles live at `rivalBattles/{uid}/battles/{battleId}` (catch-all deny; no client read or write).

**Starter Unit (exactly once).** `STARTING_BUDDY_UNITS = 1`. A missing `buddyUnits` field means the server has never seen the pilot: `createGenesisProfile` writes it at creation; otherwise the first transaction in `wildEncounterHost`, `desktopAccountSnapshot` or `rivalBattleHost` writes it. A present field (including 0) never re-grants. Clients cannot create or delete the field, so the grant cannot be replayed.

## acquisition-0 → acquisition-1 (wildEncounterHost)

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

`desktopAccountSnapshot` adds `buddyUnits: int`. It is now a transaction because it may write the starter Unit once. No other field changes. Unity's strict `schemaVersion == "desktop-account-1"` check keeps passing.

## rival-battle-1 (new callable `rivalBattleHost`)

Requests: `{operation:"status"}` · `{operation:"issue"}` · `{operation:"settle", battleId:string, didWin:boolean}`.

`status` object (in every reply): `{tier:int, tierLabel:string, rivalWins:int, winsToNextTier:int, rivalsThisTier:int, dailyRewardAvailable:bool, buddyUnits:int}`.

- **status** → `{schemaVersion:"rival-battle-1", status}`
- **issue** → `{schemaVersion, battleId, expiresAtMs, tier, encounter:{encounterId (= battleId), seed:int, opponentPilot:{pilotId, displayName, tier}, opponentSquad:CombatantSnapshot[]}, status}`. `opponentPilot` and `opponentSquad` match Unity's `NpcPilotSnapshot` and `CombatantSnapshot` (holobotId, level, maxHealth, attack, defense, maxStamina, staminaRegen, deployment{deployCost, drainPerSecond, rechargePerSecond}, moves[{moveId, staminaCost, damageScale, breakPower, chargeable}]). The squad holds 1–3 entries with distinct roster ids.
- **settle** → `{schemaVersion, battleId, alreadyProcessed:bool, didWin:bool, buddyUnitsGranted:int, tierBefore:int, tierAfter:int, status}`. A duplicate settle returns the original ruling (`alreadyProcessed:true`) with the current status and writes nothing. A settled battle's `didWin` cannot be changed.

Rejections (`details.rejectionCode`): `invalid_request` (invalid-argument), `unknown_battle` (not-found: never issued to this uid), `battle_expired` (failed-precondition: unsettled past `expiresAtMs`, TTL 2 h), `unavailable` (malformed stored ledger or missing profile), `unauthenticated`.

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

## Unity hand-off (Contract-Change on the Unity side)

1. `AcquisitionSchema.Version` changes from `"acquisition-0"` to `"acquisition-1"`. Update `Schemas/` and the preview JSON in `Assets/HoloCity/Resources/AcquisitionPreview/` to match.
2. `CaptureResultSnapshot`: add `public int buddyUnitsSpent;`. `CaptureOutcome`: add `public const string NoBuddyUnits = "no_buddy_units";`. The overlay shows a "no Buddy Units" state for it and must not treat it as a refusal or retry.
3. Wild reply DTO: add `public int buddyUnits;` and show it as the player's Unit count. Read the buddy_unit item `remaining` / `useAllowed` as host-declared (they are now the player's inventory). Gate the throw on `useAllowed` / `allowedToyIds` only and never compare the count locally.
4. Desktop account view: read `buddyUnits` (int) from `desktopAccountSnapshot`.
5. Rival battles: call `rivalBattleHost`. For `issue`, overlay `encounter.encounterId`, `encounter.seed`, `encounter.opponentPilot` and `encounter.opponentSquad` onto the existing EncounterPayload; the player-side `ace` / `squad` stay as Unity builds them today. Pass `opponentSquad[].holobotId` to `BeginChallenge`'s squad ids in place of the table row's `holobotId`. When the director's terminal detection fires, send `settle{battleId, didWin: outcome=="player"}` and show `buddyUnitsGranted`, `tierBefore` → `tierAfter` and `status`. On `aborted`, don't settle; the battle expires. Use `status` for the "daily reward available / wins to next tier" HUD.
6. No Unit counts, tiers, stats or grant logic in Unity: render replies only.

## Verification (Node 22.23.1)

| Check | Result |
|---|---|
| `npm --prefix functions run build` (check:shared + tsc) | PASS |
| `npm --prefix functions test` (domain: wild 16, rival ladder 8) | 24/24 |
| `npm --prefix functions run test:emulator` (wild 21, travel squad 7, rival 7) | 35/35 |
| `npm run test:rules` (full rules suite incl. new buddy-units-rival) | 82/82 |
| mobile vitest: unity bridge + genesis/progression/travel-squad parity | 61 pass, 1 skipped (pre-existing) |

## Deploy (Pak approves; not run)

Rules first, then functions. Deploying `wildEncounterHost` makes every acquisition-0 capture fail with `invalid_request`, so ship it alongside the Unity acquisition-1 change.

```bash
firebase deploy --project holobots-24046 --only firestore:rules
firebase deploy --project holobots-24046 --only functions:rivalBattleHost,functions:wildEncounterHost,functions:desktopAccountSnapshot,functions:createGenesisProfile
```

Full list (now 33; use for any whole-codebase redeploy):

```bash
firebase deploy --project holobots-24046 --only functions:applyReferralCode,functions:assignWildcardBlueprints,functions:chargeArenaEntry,functions:createGenesisProfile,functions:createWebviewBridgeToken,functions:claimDailyMission,functions:claimGenesisSquad,functions:claimQuestRun,functions:claimTrainingSession,functions:clearWorkoutCooldown,functions:deleteUserAccountV2,functions:mintHolobot,functions:mirrorLeaderboardEntry,functions:openGachaPack,functions:purchaseMarketplaceBooster,functions:purchaseMarketplaceItem,functions:redeemLegendaryBlueprint,functions:revenuecatWebhook,functions:purchaseMarketplacePart,functions:saveHolobotCombatKit,functions:settleArenaBattle,functions:syncFitnessActivity,functions:syncWatchWorkoutRewards,functions:upgradeHolobotRank,functions:upgradeHolobotMove,functions:upgradeSyncStat,functions:useEnergyRefill,functions:useExpBooster,functions:useRankSkip,functions:wildEncounterHost,functions:travelSquadHost,functions:desktopAccountSnapshot,functions:rivalBattleHost
```
