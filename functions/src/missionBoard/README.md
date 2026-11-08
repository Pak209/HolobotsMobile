# `missionBoardHost` — HoloCity Mission Board (`mission-board-1`)

One callable serves the Mission Board's postings to both clients, the Unity desktop app and the Lite mobile app.
The server owns the postings, the refill clock, completion checks and rewards. Clients show the replies and say
which landmark the pilot arrived at. Nothing else comes from the client.

Code: `lib/missionBoard.ts` (pure rules and tables), `missionBoard/missionBoardStore.ts` (transaction, fact reads),
`missionBoard/missionBoardHost.ts` (callable), `lib/cityDistricts.ts` (shared city plan districts),
`city/cityWildSpots.ts` + `city/cityEncounterHost.ts` `provisionSpot` (repeatable wild spots). Tests:
`scripts/test-mission-board.mjs`, `scripts/test-mission-board-store.mjs`, `scripts/test-city-wild-spots.mjs`.
Fixture: `docs/contracts/mission-board-1.json`.

## Rulings (Pak, 2026-11-07, with the same-day follow-up)

| Ruling | Implementation |
|---|---|
| Four posting kinds | `beast` (defeat an Error Beast at a city spot), `rival` (beat a rival pilot), `capture` (link a wild Holobot), `visit` (go to a district landmark) |
| Refill on clear | 3 slots per pilot, always filled. A claimed slot keeps its posting (`state:'claimed'`, `refillAtMs`) until `MISSION_BOARD_REFILL_MS` = 10 min after the claim. The next `status` / `claim` after that time puts up a new posting. |
| Rewards match existing payouts | beast / rival / capture: `BATTLE_WIN_HOLOS` = **100 Holos** plus the battle table's win EXP at the pilot's **current rival tier** (`tierForWins(users/{uid}.rivalWins)`, the rival ladder's tier; no performance bonus: tier 0 = 95, 1 = 137, 2 = 180, …; EXP Booster doubles it) for **every travel-squad Holobot**. The tier is read at claim time; status shows `reward.exp` at the current tier (`rivalTier` on the reply), and a claimed posting shows what it paid (`granted.expTier`). About 1 in 3 also pays **1 `blueprint_fragment`** (shown in `reward.items` before the claim). Visits pay the intro visit amounts, **50 / 75 Holos**, with no EXP. Grants reuse `holosAfterGrant`, `awardBattleExperienceRaw` and `itemStocksAfterFragmentGrant` (the zone clear grant). |
| Intro quests alongside | While `introQuests/{uid}` is incomplete, `status` returns the intro chain first (`intro`, the `introQuestHost` status shape) **and** the 3 postings from day one. Postings are claimable during the intro. A `claim` whose `postingId` is an intro `stepId` is passed to the intro quest store unchanged, so its order, verification and rewards still apply. The board never copies intro state. |
| Repeatable wild spots | Capture postings target one of Unity's 11 wild spots (`WildHolobotTable_HoloCity.asset`), served by `cityEncounterHost` `provisionSpot` (below), or the once-only Research Garden KURAI. |
| District ids | The shared city plan's `D01`…`D10` (`lib/cityDistricts.ts`, the Lite field's `cityPlan.generated.json` and its `cityDistrictAt` rule), resolved from plan coordinates. |

## Request

```jsonc
{ "operation": "status", "schemaVersion": "mission-board-1" }          // schemaVersion optional; any other value → invalid_request
{ "operation": "claim", "postingId": "mbp_4_a1b2c3d4e5f6", "requestId": "<[A-Za-z0-9_-]{1,128}>", "destinationId": "workshop" }
```

`destinationId` is only needed for a `visit` posting, or for an intro visit step forwarded to the intro store. Replaying a
`requestId` returns the first ruling and doesn't need `destinationId`.

## Replies

### `status`

```jsonc
{ "schemaVersion": "mission-board-1",
  "introPending": true,                           // false once the intro chain is done
  "intro": { "currentStepId": "visit_workshop", "complete": false, "steps": [ /* introQuestHost IntroStepView[] */ ], "totalReward": { … } },
                                                  // null once the intro chain is done; shown ahead of the postings
  "rivalTier": 2,                                 // the tier battle-posting EXP is ruled at
  "postings": [                                   // always 3, slot order, from day one
    { "postingId": "mbp_0_9f…", "slot": 0, "kind": "beast", "title": "Guild Court sweep",
      "detail": "Defeat an Error Beast at the Guild Court.", "target": "guild_court", "holobotId": "", "districtId": "D04",
      "reward": { "holos": 100, "exp": 180, "items": [{ "itemId": "blueprint_fragment", "quantity": 1 }] },
      "issuedAtMs": 1794067200000, "state": "open", "refillAtMs": null, "claimedAtMs": null },
    { "postingId": "mbp_1_…", "slot": 1, "kind": "visit", "target": "workshop", "holobotId": "", "districtId": "D08",
      "reward": { "holos": 75 }, "state": "claimed", "refillAtMs": 1794067900000, "claimedAtMs": 1794067300000, … },
    { … "kind": "capture", "target": "kuma_transit", "holobotId": "kuma", "districtId": "D07", "state": "complete", … }
  ],
  "refillAtMs": 1794067900000,                    // earliest pending refill, or null
  "hostFlags": { "new_posting": true, "posting_cleared": true },
  "balances": { "holosTokens": 1250, "blueprintFragments": 3 } }
```

- `state`: `open` (not done yet), `complete` (the server can already verify it, so a claim will pay), `claimed`
  (paid, waiting for its refill). A `visit` posting stays `open` until it is claimed, because only the client
  knows the pilot arrived.
- `target`: `zoneId` (beast), a rival target (below), a capture **spot id** (capture; `holobotId` names its Holobot,
  `""` on other kinds) or `destinationId` (visit).
- `reward.exp` is the per-Holobot amount at `rivalTier`, before the EXP Booster. `items` is left out when there are none.
- `hostFlags` (for the shared dialogue): `new_posting` is true when a posting went up after the previous `status`
  reply. `posting_cleared` is true when at least one posting is `complete` and unclaimed. Each `status` moves the
  "seen" mark to now.

### `claim`, board posting

```jsonc
{ "schemaVersion": "mission-board-1", "source": "posting", "postingId": "mbp_0_9f…", "requestId": "…", "kind": "beast",
  "alreadyProcessed": false,
  "granted": { "holos": 100, "expPerHolobot": 180, "expTier": 2, "items": [{ "itemId": "blueprint_fragment", "quantity": 1 }] },
  "progression": [ /* HolobotProgressionEntry per travel-squad Holobot (rival-battle-3 shape); [] for visits */ ],
  "balances": { "holosTokens": 1350, "blueprintFragments": 4 },
  "board": { "postings": [ … ], "refillAtMs": …, "hostFlags": { … } } }
```

### `claim`, intro step (forwarded)

```jsonc
{ "schemaVersion": "mission-board-1", "source": "intro", "postingId": "visit_workshop", "requestId": "…",
  "alreadyProcessed": false, "intro": { /* the introQuestHost intro-quest-1 claim reply, unchanged */ } }
```

## How completion is checked

Only records written **strictly after** the posting's `issuedAtMs` count, and only from server-only sources. The
client-writable `users/{uid}` is never read for completion.

| Kind | Target | Source | Rule |
|---|---|---|---|
| `beast` | `guild_court` | `holoZoneRuns/{uid}.runs[]` (the last 10 runs) | a settlement with `zoneId == target`, `didWin`, not `expWithheld` (a run under 20 s doesn't count), `settledAtMs > issuedAtMs` |
| `rival` | `town_rival` · a citizen `citizenId` · `any` | `rivalBattles/{uid}/battles/*` where `settlement.settledAtMs > issuedAtMs` (ordered, limit 100) | `settlement.didWin` and `lineup.opponentPilot.pilotId` matches: `town_rival` = `rival_tier_<n>` (the ladder / Kaz row), a citizen id = that id exactly, `any` = any pilot (including Zell) |
| `capture` | a spot id (`hare_harbor` … `gama_courtside`, or `kurai_garden`) | `wildEncounterSessions/{uid}/receipts/*` where `reply.captureResult.encounterId ==` each of the spot's encounter ids (the current cycle and the two before it; `city_kurai_garden` for the garden; limit 50 each) | `captureResult.captured` and the receipt's Firestore **createTime** `> issuedAtMs` (receipts have no timestamp field of their own) |
| `visit` | `mission_board` · `marketplace` · `workshop` · `harbor` · `portal_terminal` | the request | `destinationId == target` (low-stakes trust, like the intro visits) |

## Generating postings

A posting depends only on `sha256(["mission-board-1", uid, seed, serial])`, the kinds of the other open slots
and the target candidates. `seed` is random hex, stored when the board doc is first made. It is pinned outside
the transaction, so retries draw the same postings. `serial` counts up for each posting. There is no `Math.random`.

- **Kind:** chosen from the available kinds not held by another open slot. `capture` is available only when there
  is a capture target. beast, rival and visit always are, so the 3 open slots never repeat a kind.
- **beast:** `guild_court`, district **D04** (Guild + Dome): the plan site `sites.guildCourt` (22.5, -58.5) lies in
  D04's zone polygon. It's a city court, so no HoloZone story gate applies. Neon Forest is left out because it is
  gated by `holoZonesArcBuilt`.
- **rival:** `town_rival` (district D04, the Arena dome at (-22, -52.8)), `any` and the pilot's 8 Arena-gathering
  citizens from `gatheringRoster(uid)` (district D09, the Arena Gate kiosk at (-120, 70)); citizens only once
  `storyFlags.arenaGatheringSeen` is set.
- **capture:** the 11 repeatable spots, always (each spot is provisioned on demand, see below), plus `kurai_garden`
  (D06) until the Research Garden KURAI is linked (its `city_kurai_garden` encounter ended). A disabled session offers
  none.
- **visit:** the 5 landmarks above. `mission_board`, `marketplace`, `workshop` and `portal_terminal` use the intro
  quest ids. Holos: 50, 50, 75, 75 (harbor), 75. Districts, from the landmark building's position: Mission Board
  (-72, -88) D04, Market Row (112, -53) D05, Workshop Hall (-132, -1) D08, Ferry terminal (2, -153) D02, Portal
  Terminal (1, 118) D07.
- **Fragment:** byte 8 of the digest `% 3 == 0` adds 1 `blueprint_fragment` to a battle posting.
- **`postingId`:** `mbp_<serial>_<12 hex>`.

## Districts

`lib/cityDistricts.ts` copies the shared plan's ten districts (ids, centres, zone polygons; Unity metres) from the
Lite field's `cityPlan.generated.json` (HolobotsLiteMerge candidate 97637db) and its `cityDistrictAt` rule: the
first zone polygon containing the point, else the nearest district centre. Every board district id is computed
from a plan coordinate with it (tests pin the results). `shadow_plazaedge` (-57.1, 25) sits outside every zone and
takes the nearest centre, D08 Workshop.

| Spot | Holobot | Unity position (x, z) | District |
|---|---|---|---|
| `hare_harbor` | hare | (12, -150) | D02 Harbor |
| `tora_plaza` | tora | (0, 22) | D01 Tower Plaza |
| `era_market` | era | (91.3, -60) | D05 Market Row |
| `ken_gardens` | ken | (126, 80) | D06 Research Garden |
| `kuma_transit` | kuma | (6, 100) | D07 Portal Terminal |
| `kurai_missionboard` | kurai | (-61.8, -83.8) | D04 Guild + Dome |
| `shadow_plazaedge` | shadow | (-57.1, 25) | D08 Workshop (nearest) |
| `tsuin_arenagate` | tsuin | (-109.8, 74.2) | D09 Arena Gate |
| `wolf_workshop` | wolf | (-124, 0) | D08 Workshop |
| `wake_quay` | wake | (-12, -160) | D02 Harbor |
| `gama_courtside` | gama | (-72, -138) | D03 Court + Promenade |
| `kurai_garden` | kurai | (103, 66) (`sites.kuraiWild`) | D06 Research Garden |

## Repeatable wild spots (`cityEncounterHost`, `city-encounter-1`)

`{schemaVersion:'city-encounter-1', operation:'provisionSpot', spotId}` (exact keys; an unknown spot is
`invalid_request`) puts the spot's encounter into the caller's own `wildEncounterSessions/{uid}`, following the
KURAI `provision` pattern. Capture is the unchanged `wildEncounterHost` flow (offerToy / capture, requestId receipts,
Unit spend, ownership projection; a Holobot already owned pays blueprints).

- Encounter id `city_spot_<spotId>_<cycle>`; one encounter per spot is kept in the session.
- Open cycle: provisioning is a no-op (`provisioned:false`).
- Ended cycle (captured / linked): the spot comes back `CITY_SPOT_COOLDOWN_MS` = **30 min** after that capture's
  receipt (its create time). Before then the reply is `{provisioned:false, linked:true, readyAtMs}`; after it, the
  next call replaces the ended encounter with cycle + 1 (`provisioned:true`).
- Odds (server data): the KURAI item pair (Pilot Link signal + Buddy Unit), `chanceByAffinity [0, 0.35]`: Light 35 %
  → 70 % after the signal, Medium 65 % → 100 %, Heavy 100 %.
- Reply: `{schemaVersion, spotId, holobotId, encounterId, provisioned, linked, readyAtMs, wild}` (`wild` = the
  `wildEncounterHost` refresh).
- `{operation:'provision'}` (the Research Garden KURAI, `city_kurai_garden`) is unchanged and stays once-only.

## Idempotency

- Each `requestId` is paid at most once. A replay returns the stored `granted` / `progression` with
  `alreadyProcessed: true` and writes nothing. A `requestId` already used for a different posting gets `invalid_request`.
- Each posting is paid at most once. Claiming a claimed posting with a new `requestId` gets `already_claimed`
  (`details.refillAtMs`), and so does a ledger posting that has since been refilled away. The ledger keeps the last
  30 claims. Anything older is `unknown_posting`, and nothing is paid.

## Refusals

`HttpsError` with `details.rejectionCode`:

| rejectionCode | HttpsError code | When |
|---|---|---|
| `unauthenticated` | `unauthenticated` | no auth |
| `invalid_request` | `invalid-argument` | malformed request, wrong `schemaVersion`, `requestId` reused for another posting, intro step with a wrong destination |
| `unknown_posting` | `not-found` | `postingId` is not on the board or in the ledger |
| `already_claimed` | `already-exists` | posting (or intro step) already paid under another `requestId` |
| `not_complete` | `failed-precondition` | no qualifying record after `issuedAtMs` / wrong `destinationId` / intro step not met |
| `out_of_order` | `failed-precondition` | forwarded intro step that isn't the current step |
| `unavailable` | `unavailable` | no profile, or malformed stored state (board, intro, zone runs, travel squad, story flags, balances): fails closed |

`refill_pending` is reserved but not used today. A slot waiting for its refill answers `already_claimed` with
`details.refillAtMs`.

## Storage

`missionBoards/{uid}` is top-level and server-only (`firestore.rules`: `missionBoards/{uid}/{document=**}` denies
every client read and write). Shape:
`{schemaVersion, seed, nextSerial, slots[3]:{posting:{postingId, serial, kind, title, detail, target, holobotId, districtId, reward (no exp), issuedAtMs, claim|null}, refillAtMs|null}, claims[≤30]:{requestId, postingId, kind, claimedAtMs, granted{holos, expPerHolobot, expTier, items}, progression}, seenThroughMs}`.
A missing doc means a new board (made on the first status, intro chain or not). A malformed doc is `unavailable` and is
never reset. Grants go to `users/{uid}` (`holosTokens`, `holobots`, `itemStocks.blueprint_fragment`) in the same
transaction as the board write.

Deploy (when Pak says so): `firebase deploy --project holobots-24046 --only functions:missionBoardHost,functions:cityEncounterHost`
plus the rules (`firestore:rules`). The rival query uses the automatic single-field index on `settlement.settledAtMs`. The
capture queries are one equality filter each. No composite index is needed.
