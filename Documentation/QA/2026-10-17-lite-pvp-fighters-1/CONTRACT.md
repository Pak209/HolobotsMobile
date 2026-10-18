# PvP room fighter snapshots — `pvp-room-fighters-1`

Host half of lane `lite-pvp-fighters-1`. Base: main 3b1e790 (#129). Additive Contract-Change. **No deploy.** The producer owns deploy and Pak merges. **No `firestore.rules` change:** the producer's `host-economy-hardening-1` lane owns that file. **Scope:** this closes the *room-level forgery* behind the LIVE PVP cell held by lite-arena-levels-1 (#119/#121): no client can forge the stored seat. It **leaves S4 open**: ownership and level still come from the owner-writable profile. So the LIVE PVP cell is not fully closed until S4 is (see "Trust boundary" and "Gate").

## Problem

PvP is fully client-authored. Each client builds its own fighter doc from its local profile (`mobile/src/hooks/useRealtimeArena.ts` buildOwnFighter → `mobile/src/features/arena/pvpBattle.ts` buildPvpFighterDoc). It writes that doc, including `level`, into `battle_rooms/{roomId}.players.pX`, either directly (createRoom / joinRoom) or through the matchmaking claim (`mobile/src/lib/pvpMatchmaking.ts`). Before this change, no functions/ code touched PvP, so every PvP level shown was client-decided.

## Choice: one callable, a server-only seats doc, and snapshots in the reply

- New authenticated callable **`pvpRoomFighterHost`** (`functions/src/pvp/`), with two operations:
  - `seat` mints the caller's snapshot into **`pvpRoomSeats/{roomId}`** inside one Admin SDK transaction.
  - `read` returns the room's current seats.
- `pvpRoomSeats` has **no match block** in `firestore.rules`. The existing final default deny (`match /{document=**} { allow read, write: if false; }`) refuses every client read and write, and only the Admin SDK can touch it. No rule is added or changed.
- Clients get **both** seats' snapshots from the callable **reply**. They never read the collection.
- The host reads `battle_rooms/{roomId}` with the Admin SDK only to check that the caller is seated, and **never writes it**.

Rejected alternatives:

- **A host-only field on `battle_rooms`** (an earlier draft of this lane). It needs a rules change to stop clients forging it, and the rules file is owned elsewhere tonight. Withdrawn before merge.
- **Host-created rooms.** This would move room creation and matchmaking server-side, which is much larger.
- **Snapshots on `battle_pool_entries`.** These are client-written and claimable by any searcher.

## Requests

The whole body, one of exactly two shapes:

```json
{"operation":"seat","roomId":"<20-char Firestore auto-ID>","holobotId":"ace"}
{"operation":"read","roomId":"<20-char Firestore auto-ID>"}
```

The uid comes **only** from `request.auth`. Anything else is refused as `invalid_request`: `level`, `tier`, `uid`, `role`, `schemaVersion`, a `holobotId` on `read`, a missing or unknown `operation`, or a malformed id. Schema: `Schemas/pvp-room-fighters-1.json#/definitions/request`.

## `seat` ruling (in order, one transaction over room + profile + seats doc)

1. The room exists (else `unknown_room`). Its `status` is `waiting` or `active` (else `room_closed`).
2. The caller is seated: `players.p1.uid` or `players.p2.uid` equals the auth uid. A stranger, or one account in both seats, gets `not_participant`. A joiner must fill p2 first (joinRoom's existing client write), then call.
3. `holobotId` is a bot this seat put in the room. That means `toHolobotKey(players[role].holobotName)`, or, in `3v3`, one of `teams[role].members[].holobotName` (at most 3; a longer lineup is `room_invalid`). Otherwise `not_seated`.
4. **Stored by minting uid, shown for current seats only.** Snapshots are keyed by the uid that minted them (`byUid`), never by role. A reply projects `p1`/`p2` from the uids now in the room seats. An entry minted by anyone else is kept but never shown: an earlier occupant of a reused room id, or a uid a participant briefly wrote into a seat.
5. **Frozen at first mint, per (room, uid, bot).** If the caller already holds that bot, the call replays it with `alreadyProcessed: true`, whatever seat the caller now sits in. A later level-up, or a seat swap on the client-authored room doc, does not rewrite this room's badge.
6. **Owned bot only.** The caller's `users/{uid}.holobots` must hold exactly one record keyed `holobotId`, and the bot must be in the catalog (`HOLOBOT_BASE_STATS`). Zero records or a non-catalog bot gets `not_owned`; duplicates get `profile_invalid`. The stored level must be an integer of at least 1. A missing level is 1, as in arenaMatchStore uniqueEntrant. `null`, strings and fractions are `profile_invalid`. **"Owned" here means "present in the owner-writable profile" (S4):** an owner who writes a bot such as WOLF LV 99 into their own `holobots` gets it minted. A unit test pins this open behaviour.
7. The level comes from the **same owned-bot path as Arena issue**: `buildPlayerCombatants(profile, [holobotId])` → `arenaFighterSnapshot(combatant, PVP_ROOM_TIER)` (#118, unchanged). A level above 99 is refused (`profile_invalid`), never clamped.
8. `tx.set(pvpRoomSeats/{roomId}, {schemaVersion, roomId, byUid: {[uid]: {fighters: {[holobotId]: snapshot}}}}, {merge: true})`. The write is only the caller's own entry, so no mint can remove or replace another uid's snapshot. No refusal writes anything.

## `read` ruling

The caller must be a participant (else `not_participant`; an unknown room is `unknown_room`). Any room status is allowed, so a result screen can still badge. The reply projects the current seats only, as in seat step 4. A corrupt stored doc fails closed with `seats_invalid`.

## Stored doc (server-only)

```json
pvpRoomSeats/{roomId} = {
  "schemaVersion": "pvp-room-fighters-1", "roomId": "<roomId>",
  "byUid": {
    "<p1 uid>": { "fighters": { "ace":  {"holobotId":"ace","level":21,"displayName":"ACE","tier":0} } },
    "<p2 uid>": { "fighters": { "kuma": {"holobotId":"kuma","level":12,"displayName":"KUMA","tier":0} } }
  }
}
```

Each fighter is **exactly** #118's `ArenaFighterSnapshot = {holobotId, level, displayName, tier}`. The uid is the map key, not part of the snapshot, and replies carry it as `seats[role].uid`. Schema: `#/definitions/seatsDoc`. Orphaned docs (a room deleted after a mint) are inert: no client can read them, and a reused id shows only its new occupants' entries. TTL cleanup is a later, optional ops task.

## Replies

```json
{"schemaVersion":"pvp-room-fighters-1","operation":"seat","roomId":"…","role":"p1","alreadyProcessed":false,
 "fighter":{"holobotId":"ace","level":21,"displayName":"ACE","tier":0},
 "seats":{"p1":{"uid":"…","fighters":{"ace":{…}}}}}
{"schemaVersion":"pvp-room-fighters-1","operation":"read","roomId":"…","role":"p2",
 "seats":{"p1":{…},"p2":{…}}}
```

The client badges a seat only when the reply's `seats[role].uid` matches the uid now in that room seat, **and** the displayed bot has a snapshot. The opponent's snapshot arrives through a later `read` once they have seated.

## What `tier` means for PvP — Pak call

`tier` is the host constant **`PVP_ROOM_TIER = 0`**, meaning "unranked PvP room". It is never client-supplied. PvP has no host-owned ladder, no stakes and no admission, and the #118 meaning (the zero-based Arena tier index of an admitted match) has no PvP counterpart.

**Collision:** in #118, `tier: 0` is a real value (the Arena rookie index). The schema therefore pins the PvP value: `definitions.pvpFighter` is the #118 `fighter` shape with `tier: {const: 0}`. Consumers must read `tier` together with `schemaVersion` and never as an Arena tier.

**Pak call:** confirm that 0 means unranked, or name a host-owned PvP tier source under a new schema version.

## Refusals

| code | callable status | when |
|---|---|---|
| `unauthenticated` | unauthenticated | no `request.auth` |
| `invalid_request` | invalid-argument | body is not one of the two exact shapes |
| `unknown_room` | not-found | no such room |
| `not_participant` | permission-denied | the caller is in neither seat, or in both |
| `room_closed` | failed-precondition | `seat` on a `completed` / `abandoned` / other room |
| `not_seated` | failed-precondition | that bot is not the seat's fighter or 3v3 lineup member |
| `not_owned` | failed-precondition | the caller owns no such catalog bot |
| `profile_invalid` | failed-precondition | no profile, duplicate records, stored level not an integer 1–99 (never clamped) |
| `room_invalid` | failed-precondition | malformed room doc, or a 3v3 lineup longer than 3 |
| `seats_invalid` | data-loss | the host-written seats doc is corrupt |

Each refusal error carries `details.rejectionCode`. Every refusal is **permanent** for the same inputs. None uses the transient `unavailable` status, so no client is told to retry a data error.

## Trust boundary — stated plainly

- **Clients cannot forge the stored seat itself.** Each snapshot is minted by the host and stored where no client can read or write it. It reaches clients only through the host's reply. Neither seat can write a level into, edit or erase a stored seat, and the room doc's client-authored `players.*.level` is never a badge source. A new rules-tests file proves the server-only path is closed under the **existing, unchanged** rules. That is the whole claim; it is not a claim that the level is authoritative (next bullets).
- **Seat-swap tampering is contained.** Because the room doc is client-authored, a participant can briefly rewrite seat uids or names on it. That can change which uid a seat displays, but it cannot move, erase or unfreeze any stored snapshot (uid-keyed, merge-only writes; emulator and unit tests cover both attacks).
- **What stays client-authored, out of scope.** The `battle_rooms` doc itself: seats, `players.*` combat docs (level, stats, moves), turns and results remain client-written and client-resolved (SECURITY_AUDIT.md C4 / S7). The known-bad cell in the rules tests shows that a participant can still forge a level on the room doc. This lane neither fixes nor depends on that. PvP still has no host settlement or rewards.
- **Both ownership AND level come from the owner-writable profile until S4 is closed.** The snapshot is built from `users/{uid}.holobots`. Under today's rules, `holobots` (including `level`, `experience`, `boostedAttributes`) and `inventory` are client-writable on purpose (firestore.rules economy-freeze comment, ~:86–91; neither is in `protectedFieldsUntouched`, ~:101–112). A determined owner can **add** a bot (the coordinator's reviewer reproduced WOLF LV 99) or **raise** a stored level, and the host will mint either one. So a stored seat faithfully records the profile at mint time and nothing more. The same gap already affects the #118 Arena snapshots and the desktop-account-3 level badges.
- **Follow-up (not this lane):** protect `holobots` in `protectedFieldsUntouched` and move the client-side attribute-point spends to a callable. Protecting `holobots` today would break the web app's client-side attribute spends, and Pak has an open policy decision on that migration. The producer's `host-economy-hardening-1` lane is doing the census and phased plan; no rules change yet.

## Gate (deploy and City-labelled badges)

**Deploy, and any badge that presents this level as City-verified, are gated on one of:**

- host-economy-hardening-1 protecting `holobots` (closing S4); or
- the reply provenance being marked owner-profile / unverified until then.

The deploy decision is the producer's. The lite client (#137) already shows a neutral "LV n" with no City-authority claim, and it shows nothing when no snapshot exists.

## Deploy (HELD — producer)

Function only; there are no rules to deploy for this contract. The lite client works when the callable is missing: no badge is shown, and rooms play as before.

## Data lifecycle

- `pvpRoomSeats/{roomId}` docs outlive their room: a participant may delete `battle_rooms/{roomId}`, but nothing deletes the seats doc. Orphans are inert (no client access; a reused id shows only its new occupants' entries). **Follow-up:** a scheduled sweep or Firestore TTL policy, e.g. a `mintedAtMs` field plus TTL.
- **Account deletion:** `deleteUserData` (functions/src/account/deleteUserAccount.ts) purges per-uid trees, but a deleted uid survives as a `byUid` map key inside `pvpRoomSeats` docs, holding only bot ids, levels and tier 0. **Follow-up:** purge `byUid.{uid}` in `deleteUserData` (query `where(new FieldPath('byUid', uid, 'fighters'), '!=', null)`), or rely on the TTL above. Not done here, because open #143 (host-economy-hardening-1) edits `deleteUserAccount.ts`.

## Merge note

#136 conflicts with #134 in `functions/package.json`: both add to the `test` list and the scripts map. Resolve by keeping both. Whoever merges second must confirm that both `scripts/test-pvp-room-fighters.mjs` and #134's test file are in `test`. #143 also edits `functions/package.json`.

## Files

- `functions/src/pvp/pvpRoomFighters.ts`: request guard, pure `mintPvpRoomFighter` / `readPvpRoomFighters`, seats reader, `transactPvpRoomFighter`.
- `functions/src/pvp/pvpRoomFighterHost.ts`: `onCall` wrapper. Exported from `functions/src/index.ts`.
- `Schemas/pvp-room-fighters-1.json`: both replies, plus `definitions.request` / `fighter` / `seat` / `seats` / `seatsDoc`.
- `functions/scripts/fixtures/pvp-room/room-fighters-1.json`: recorded from the loopback demo emulator run (provenance inside).
- `functions/scripts/test-pvp-room-fighters.mjs`: unit test, wired into `npm test`.
- `functions/scripts/test-pvp-room-fighters-emulator.mjs`: transaction test (`npm run test:pvp-room-fighters:emulator`).
- `rules-tests/tests/pvp-room-seats.test.ts`: **new, test-only**. No existing rules or rules-tests file is modified.

## Evidence (cold checks, this branch)

These ran in a scratch worktree with node_modules symlinked: no installs, no network, no real account, and no `git fetch` into `origin/*`. Branch tips were checked against `gh api`. The locally available functions `node_modules` predates main's `ajv` devDependency, so `NODE_PATH` pointed at the cached rules-tests `node_modules` for `ajv`. CI's `npm ci` installs it.

- `git diff 3b1e790 -- firestore.rules rules-tests/tests/battle-collections.test.ts rules-tests/src` is **empty**: no rules or existing rules-test change.
- `npm run build`: green. `npm run check:shared`: 3 shared files in sync.
- `npm test`: **322 tests, 321 passed, 0 failed, 1 skipped**. Base main 3b1e790 gives 312 / 311 / 0 / 1; this branch adds 10 tests in `test-pvp-room-fighters.mjs`:
  - fixture premise;
  - fixture replay with caller-only writes;
  - **S4 open**: an owner-added WOLF LV 99 is minted;
  - frozen replay;
  - stale-entry hiding;
  - seat-swap tampering;
  - 26-case seat refusal table, with permanent codes only;
  - read refusals;
  - request guard;
  - schema, including the tier pin.
- Emulator, functions: `test-pvp-room-fighters-emulator.mjs` **6/6**. It covers the premise; create → seat → join → seat → read with the room doc unchanged by the host; refusals with no writes; 3v3; reused room id; and seat-swap tampering. Its recorded output is identical to the committed fixture apart from the auto room id. Setup: cached Firestore v1.19.8 (no download), project `demo-holobots-pvp-fighters`, 127.0.0.1:8293 scratch config, fixed disposable demo uids deleted after the run.
- Emulator, rules: the full rules-tests suite gives **19 files, 107/107** against the existing rules. The new `pvp-room-seats.test.ts` has 3 tests:
  - the known-bad room-doc forge succeeds (a real check: it fails if `battle_rooms` were ever locked down);
  - every client write to `pvpRoomSeats` is denied;
  - every client read and list is denied.
- Adversarial self-reviews (read-only, no ref writes):
  - Round 1 (4 critics plus 6 skeptics): stale README and the per-switch read budget, both fixed. Seat erasure through room-doc tampering was hardened with uid-keyed, merge-only writes.
  - Round 2 (coordinator): wording. Both ownership and level are owner-writable (S4), "unforgeable" now refers only to the stored seat, and the LIVE PvP cell is not claimed closed. Also: the gate, tier pin, permanent refusal codes, lifecycle note and premise renames.
- Not run: deploy (HELD, producer, gated above) and a live two-account witness (HELD, needs the deploy and two real accounts).
