# PvP room fighter snapshots — `pvp-room-fighters-1`

Host half of lane `lite-pvp-fighters-1`. Base: main 3b1e790 (#129). Additive Contract-Change. **No deploy.** The producer owns deploy and Pak merges. This closes the LIVE PVP cell held by lite-arena-levels-1 (#119/#121): "pending an authoritative opponent snapshot contract".

## Problem

PvP is fully client-authored. Each client builds its own fighter doc from its local profile (`mobile/src/hooks/useRealtimeArena.ts` buildOwnFighter → `mobile/src/features/arena/pvpBattle.ts` buildPvpFighterDoc). It writes that doc, including `level`, into `battle_rooms/{roomId}.players.pX`, either directly (createRoom / joinRoom) or through the matchmaking claim (`mobile/src/lib/pvpMatchmaking.ts`). Before this change, no functions/ code touched PvP. So any level shown on a PvP card was a client-decided level.

## Choice: one callable plus one host-only room field

- New authenticated callable **`pvpRoomFighterHost`** (`functions/src/pvp/`).
- It mints the caller's snapshot into **`battle_rooms/{roomId}.hostFighters`** through the Admin SDK, inside one transaction.
- `firestore.rules` denies every client attempt to create, add, modify, replace or delete `hostFighters`.

Rejected alternatives:

- **Host-created rooms.** This would move room creation and matchmaking pairing server-side, which is a much larger change.
- **A separate host-only collection** (`pvpRoomFighters/{roomId}`). Each client would need a second listener and new read rules. The room field rides the `onSnapshot` that both clients already hold, so the opponent's badge arrives with no extra plumbing.
- **Snapshots on `battle_pool_entries`.** Pool entries are client-written, and any searcher can claim them. They are not a host-owned surface.

`battle_pool_entries` and its rules are unchanged.

## Request

The whole body, nothing else:

```json
{"roomId":"<20-char Firestore auto-ID>","holobotId":"ace"}
```

The uid comes **only** from `request.auth`. Any other key is refused as `invalid_request`: `level`, `tier`, `uid`, `role`, even `schemaVersion`. So is a malformed id. Schema: `Schemas/pvp-room-fighters-1.json#/definitions/request`.

## Ruling (in order, one transaction)

1. The room exists (else `unknown_room`). Its `status` is `waiting` or `active` (else `room_closed`).
2. The caller is seated: `players.p1.uid` or `players.p2.uid` equals the auth uid. A stranger, or one account in both seats, gets `not_participant`. A joiner must fill p2 first (joinRoom's existing client write), then call.
3. `holobotId` is a bot this seat put in the room. That means `toHolobotKey(players[role].holobotName)`, or, in a `3v3` room, one of `teams[role].members[].holobotName` (at most 3; a longer lineup is `unavailable`). Otherwise `not_seated`. This binds the badge to the fighter actually shown.
4. **Frozen at first mint.** If this seat already holds a snapshot for that bot, the reply replays it with `alreadyProcessed: true`. A later level-up does not rewrite a room's badge, the same as an Arena admission.
5. **Owned bot only.** The caller's `users/{uid}.holobots` must hold exactly one record whose key is `holobotId`, and the bot must be in the catalog (`HOLOBOT_BASE_STATS`). Zero records or a non-catalog bot gets `not_owned`; duplicate records get `unavailable`. The stored level must be an integer of at least 1. A missing level is 1, as in arenaMatchStore uniqueEntrant. `null`, strings and fractions are `unavailable`.
6. The level comes from the **same owned-bot path as Arena issue**: `buildPlayerCombatants(profile, [holobotId])` (rivalLadder.ts) → `arenaFighterSnapshot(combatant, PVP_ROOM_TIER)` (#118, unchanged). A level above 99 throws there, and the ruling is `unavailable`: refused, never clamped.
7. Write `hostFighters.schemaVersion`, `hostFighters.{role}.uid` and `hostFighters.{role}.fighters.{holobotId}`. Nothing in `players.*`, `teams.*` or any other field is read back or rewritten. No refusal writes anything.

## Stored field

```json
"hostFighters": {
  "schemaVersion": "pvp-room-fighters-1",
  "p1": { "uid": "<p1 uid>", "fighters": { "ace":  {"holobotId":"ace","level":21,"displayName":"ACE","tier":0} } },
  "p2": { "uid": "<p2 uid>", "fighters": { "kuma": {"holobotId":"kuma","level":12,"displayName":"KUMA","tier":0} } }
}
```

Each fighter is **exactly** #118's `ArenaFighterSnapshot = {holobotId, level, displayName, tier}`. The seat's `uid` sits beside the map, not inside the snapshot, so a reader can check that the snapshot belongs to the uid now in that seat. The host fails closed (`unavailable`) on a malformed stored field. Schema: `#/definitions/roomHostFighters`.

## Reply

```json
{"schemaVersion":"pvp-room-fighters-1","roomId":"…","role":"p1","alreadyProcessed":false,
 "fighter":{"holobotId":"ace","level":21,"displayName":"ACE","tier":0}}
```

Clients should badge from the **room field**, because it is the only way to see the opponent's snapshot. The reply is a convenience for the caller's own seat.

## What `tier` means for PvP — Pak call

`tier` is the host constant **`PVP_ROOM_TIER = 0`**, meaning "unranked PvP room". It is never client-supplied. PvP has no host-owned ladder, no stakes and no admission. The #118 meaning (the zero-based Arena tier index of an admitted match) has no PvP counterpart, so no sensible host-owned non-zero value exists today.

**Pak call:** confirm that 0 means unranked, or name a host-owned PvP tier source (for example a future ranked-PvP ladder or pilot rank). A non-zero meaning should ship under a new schema version, so that today's `0` keeps a single meaning.

## Refusals

| code | callable status | when |
|---|---|---|
| `unauthenticated` | unauthenticated | no `request.auth` |
| `invalid_request` | invalid-argument | body is anything but `{roomId, holobotId}` with valid ids |
| `unknown_room` | not-found | no such room |
| `not_participant` | permission-denied | the caller is in neither seat, or in both |
| `room_closed` | failed-precondition | status is `completed` / `abandoned` / anything else |
| `not_seated` | failed-precondition | that bot is not the seat's fighter or 3v3 lineup member |
| `not_owned` | failed-precondition | the caller owns no such catalog bot |
| `unavailable` | unavailable | corrupt profile record, level outside 1–99, corrupt stored `hostFighters` |

Each refusal error carries `details.rejectionCode`.

## Rules (`firestore.rules`, battle_rooms)

- `create` additionally requires `!('hostFighters' in request.resource.data)`.
- `update` (participant or open-slot joiner) additionally requires that `diff().affectedKeys()` does not contain `hostFighters`. This covers adds, nested edits, `deleteField()` and whole-document replacements that drop the field.
- Read and delete are unchanged. Ordinary play updates (heartbeat, stamina, moves, join) are unaffected because they never touch the field.

## Trust boundary: what this does NOT do

- **Presentation only.** `players.*` combat docs, including their `level`, stats and moves, remain client-authored and client-resolved (SECURITY_AUDIT.md C4). PvP still has no host settlement or rewards. The badge level no longer comes from that doc, but combat still uses it.
- **The level source is the stored account record.** `users/{uid}.holobots` is still owner-writable on purpose (firestore.rules economy-freeze comment: attribute-point spends). That is the same record Arena #118 admission reads. This lane closes **room** authorship and local-profile leakage: neither seat can write a level into the badge field, and a stale or local profile value never reaches it. It does **not** stop a determined owner from editing their own stored level. Freezing `holobots[].level` is a separate decision (Pak call).
- **Old clients.** Old clients never write `hostFighters`, so they are unaffected. A client that replaced a whole room doc after a mint would now be denied. No current mobile client does that, since every post-create room write is a field update. The holobots-fun web client was not re-audited here.

## Deploy order (HELD — producer)

Deploy the rules **with or before** the function. If the function went live without the rules, its writes would work, but a client could also forge the field. The lite client works when the callable is missing: badges stay pending/absent and the room plays.

## Files

- `functions/src/pvp/pvpRoomFighters.ts`: request guard, pure `mintPvpRoomFighter` ruling, seat reader, `transactPvpRoomFighter`.
- `functions/src/pvp/pvpRoomFighterHost.ts`: `onCall` wrapper. Exported from `functions/src/index.ts`.
- `Schemas/pvp-room-fighters-1.json`: reply, plus `definitions.request` / `fighter` / `seat` / `roomHostFighters`.
- `functions/scripts/fixtures/pvp-room/room-fighters-1.json`: recorded from the loopback demo emulator run (provenance inside).
- `functions/scripts/test-pvp-room-fighters.mjs`: unit test, wired into `npm test`.
- `functions/scripts/test-pvp-room-fighters-emulator.mjs`: transaction test (`npm run test:pvp-room-fighters:emulator`).
- `rules-tests/tests/battle-collections.test.ts`: the `battle_rooms hostFighters (host-only)` block.

## Evidence (cold checks, this branch)

These ran in a scratch worktree with node_modules symlinked: no installs, no network, no real account. The functions `node_modules` available locally predates main's `ajv` devDependency, so `NODE_PATH` pointed at the cached rules-tests `node_modules` for `ajv`. CI's `npm ci` installs it normally.

- `npm run build`: green. `npm run check:shared`: 3 shared files in sync.
- `npm test`: **318 tests, 317 passed, 0 failed, 1 skipped**. The base main 3b1e790 gives 312 / 311 / 0 / 1; this branch adds 6 tests in `test-pvp-room-fighters.mjs`. The known-bad control runs first: the client-authored room holds local levels 99 / 50 against host levels ACE 21 / KUMA 12, with no host field.
- Emulator, functions: `test-pvp-room-fighters-emulator.mjs` **4/4 passed**, about 9 s including emulator startup. It ran twice: the first run recorded the fixture, and the final run used the final code. The final run's recorded output is identical to the committed fixture except for the auto room ID. Setup: cached Firestore emulator v1.19.8 (no download), project `demo-holobots-pvp-fighters`, 127.0.0.1:8293 scratch config, fixed disposable demo uids, rooms and users deleted after the run.
- Emulator, rules: the full rules-tests suite gives **18 files, 109/109 passed** (battle-collections has 25, 5 of them new). **Known-bad control:** the same battle-collections file against main's unchanged `firestore.rules` gives **4 failed / 21 passed**. The 4 failures are exactly the new forge cases: create-with-field, add, modify/replace/delete, joiner forge. So the old rules let a client forge `hostFighters`. Run on project `demo-holobots-rules-pvp`, same scratch config.
- Not run: deploy (HELD, producer) and a live two-account witness (HELD, needs deploy and two real accounts).
