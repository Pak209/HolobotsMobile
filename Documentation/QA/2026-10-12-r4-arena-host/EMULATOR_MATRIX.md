# R4 host transaction matrix

This matrix exercises real Firestore transactions in a loopback emulator under a `demo-` project. Candidate tests are not evidence until their TAP run is retained. The combat outcome remains a bounded presentation report under decision #56, not host replay verification.

| Group | Adversarial checkpoint | Required assertion |
|---|---|---|
| Baseline known-bad | Exact pinned old settlement callable, no prior debit | Original awards reward; candidate requires issued match and writes nothing on rejection |
| Baseline known-bad | Original client IDs A → B → A | Original A pays twice; candidate durable receipt survives B and A replay writes nothing |
| Baseline known-bad | Original entry request retried after lost reply | Original charges twice; candidate concurrent/retry request key charges once |
| Issuance | Authenticated owner, unique owned species, tier, opponent and payment | One debit plus durable server match ID and HP snapshot in one transaction |
| Issuance | Same request concurrent × 5; changed payload on same key | Exactly one debit; changed identity conflicts without partial mutation |
| Issuance | Unowned/duplicate species, KO, malformed ledger, insufficient funds | No debit, match, request receipt or lease written |
| Settlement | Before start; wrong owner; invented ID; arbitrary tier/bot/reward/win fields | Refusal leaves profile, lease, records and receipts unchanged |
| Settlement | Bounded valid report with HP loss, then simultaneous duplicates × 5 | Exactly one reward and one HP reduction; complete stable receipt on replay |
| Settlement | Foreign entrant, HP increase, negative/nonfinite HP, invalid terminal result, performance bound | Refusal leaves every touched document unchanged |
| Settlement | Existing health lower than issued HP | Settlement cannot raise current persistent HP |
| Recovery | Fresh-client `resume` without either local ID | Discover account latest issued/active/expired/terminal record; absent returns null; malformed parent fails closed; every discovery read-only |
| Recovery | Lost issue/start/settle reply; resume across later match | Same match and terminal receipt; no duplicate debit or payout |
| Recovery | Unstarted cancellation and duplicate cancellation | Exactly one original-method refund and lease release |
| Recovery | Started cancellation and expired open lease | No invented refund/heal; explicit terminal receipt and safe release policy |
| Activity A → legacy | Arena open, every rival version and health flag on/off | All new rival issue attempts fail atomically |
| Activity A → legacy | Arena open, every zone version and health flag on/off | All new zone issue attempts fail atomically |
| Activity legacy → A | Real rival/zone record already open, health flag on/off | Arena issuance fails before charge |
| Delayed settlement | Old rival/zone first settle reaches Arena-open lease | No late HP or reward mutation during Arena |
| Duplicate settlement | Previously terminal rival/zone/item receipt while Arena open | Replay succeeds read-only, preserving receipt |
| Repair | Arena open, item/marketplace repair entrypoints | `arena_no_heal`; no item spend or HP write |
| Race | Arena issue versus rival/zone issue and repair | Serializable ordering; no overlapping accepted activities or HP mismatch |
| Malformed lease | Invalid schema, malformed open/identity, expired-open state | Fail closed; elapsed time alone never unlocks an unresolved match |
| Persisted accounting | 22 malformed quote/record cases plus changed pass cost | `unavailable` on settle/resume or cancel; no writes |
| Current progression | 13 malformed current-entrant cases plus unknown species | Refusal before XP loop; no writes, no legacy infinite-input execution |
| Quote stability | Fee/reward functions change after admission | Original numeric charge/reward quote remains binding |
| Receipt stability | Valid-shaped altered terminal report after a later match | Original receipt replayed, later lease and all data unchanged |
| Atomicity | Every rejected command | Snapshot equality across profile, activity docs, match and request collections |

## Retained first-run limitation

The initial run executed 37 Arena groups plus 2 account-deletion groups: **38/39 passed, 1 failed, 82.735746 seconds**. The failing Arena-vs-Rival/Zone race had exactly one successful activity, but the losing emulator transaction returned gRPC code `3` with the exact message `3 INVALID_ARGUMENT: Transaction is invalid or closed.` instead of the required domain `activity_conflict`. Every other group passed, including the malformed-record/profile controls and the three original known-bads. This was an emulator transport failure; the run is not reported as a clean pass.

The revised race harness allows **one** same-intent client retry only for that exact code/message, after the winner is committed. It preserves UID, request body and server test time. Before retry it snapshots all relevant documents, then requires the retry to return exactly `activity_conflict` and verifies the complete snapshot is unchanged. A second transport failure, any different error, zero winners, or two winners still fails. The TAP output records each use and the total number of bounded transport retries. Other race tests have no blanket retry behavior.

## Measured candidate checkpoint

The second run passed **39/39 groups in 77.232495 seconds**: 37 Arena groups in `functions/scripts/test-arena-match-emulator.mjs` and 2 account-deletion groups in `functions/scripts/test-delete-user-data-emulator.mjs`. There were no skipped, cancelled or TODO tests. It used Node 22.23.1 with the local Firestore emulator at `127.0.0.1:18180`, demo project `demo-holobots-r4`.

Exactly **one** bounded emulator transport retry occurred: Zone issue with health enabled won the transaction race; Arena's losing intent first received the emulator's code-3 transaction-closed transport error. The one retry used the same UID, body and time, returned `activity_conflict`, and changed no profile, lease, match, request receipt, legacy activity or item receipt data. The complete first failure remains disclosed above. This is a passing host/emulator matrix with that measured transport qualification, not a deployed-service or mobile-client playtest.

The three baseline fixtures demonstrate the original defects with the original SHA-pinned callable bodies: unpaid settlement grants 100 Holos and one win; A → B → A grants 300 Holos and three wins; repeated entry charges 100 Holos instead of one 50-Holos debit. Candidate groups prove those legacy entrypoints fail closed and the durable protocol debits and settles once per server-issued match. Baseline source pins and the in-memory fixture loader are under `fixtures/`.

## Recovery follow-up after the full matrix

A subsequent review added account-based `resume` without a match ID so a fresh client can recover after losing both local IDs. Group 38 covers absent state, issued/active state, an unresolved expired match, the expiry terminal receipt, a newer match and its settled receipt, plus five malformed/legacy/missing-child parent controls and two inconsistent parent/child lifecycle controls. The 39-group full run above predates this additive recovery path; its focused validation is recorded separately.

Focused validation of the additive recovery path passed **6/6 groups in 3.529327 seconds**, with **zero transport retries** and no skipped/cancelled/TODO tests. The selection rechecked original match/owner/start bounds, lost issue/start recovery, malformed-operation parsing, callable authentication, altered terminal replay and the new fresh-client discovery group. The latter exercised all seven malformed or inconsistent parent controls. The script now contains 38 Arena groups; the earlier full result remains accurately reported as 37 Arena plus 2 deletion groups, followed by this focused validation rather than an invented second full-matrix run.
