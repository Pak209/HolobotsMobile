# `missionBoardHost` — HoloCity Mission Board (`mission-board-1`)

One callable serves the Mission Board's postings to both clients, the Unity desktop app and the Lite mobile app.
The server owns the postings, the refill clock, completion checks and rewards. Clients show the replies and say
which landmark the pilot arrived at. Nothing else comes from the client.

Code: `lib/missionBoard.ts` (pure rules and tables), `missionBoard/missionBoardStore.ts` (transaction, fact reads),
`missionBoard/missionBoardHost.ts` (callable). Tests: `scripts/test-mission-board.mjs`,
`scripts/test-mission-board-store.mjs`. Fixture: `docs/contracts/mission-board-1.json`.

## Rulings (Pak, 2026-11-07)

| Ruling | Implementation |
|---|---|
| Four posting kinds | `beast` (defeat an Error Beast at a city spot), `rival` (beat a rival pilot), `capture` (link a wild Holobot), `visit` (go to a district landmark) |
| Refill on clear | 3 slots per pilot, always filled. A claimed slot keeps its posting (`state:'claimed'`, `refillAtMs`) until `MISSION_BOARD_REFILL_MS` = 10 min after the claim. The next `status` / `claim` after that time puts up a new posting. |
| Rewards match existing payouts | beast / rival / capture: `BATTLE_WIN_HOLOS` = **100 Holos** plus the battle table's win EXP (tier 0, no performance bonus = **95**, EXP Booster doubles it) for **every travel-squad Holobot**. About 1 in 3 also pays **1 `blueprint_fragment`** (shown in `reward.items` before the claim). Visits pay the intro visit amounts, **50 / 75 Holos**, with no EXP. Grants reuse `holosAfterGrant`, `awardBattleExperienceRaw` and `itemStocksAfterFragmentGrant` (the zone clear grant). |
| Intro quests come first | While `introQuests/{uid}` is incomplete, `status` returns the intro chain (`intro`, the `introQuestHost` status shape) and **no postings**. Posting claims are refused with `intro_pending`. A `claim` whose `postingId` is an intro `stepId` is passed to the intro quest store unchanged, so its order, verification and rewards still apply. The board never copies intro state. |

## Request

```jsonc
{ "operation": "status", "schemaVersion": "mission-board-1" }          // schemaVersion optional; any other value → invalid_request
{ "operation": "claim", "postingId": "mbp_4_a1b2c3d4e5f6", "requestId": "<[A-Za-z0-9_-]{1,128}>", "destinationId": "workshop" }
```

`destinationId` is only needed for a `visit` posting, or for an intro visit step forwarded to the intro store. Replaying a
`requestId` returns the first ruling and doesn't need `destinationId`.

## Replies

### `status`, intro chain incomplete

```jsonc
{ "schemaVersion": "mission-board-1", "introPending": true,
  "intro": { "currentStepId": "visit_workshop", "complete": false, "steps": [ /* introQuestHost IntroStepView[] */ ], "totalReward": { … } },
  "postings": [], "refillAtMs": null, "hostFlags": { "new_posting": false, "posting_cleared": false },
  "balances": { "holosTokens": 100, "blueprintFragments": 0 } }
```

### `status`, board active

```jsonc
{ "schemaVersion": "mission-board-1", "introPending": false, "intro": null,
  "postings": [                                   // always 3, slot order
    { "postingId": "mbp_0_9f…", "slot": 0, "kind": "beast", "title": "Guild Court sweep",
      "detail": "Defeat an Error Beast at the Guild Court.", "target": "guild_court", "districtId": "arena",
      "reward": { "holos": 100, "exp": 95, "items": [{ "itemId": "blueprint_fragment", "quantity": 1 }] },
      "issuedAtMs": 1794067200000, "state": "open", "refillAtMs": null, "claimedAtMs": null },
    { "postingId": "mbp_1_…", "slot": 1, "kind": "visit", "target": "workshop", "districtId": "workshop",
      "reward": { "holos": 75 }, "state": "claimed", "refillAtMs": 1794067900000, "claimedAtMs": 1794067300000, … },
    { … "kind": "rival", "target": "town_rival", "state": "complete", … }
  ],
  "refillAtMs": 1794067900000,                    // earliest pending refill, or null
  "hostFlags": { "new_posting": true, "posting_cleared": true },
  "balances": { "holosTokens": 1250, "blueprintFragments": 3 } }
```

- `state`: `open` (not done yet), `complete` (the server can already verify it, so a claim will pay), `claimed`
  (paid, waiting for its refill). A `visit` posting stays `open` until it is claimed, because only the client
  knows the pilot arrived.
- `target`: `zoneId` (beast), a rival target (below), `holobotId` (capture) or `destinationId` (visit).
- `reward.exp` is the per-Holobot amount before the EXP Booster. `items` is left out when there are none.
- `hostFlags` (for the shared dialogue): `new_posting` is true when a posting went up after the previous `status`
  reply. `posting_cleared` is true when at least one posting is `complete` and unclaimed. Each `status` moves the
  "seen" mark to now.

### `claim`, board posting

```jsonc
{ "schemaVersion": "mission-board-1", "source": "posting", "postingId": "mbp_0_9f…", "requestId": "…", "kind": "beast",
  "alreadyProcessed": false,
  "granted": { "holos": 100, "expPerHolobot": 95, "items": [{ "itemId": "blueprint_fragment", "quantity": 1 }] },
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
| `capture` | `holobotId` (`kurai`, or an open encounter's bot) | `wildEncounterSessions/{uid}/receipts/*` where `reply.captureResult.captured == true` (limit 100) | `captureResult.holobotId == target` and the receipt's Firestore **createTime** `> issuedAtMs` (receipts have no timestamp field of their own) |
| `visit` | `mission_board` · `marketplace` · `workshop` · `harbor` · `portal_terminal` | the request | `destinationId == target` (low-stakes trust, like the intro visits) |

## Generating postings

A posting depends only on `sha256(["mission-board-1", uid, seed, serial])`, the kinds of the other open slots
and the target candidates. `seed` is random hex, stored when the board doc is first made. It is pinned outside
the transaction, so retries draw the same postings. `serial` counts up for each posting. There is no `Math.random`.

- **Kind:** chosen from the available kinds not held by another open slot. `capture` is available only when there
  is a capture target. beast, rival and visit always are, so the 3 open slots never repeat a kind.
- **beast:** `guild_court` (district `arena`). It's a city court, so no HoloZone story gate applies. Neon Forest
  is left out because it is gated by `holoZonesArcBuilt`.
- **rival:** `town_rival` (district `arena`), `any` (district `port`), and the pilot's 8 Arena-gathering citizens
  from `gatheringRoster(uid)` (district `port`), but only once `storyFlags.arenaGatheringSeen` is set.
- **capture:** open, capture-open encounters in the pilot's enabled wild session, plus KURAI (district `zone`,
  Research Garden) until its `city_kurai_garden` encounter exists. Once KURAI is linked (encounter ended) it is no
  longer offered. A disabled session offers nothing.
- **visit:** the 5 landmarks above. `mission_board`, `marketplace`, `workshop` and `portal_terminal` use the intro
  quest ids. Holos: 50, 50, 75, 75 (harbor), 75. Districts: harbor, vendor, workshop, harbor, port.
- **Fragment:** byte 8 of the digest `% 3 == 0` adds 1 `blueprint_fragment` to a battle posting.
- **`postingId`:** `mbp_<serial>_<12 hex>`.

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
| `intro_pending` | `failed-precondition` | posting claim while the intro chain is incomplete |
| `out_of_order` | `failed-precondition` | forwarded intro step that isn't the current step |
| `unavailable` | `unavailable` | no profile, or malformed stored state (board, intro, zone runs, travel squad, story flags, balances): fails closed |

`refill_pending` is reserved but not used today. A slot waiting for its refill answers `already_claimed` with
`details.refillAtMs`.

## Storage

`missionBoards/{uid}` is top-level and server-only (`firestore.rules`: `missionBoards/{uid}/{document=**}` denies
every client read and write). Shape:
`{schemaVersion, seed, nextSerial, slots[3]:{posting:{postingId, serial, kind, title, detail, target, districtId, reward, issuedAtMs, claim|null}, refillAtMs|null}, claims[≤30]:{requestId, postingId, kind, claimedAtMs, granted, progression}, seenThroughMs}`.
A missing doc means a new board, but only once the intro chain is done. A malformed doc is `unavailable` and is
never reset. Grants go to `users/{uid}` (`holosTokens`, `holobots`, `itemStocks.blueprint_fragment`) in the same
transaction as the board write.

Deploy (when Pak says so): `firebase deploy --project holobots-24046 --only functions:missionBoardHost` plus the rules
(`firestore:rules`). The rival query uses the automatic single-field index on `settlement.settledAtMs`. The capture
query is one equality filter. No composite index is needed.
