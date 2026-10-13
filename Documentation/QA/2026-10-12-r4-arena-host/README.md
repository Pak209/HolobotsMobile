# R4 — durable Arena host checkpoint

Status: validated host PR candidate; no deploy. Scope: C4 A1, after read-only R5 manifest `Holocity@19b1221e8`. Started 2026-10-12 21:13:21 PDT, maximum box 8 hours. Host base: `HolobotsMobile@dece8921e61d8673a6072454b85ba17e4c921fe8` (main). The validated source checkpoint is 21:36:27 PDT: 23.10 minutes wall, within the 480-minute box; ≤92.4 parallel-worker minutes as a conservative four-worker upper bound. Exact model tokens are not exposed; no estimate is substituted. Generation credits: 0.

## What changes

`arenaMatchHost` introduces `arena-match-1`: issue → start → settle, with resume and cancellation. The authenticated account owns one Arena parent lease. The host creates `am_` plus 32 hexadecimal characters; it atomically debits the existing payment, snapshots one unique-species entrant's current HP and combat stats, pins the opponent and numeric reward quote, and writes a durable request receipt. Issue retries with the same request identity find the original match. A changed identity under the same key conflicts.

Storage is callable-only: `arenaMatches/{uid}` holds the compatibility lease (`arena-healing-1`, `recordSchemaVersion: arena-match-1`); `/matches/{matchId}` holds the complete lifecycle and embedded entry/terminal receipts; `/requests/{requestId}` binds issuance. These receipts have no automatic TTL deletion. Account deletion recursively removes the entire tree, even when the parent is already absent.

Both legacy callables now refuse authenticated calls with `arena_match_required` before debit or payout. This closes unbound settlement, A → B → A replay, and lost-entry-reply double charge. It intentionally requires a client migration before deployment.

Every rival/zone issue version and first settlement reads the Arena parent inside its transaction, including health-flag-off calls. Arena admission reads their active ledgers and the pending duel marker before debit. Repair reads the same parent before spending stock or healing and returns `arena_no_heal`. Previously committed rival, zone and item receipts remain read-only replays while Arena is active. No editor, Assets, scene, prefab or Unity build is involved.

## Wire contract

All calls use `{schemaVersion:"arena-match-1", operation:...}`; unknown fields, malformed operation values and nonfinite values are refused. The UID comes only from callable authentication.

| Operation | Fields | Result / boundary |
|---|---|---|
| `issue` | `requestId`, `tierId`, `paymentMethod`, `holobotId`, `opponentName` | `requestId`: 8–80 ASCII letters/digits/underscore/hyphen. One normalized owned species; duplicate records refuse. `paymentMethod`: `pass` or `tokens`. Opponent must belong to the tier's accepted legacy pool. |
| `start` | `matchId` | Starts the issued match once. No second payment. Rejects after the 30-minute admission deadline. |
| `resume` | optional `matchId` | Read-only current record and complete saved receipts, including terminal matches after a later match opens. Omit the ID for an authenticated account lookup of its latest match; no prior Arena returns `matchId:null, match:null`. This also recovers a held lease after a fresh install. Repeating the exact issue request/key remains another lost-reply recovery path. |
| `settle` | `matchId`, `playerFinalHealth`, `opponentFinalHealth`, `combosCompleted`, `perfectDefenses` | Requires active, unexpired match and ≥1,000 ms since start. HP is finite and bounded by issued HP; exactly one side is zero. Performance counts are whole 0–25 and no greater than the pinned quote. |
| `cancel` before start | `matchId` only | Refunds the exact recorded debit once. Expired unstarted admissions can also refund. |
| `cancel` after start | `matchId`, `playerFinalHealth` | Downward-only HP, no refund, no reward/counters; terminal forfeit receipt. Also the explicit expired-active recovery path. |

Replies contain `{schemaVersion, matchId, alreadyProcessed, match}`. `match` includes `state`, issue/start/expiry/close times, entrant/opponent snapshots, `entryReceipt`, `rules`, and nullable `settlementReceipt`. The terminal receipt preserves outcome, report, actual final persistent HP, awarded rewards/XP (including an active EXP booster), and refund details where relevant. Repeated terminal operations return that original record; they never clear a newer match's lease. Clients must inspect the returned state, including a start that lost a race to cancellation.

Refusals use `ArenaError.code` and callable `details.rejectionCode`: `invalid_request`, `activity_conflict`, `request_conflict`, `unknown_match`, `unavailable`, `insufficient_funds`, `holobot_ko`, `match_expired`, `invalid_state`, `too_fast`. Invalid requests map to invalid-argument, unknown matches to not-found, unavailable to unavailable, and remaining domain refusals to failed-precondition. Authentication failures are unauthenticated. For a transport failure or lost reply, retain the same request/match identity; do not invent another admission key.

## Rules held constant and limits

The four existing circuits remain 50/100/150/225 Holos for token entry; a pass consumes one existing pass. Wins remain 100/200/300/450 Holos, losses 0, and blueprint amounts remain 5/10/15/20. XP/performance/sync use the existing shared battle-table values snapshotted into `arena-economy-legacy-1`. Refunds and outstanding match payouts use this saved numeric quote if a later table changes. DECISIONS #58-3 **approved** universal 50-Holo entry /100-Holo wins; that economy rollout is separate work, not silently included here.

The CPU fight remains the presentation practice sim under #56/#58-1. Finite bounded HP reports are **not combat replay proof**. A fabricated valid-shaped report can still lie about damage or performance. Existing profile `holobots`/loadout ownership and stats remain partly client-writable; R4 validates supported species, unique records and finite consistent progression before using them, but does not claim to close profile authority. The 1-second minimum is a plausibility check only.

No automatic deadline release exists: an expired active match keeps blocking other HP activities until explicit cancellation reconciles a reported final HP. A client that lost its local fight must present this recovery honestly; the host does not invent a full-health restore or an automatic KO penalty. Reports may lower HP only, and the persistent result uses the lower of current and reported HP. Zero-HP entrants are refused; the city's 40% revival helper is never invoked by Arena. Admission initializes a missing legacy HP entry from current max HP only when no ledger entry exists.

This is one unique-species entrant per match, not the existing mobile 3v3/per-enemy provider. Instance-keyed HP/repair/XP approved in #58-2 remains a prerequisite to duplicate-species teams.

## Deployment gates — outside this PR

1. Migrate `mobile/src/lib/arenaClient.ts` and the 3v3/per-enemy settlement flow, or disable that Arena provider before deploying the retired legacy callables. Bind every UI action to the issued match ID and returned lifecycle; witness lost replies and cancellation recovery.
2. Reconcile pending healing PRs #74/#75 (and their chain) against this parent. Retain R4 first-settlement guards and read-only replay behavior. Pending duel code checks Arena before duplicate receipt replay; move harmless replay before the guard during integration. Run the combined Patch/Kit/Full/Workshop/duel matrix, not just a source-shape check.
3. Preserve outstanding `arena-economy-legacy-1` quotes during the separately approved #58-3 rollout. Scope instance migration separately. Server-authoritative combat stays #55 M3.
4. Pak review/merge and a separately authorized deploy remain later actions. This task requests only docs and a PR; none of those future actions has been performed.

See [independent contract review](contract-review.md), [matrix definition](EMULATOR_MATRIX.md), and the SHA-pinned baseline fixtures for the exact original callable bodies. Baseline fixtures are inert text loaded only by the emulator harness.

## Measured validation

| Check | Executed result | Evidence |
|---|---|---|
| Node 22.23.1 TypeScript build + shared parity | PASS; 3 shared files in sync | [build](build.txt) |
| First actual transaction matrix | 38/39; one emulator transport error during race 24 | [complete first attempt](emulator-run1.tap) |
| Corrected transaction harness | 39/39 in 77.23 s; 37 Arena groups + 2 account-deletion groups | [full rerun](emulator-run2.tap) |
| Final account-discovery change and affected boundaries | 6/6 in 3.53 s, no transport retry; includes the new 38th Arena group | [targeted final run](resume-focused.tap) |
| Direct Firestore security rules | 3/3 actor groups: owner, foreign, anonymous; 51 denial assertions | [rules](rules.txt) |
| Existing rival/zone/health/KO host regressions | 29/29 | [host regressions](host-regressions.tap) |
| Existing domain/progression regressions | 30/30 | [domain regressions](domain-regressions.tap) |

The 39-group run predates optional-ID resume; the six-group final run validates that last change and its affected authentication, parsing, historical replay and recovery boundaries. Do not describe this as a single 40-group final-source run. The full suite includes three deliberately vulnerable, SHA-pinned original-callable controls: unpaid settlement minted 100 Holos/one win; A → B → A minted 300 Holos/three wins; an entry retry charged 100 Holos instead of 50. Candidate controls refuse those old payloads, bind retries to one debit, and retain old receipts across newer matches.

Run 1's sole failure was emulator gRPC code 3, exact message `Transaction is invalid or closed.` Its SDK does not classify that message as a retryable expired transaction. Race 24 now permits exactly one same-UID/body/time retry of only that transport error, after the other transaction commits; it must then return `activity_conflict` with the entire stored state unchanged. Run 2 actually exercised that path once (Zone with health enabled won; Arena retried and refused). No arbitrary errors are accepted, no production catch-all retry was introduced, and both logs are retained.

[Tested source SHA-256](tested-source-sha256.json) pins source, rules, test harness and vulnerable fixtures; [checkpoint metadata](checkpoint.json) records runtime and measured scope. Existing regression tests regenerated four historical fixture files in the isolated worktree; those generated changes were restored to their clean base and are excluded from this PR.

Reproduce after `npm run build` in `functions`, with a local demo Firestore emulator running: set `FIRESTORE_EMULATOR_HOST=127.0.0.1:18180` and `GCLOUD_PROJECT=demo-holobots-r4`, then run `node --test functions/scripts/test-arena-match-emulator.mjs functions/scripts/test-delete-user-data-emulator.mjs` from the repository root. The Arena harness refuses non-loopback endpoints or non-demo projects. Rules: from `rules-tests`, use the same emulator endpoint and `vitest run tests/arena-matches.test.ts`. No production service or deploy is needed.

Retained logs normalize trailing whitespace only; [raw and committed evidence hashes](evidence-sha256.json) preserve that distinction. No test result, diagnostic or stack line was removed.
