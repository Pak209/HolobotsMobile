# Cloud review: Buddy Units, rival battles, starter grant (DECISIONS #43)

2026-10-01. Read-only review of the server code shipped in `11c9dd5` and `a9db419` (branch base `main` @ `a9db419`), plus the TTL change on this branch.

**Status (Pak, 2026-10-01): findings 1, 2 and 3 are fixed on this branch (PR #54); 4–8 are open.**
- #1: `allow delete: if false` on `users/{uid}`, plus rules tests.
- #2: `deleteUserData()` in `deleteUserAccount.ts`, plus an emulator test.
- #3: at most 3 open battles (`too_many_open`) and a 20 s minimum before a win can settle (`too_fast`), plus unit and emulator tests. Rate limiting and App Check from #3 are not done.

The finding text below is the original review.

Line numbers refer to this branch (`claude/rival-ttl-review-wskokm`). `rivalLadder.ts` is 15 lines longer than on `main` because of the TTL constants.

**Scope:** `functions/src/rival/`, `functions/src/lib/rivalLadder.ts`, `functions/src/acquisition/wildEncounterDomain.ts` / `wildEncounterStore.ts` / `wildEncounterHost.ts` / `captureOwnership.ts`, `functions/src/desktop/desktopAccountSnapshot.ts`, `functions/src/account/createGenesisProfile.ts`, and the `firestore.rules` changes for `buddyUnits`, `rivalWins`, `rivalRewardDay` and `rivalBattles`. I also read `functions/src/account/deleteUserAccount.ts` because it decides what happens to the new data.

**How findings were checked:** by reading the code, and by running the emulator where a claim depended on runtime behaviour. Finding 1 was reproduced with a throwaway rules test (not committed). The race checks below rely on the existing emulator suites, plus one test added on this branch.

## Summary

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | **High** | The client can delete and recreate `users/{uid}`, which resets `buddyUnits` / `rivalRewardDay` / `rivalWins`. The next server call then grants the starter Unit again. | `firestore.rules:197`, `rivalLadder.ts:169-171` |
| 2 | Medium | Account deletion leaves `rivalBattles/{uid}/…` and `wildEncounterSessions/{uid}` (+ receipts) behind | `deleteUserAccount.ts:40` |
| 3 | Medium | `issue` has no rate limit, no cap on open battles and no minimum fight time. Settle trusts `didWin`, so `rivalWins` / tier can be pumped in a loop. | `rivalBattleStore.ts:28-33`, `rivalLadder.ts:319-347` |
| 4 | Low | `desktopAccountSnapshot` runs a locking read-write transaction on every call, although it writes at most once per pilot. A malformed squad surfaces as `INTERNAL`. | `desktopAccountSnapshot.ts:15-27` |
| 5 | Low | `wildEncounterSessions/{uid}/receipts` grows without bound and has no TTL | `wildEncounterStore.ts:18,67` |
| 6 | Low | A duplicate settle that arrives after TTL cleanup returns `unknown_battle` / `not-found` instead of the original ruling | `rivalLadder.ts:319-321` + TTL |
| 7 | Info | A refusal keeps the Unit and `retryGuaranteed` is true, so any capture chance > 0 means a capture is certain with one Unit | `wildEncounterDomain.ts:85-88` |
| 8 | Info | The UTC day is taken at settle time, not issue time. This is correct; it is noted for the Unity HUD. | `rivalLadder.ts:264,338` |

Checked and clean: these need no action (details at the end):
- the starter grant under concurrency
- negative Unit counts
- client-writable reward fields (apart from finding 1)
- settling a battle issued to another uid
- idempotency of transaction retries
- unbounded reads

---

## 1. High: delete + recreate of `users/{uid}` replays the starter Unit

**Where:** `firestore.rules:197` (`allow delete: if isOwner(uid);`), `firestore.rules:181-186` (client create allowed without the three fields), `functions/src/lib/rivalLadder.ts:169-171` (a missing `buddyUnits` means "never seen", so the server grants `STARTING_BUDDY_UNITS`).

The contract says: "Clients cannot create or delete the field, so the grant cannot be replayed." The rules do block deleting the *field* (`protectedFieldsUntouched`). They do not block deleting the whole *document*.

**Failure scenario** (reproduced against the rules emulator with a throwaway test, not committed):
1. Alice has `buddyUnits: 0`, `rivalWins: 5`, `rivalRewardDay: "2026-10-01"` and two Holobots.
2. Alice's client runs `deleteDoc(users/alice)`. Allowed.
3. Alice's client runs `setDoc(users/alice, { ...signupDefaults, holobots: [ACE, KUMA] })`. Allowed, because `holobots` is client-writable on create and the three #43 fields are simply absent.
4. Any of `rivalBattleHost{status}`, `wildEncounterHost{refresh}` or `desktopAccountSnapshot` sees `buddyUnits` missing and writes `buddyUnits: 1`.
5. Alice captures (her wild session at `wildEncounterSessions/alice` survived the delete), spends the Unit, and repeats from step 2. That is one free Unit per cycle, without limit. `rivalRewardDay` is also wiped, so a reset pilot can also take that day's rival reward again. `rivalWins` resets to 0, which makes the ladder easier.

The cost to the attacker is losing frozen currencies (`holosTokens`, `blueprints` and so on are forced to 0 or empty on create). A new or low-value account loses almost nothing, and a script can automate the loop.

**Suggested fix (pick one):**
- **(a) Smallest:** `allow delete: if false;` on `users/{uid}`. Account deletion already goes through `deleteUserAccountV2` (Admin SDK, unaffected). The mobile app never deletes the profile client-side (`grep deleteDoc mobile/src` → PvP pool only). Check that the `holobots-fun` web app doesn't either. Add a rules test.
- **(b) Defence in depth:** stop using "field missing" as the never-seen signal. Record the starter grant somewhere the client cannot delete, for example a server-only `rivalBattles/{uid}` parent doc or `buddyLedger/{uid}` with `starterGrantedAtMs`. All three lazy-grant paths would check it in the same transaction. The same doc could hold `buddyUnits` / `rivalWins` / `rivalRewardDay`, which takes them out of the client-deletable profile entirely.

## 2. Medium: account deletion orphans the new server-side data

**Where:** `functions/src/account/deleteUserAccount.ts:40`. `db.recursiveDelete(users/{uid})` only covers `users/{uid}` and its subcollections.

**Failure scenario:** a pilot deletes their account (an App Store account-deletion requirement). `rivalBattles/{uid}/battles/*` remains: uid-keyed, with lineup, seed and settlement. So does `wildEncounterSessions/{uid}`, with its `receipts` subcollection. After this branch, the TTL policy removes the rival documents about 7 days + 2 h (+ up to ~24 h) after their expiry, *once the policy is enabled*. The wild session and its receipts stay forever. The wild part predates #43, but #43 makes the store user-specific inventory.

**Suggested fix:** in `handleDeleteUserAccount`, also run `db.recursiveDelete(db.doc(\`rivalBattles/${uid}\`))` and `db.recursiveDelete(db.doc(\`wildEncounterSessions/${uid}\`))`. Run them before `auth.deleteUser` and use the same error handling. Add an emulator test.

## 3. Medium: `issue` is unthrottled, and settle wins can be pumped

**Where:** `functions/src/rival/rivalBattleStore.ts:28-33` (every `issue` creates a document), `functions/src/lib/rivalLadder.ts:319-347` (settle accepts `didWin` with no lower bound on `nowMs - issuedAtMs`). There is no `enforceAppCheck` and no per-uid limit on any callable (`grep enforceAppCheck functions/src` → none).

**Failure scenarios:**
- **Cost / storage amplification:** a signed-in script calls `issue` in a tight loop. Each call is one transaction (2 reads, 1–2 writes) plus a ~1–2 KB document with about a dozen index entries (`lineup` is nested maps and arrays). Before TTL these piled up without limit. With TTL they still live for at least 7 days.
- **Ladder forgery:** `issue` → `settle{didWin:true}` within milliseconds, repeated. `rivalWins` and the tier climb without limit. The daily Unit is still capped at 1 per UTC day (verified, including parallel wins on different battles; see the test added below), so there is no Unit gain today. But anything that later reads `rivalWins` or tier for a leaderboard, badge or reward inherits a forgeable number. This is the accepted `settleArenaBattle` trust model, so it is flagged here and not treated as a break.

**Suggested fix:**
- Cap open battles. One option: store `openRivalBattle: {battleId, expiresAtMs}` on a server-only doc, and have `issue` return the open battle if it is still unexpired.
- Require `nowMs - battle.issuedAtMs >= MIN_RIVAL_FIGHT_MS` for `didWin:true` (a few seconds; tune against Unity's shortest real fight).
- Consider `enforceAppCheck: true` on `rivalBattleHost` once the clients send App Check tokens.

## 4. Low: `desktopAccountSnapshot` locks the profile on every call; a bad squad surfaces as INTERNAL

**Where:** `functions/src/desktop/desktopAccountSnapshot.ts:15` (`db.runTransaction` around the whole read) and `:27` (`readTravelSquad` throws `HostError`, not `HttpsError`).

**Failure scenarios:**
- **Lock contention:** the desktop client polls the snapshot while the mobile app writes energy or equips to `users/{uid}`. Admin-SDK transactions take pessimistic locks on what they read, so client writes wait behind the snapshot. With rapid polling this shows up as write latency or `ABORTED` retries. The write it protects happens at most once per pilot lifetime. This was a plain `get()` before #43.
- **Error mapping:** a profile with a malformed `travelSquad` throws `HostError('unavailable')` inside an `onCall`. The caller sees `INTERNAL` with no `rejectionCode`. Before #43 this was the same. #43 added a typed `unavailable` only for bad `buddyUnits`.

**Suggested fix:** do a plain `userRef.get()`. Only if `buddyUnits` is missing, run a small transaction that re-reads and writes the starter Unit. Catch `HostError` and rethrow `HttpsError('unavailable', …, {rejectionCode:'unavailable'})`.

## 5. Low: wild receipts grow without bound

**Where:** `functions/src/acquisition/wildEncounterStore.ts:18,67`. There is one `wildEncounterSessions/{uid}/receipts/{requestId}` document per accepted `offerToy` / `capture`, kept forever.

**Failure scenario:** storage grows linearly with lifetime play, and with any client that generates a fresh `requestId` per tap. No read is affected (receipts are point reads), so this costs storage only.

**Suggested fix:** use the same pattern as this branch. Add an `expireAt` Timestamp to receipts (for example 30 days, well past any realistic client retry) and a TTL policy on collection group `receipts`. First check that no other collection is called `receipts`.

## 6. Low: a late duplicate settle after TTL cleanup reads as `unknown_battle`

**Where:** `functions/src/lib/rivalLadder.ts:319-321` combined with the TTL policy on this branch.

**Failure scenario:** Unity sends `settle`, the reply is lost, and Unity retries more than ~7 days later (for example a backgrounded or offline device). By then the battle document is deleted, so the retry gets `not-found` / `unknown_battle` instead of `alreadyProcessed:true`. Nothing is granted twice. The only risk is that Unity shows an error for a battle that was settled correctly.

**Suggested fix:** none server-side. Document in the Unity hand-off that a `not-found` on a re-sent settle means "already handled or expired": drop it and refresh `status`.

## 7. Info: a refused capture keeps the Unit, so captures are eventually certain

> **Superseded by DECISIONS #44 (2026-10-01, PR `claude/buddy-unit-tiers`):** a refusal now consumes the Unit, and odds come from the Unit tier plus affinity. The scenario below no longer applies.

**Where:** `functions/src/acquisition/wildEncounterDomain.ts:85-88`. `unitsAfter = captured ? units - 1 : units`, `retryGuaranteed: !captured`.

**Scenario:** a pilot with one Unit retries a 5% encounter with a new `requestId` each time until it succeeds. With no cost per attempt, `chanceByAffinity` only changes *how many taps* a capture takes. It never decides *whether* the capture happens. This matches the contract and #40's `returnRefusedUnit: true`, so it is not a bug. Pak should confirm it is the intended economy, because it makes the Unit a "per capture" cost and not a "per throw" cost.

## 8. Info: UTC day boundary

**Where:** `functions/src/lib/rivalLadder.ts:264` (`dailyRewardAvailable`) and `:338` (the grant).

There is no defect. `nowMs` is pinned outside the transaction, so a retry that crosses midnight still rules on one day. The tests cover 23:59 → 00:00. Two consequences for the client:
- The day is decided at **settle**. A battle issued at 23:59 with `dailyRewardAvailable:false` can still grant a Unit if settled after 00:00 UTC.
- A pilot can earn two Units a few seconds apart across UTC midnight, which is local afternoon or evening in the Americas. Unity should show the settle reply's `buddyUnitsGranted` and not predict it from the issue-time status.

---

## Checked and clean

- **Starter grant under concurrency:** every lazy-grant path writes an absolute `buddyUnits: 1` inside a transaction that read the field. Concurrent first reads serialize (covered by the emulator tests "starter Unit exactly once …" in both suites). `createGenesisProfile` writes the field in the same `create`, and its retry or second call returns `created:false` without writing. The only replay is finding 1.
- **Negative Unit counts:** `capture` spends only when `units ≥ 1`, using a value read in the same transaction (`wildEncounterDomain.ts:71-85`). Stored values that are not non-negative safe integers fail closed (`readBuddyUnits`, `validUnits`). Covered by the existing test "last Unit contended by two encounters".
- **Client-writable reward fields:** `buddyUnits`, `rivalWins` and `rivalRewardDay` are in the `protectedFieldsUntouched` MapDiff and are forbidden on create. `rivalBattles/**` falls through to the global `match /{document=**}` deny (`firestore.rules:297`). It is not under the owner-writable `users/{uid}/{subcollection}` wildcard. The mobile client writes the profile field by field (`mobile/src/lib/profile.ts`), so stale copies of these fields are never echoed back. The exception is finding 1.
- **Settle for another uid's battle:** the battle path is built from `request.auth.uid` only (`rivalBattleStore.ts:17`), and the stored `battleId` is re-checked. Covered by the test "foreign, unknown and expired battle ids".
- **Transaction retries:** `battleId`, the 8 random draws and `nowMs` (rival), and the capture `draw` (wild), are all fixed before `runTransaction`. Every write is computed from values read inside the transaction (absolute values, no `FieldValue.increment`), and receipts and settlements make replays return the stored ruling. All reads come before writes in each transaction body.
- **Unbounded reads:** none. Every new path does point reads (`users/{uid}`, one battle, one session, one receipt). There are no queries, so no composite indexes are needed.

## Test added on this branch (safe, no behaviour change)

`functions/scripts/test-rival-battle-emulator.mjs`: "parallel wins on different battles in one UTC day grant the daily Unit once and count every win". It settles six separately issued battles as wins concurrently and asserts exactly one Unit, `rivalWins: 6`, and `rivalRewardDay` set to that day. It passes.
