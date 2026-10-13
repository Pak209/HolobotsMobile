# R4 independent contract review

Review date: 2026-10-12. This review covers the proposed `arena-match-1` lifecycle against Mobile `main`, Unity DECISIONS #56–#58, and the pending `codex/healing-2-use` / `codex/healing-3-workshop` sources. Source review and emulator results are separate evidence: the matrix README records executed results. This file does not assert a deploy or client integration.

## Authority and scope

DECISIONS #58-1 selects practice-sim presentation with host validation of its receipt. R4 therefore must bind an authenticated account, one paid admission, the issued player/opponent snapshots, and a single terminal ruling. It does not replay combat or prove that damage occurred. A client that fabricates a plausible terminal HP report can still misrepresent a fight; bounding reports and deriving the result from them closes arbitrary amount/identity/replay holes, not that inherited trust boundary. Server combat remains #55 M3.

The narrow slice is one player entry with an unambiguous species record. It cannot represent three WOLFs with distinct persistent damage. The instance migration approved in #58-2 remains a prerequisite for duplicate teams, and the existing mobile 3v3 provider is not integrated by this host PR.

The four legacy circuits and their existing reward math stay in this PR. The universal 50-Holo Pass and 100-Holo win policy is **approved** by #58-3 but deferred to its separately scoped economy change. It must not be described as unapproved or silently substituted during this authority repair.

## Required lifecycle and receipts

| Transition | Contract checked in review | Failure/replay requirement |
|---|---|---|
| Issue | Server creates the match ID; normalized request identity binds payment, tier, selected player and accepted opponent. Debit, durable match and open lease commit together. | Same request key replays its one admission; changed identity conflicts. Concurrent distinct keys admit at most one match. |
| Start | Only the issued match may start while its lease is held and its admission is live. | A lost reply must not create a second start/debit. Start racing prestart cancellation has one transactional winner. |
| Resume | With a match ID, read that match's snapshots, lifecycle and terminal receipt. Without an ID, discover the authenticated account's latest match through its validated parent. | A client must not reconstruct authority from local round counters. Historical receipt lookup continues after another match opens; current-match discovery returns null only when the parent is absent and rejects dangling/inconsistent pointers. |
| Settle | Started, unexpired match; at least 1,000 ms since start; finite bounded player/opponent final HP, exactly one side at zero; performance counts within the contract. Host derives win/loss and amounts. | No bare `didWin`, amount override, client-selected match identity or new opponent/tier at settlement. Terminal receipt, HP and lease release are atomic. |
| Prestart cancel | Refund exactly the recorded debit, including a prestart admission past its deadline. | Never recompute a refund from a subsequently changed fee table; never refund twice. |
| Started cancel | Requires the bounded player final HP report, applies downward-only HP, grants no reward and refunds nothing. This is also the recovery path for an expired started match. | Time alone never releases the lease. No unapproved automatic KO penalty is invented. |

Started cancellation uses the same client-observed HP trust limit as settlement. It must not promise that a fabricated zero-damage report is detectable. A match whose client cannot provide a report remains locked until an explicit supported recovery path is used; deployment documentation must expose this behavior instead of advertising automatic expiry recovery.

The admission carries the exact debit and an economy version (`arena-economy-legacy-1`). The future #58-3 economy rollout must retain handling for outstanding legacy matches or deliberately drain them first. The terminal receipt records the actual host-derived ruling for audit and replay.

## Findings and required treatment

| Finding | Evidence and mechanism | Treatment |
|---|---|---|
| Old settlement is not bound to admission; A → B → A can pay three times. | Baseline `functions/src/arena/settleArenaBattle.ts` trusts a caller battle ID and only `users.lastArenaBattleId`; entry does not create a corresponding record. | Retire the unbound callable path. Keep exact vulnerable fixtures in the emulator matrix, then prove the candidate refuses the same payloads without partial writes. |
| Cross-activity exclusion must be symmetric and transactional. | `rivalBattleStore.ts`, `holoZoneStore.ts`, and `desktopItemsHost.ts` can write activity/HP while Arena admits unless both sides read the other's server state in their transactions. | Read the Arena parent for all rival/zone issue versions, including health-flag-off clients, and first settlements/repairs. Arena reads their ledgers before debit. Already settled receipts may replay without a new write. |
| An Arena deadline is not a safe HP release. | A started presentation fight can have unreported damage. Clearing the parent solely because time elapsed permits repair or a new admission without reconciling it. | Keep the open lease until terminal HP plus receipt commit. Distinguish expired prestart refund from started cancellation. |
| The existing health helper revives at issue. | `functions/src/lib/rivalHealth.ts:issueVitals` applies the city's 40% fallback at zero HP. | Do not call this fallback for Arena. Read/validate the ledger, refuse KO, snapshot current HP, and never increase it during settlement/cancellation. Arena requires its complete participant report; generic `settleVitals` alone permits omitted rows. |
| Pending healing code recognizes a specific parent shape. | Both pending branches' `healingGuards.ts:arenaOpen` require `schemaVersion: arena-healing-1`, string `matchId`, boolean `open`; malformed stored records fail closed. | Preserve that compatibility parent while durable records live below `/matches`. Preserve both versions' guards during merge resolution. |
| Pending duel receipt replay is gated too early. | `codex/healing-2-use` `duelHealingHost.ts` checks Arena before its closed-run settlement replay. A harmless old receipt therefore fails while a later Arena match is open. | During healing integration move read-only duplicate receipt handling before the new-activity guard; retain the guard before every first HP/activity write. This pending branch is not represented as deployed here. |
| Legacy mobile provider is incompatible with one durable admission. | `mobile/src/lib/arenaClient.ts` discards entry output; `mobile/src/screens/ArenaScreen.tsx` settles client IDs per defeated enemy and per recipient for its 3v3 loop. | Deployment held until the provider binds the new lifecycle or the old Arena entry is disabled. Do not leave an ungated legacy payout escape hatch for compatibility. |
| New uid-keyed trees need account deletion coverage. | `functions/src/account/deleteUserAccount.ts:deleteUserData` explicitly enumerates recursively deleted roots. | Include `arenaMatches/{uid}` and verify its match/request descendants are removed. |
| Legacy profile data remains client writable. | `firestore.rules` intentionally leaves `holobots` and some loadout fields owner-writable; `buildPlayerCombatants` derives snapshots from this existing profile. | Call the result a host-issued snapshot, not verified combat or full ownership anti-cheat. A profile-authority migration is outside R4; record this inherited limitation in the deployment risk statement. |

## Emulator acceptance checks

The useful matrix exercises real Firestore transactions, not a handwritten state-machine imitation. Required controls include the vulnerable old unpaid/replay/double-charge behaviors; concurrent duplicate and distinct issue keys; changed identity under the same key; foreign-account match ID; KO, malformed and out-of-bounds HP; both-alive/both-KO terminal reports; start/cancel and settle/cancel races; repeated terminal commands after a newer match; malformed leases; reciprocal rival/zone/repair races; expiry holding the lease; and no partial writes on every refusal.

Successful receipt replay should be compared with the stored original ruling while proving user balance/HP and the current lease remain unchanged. Pending Workshop/duel integration needs its own negative and race checks; code-shape compatibility alone is insufficient deployment evidence.

## Deployment gates

The candidate source and local checks below are complete. Remaining deployment gates are outside this PR:

1. Integrate mobile admission/start/resume/settle/cancel behavior and remove per-enemy unbound settlements, or explicitly disable that provider.
2. Reconcile healing-2/healing-3 without dropping either direction of exclusion; verify Patch/Kit/Full/Workshop/duel paths against real emulator transactions.
3. Confirm error presentation, expiry recovery and receipt retrieval in the client; `arena_no_heal` is the #57 item-use refusal convention.
4. Keep instance migration, #58-3 economy rollout and live server combat as separately tracked scopes. They are not completed by this PR.
5. Pak reviews/merges and separately authorizes any deployment. This review authorizes none.

## Candidate source review

The first candidate's transaction order is sound: it pins the random ID outside retryable work, performs all reads before writes, checks request deduplication before attempting a new admission, and replays terminal matches before accessing a later match's parent lease. Cancellation refunds its recorded debit. Settlement uses a numeric quote persisted at admission and the existing downward-only `min(current, reported)` health policy.

The independent review identified these concrete candidate defects before handoff:

| ID | Finding | Required correction / status |
|---|---|---|
| CR-1 | `Object.hasOwn(fields, raw.operation)` coerced non-string operations. JSON `operation: ["cancel"]` passed the field lookup, skipped the cancel validator and reached the active forfeit branch. | **Verified corrected in source:** string operation required before lookup. Matrix includes negative array/object operation controls. |
| CR-2 | The stored-record parser checked the quote version but not the quote's numeric fields or opponent identity. A corrupted `rules.holos: "100"` could concatenate into a string balance; the later finite-number scan ignores strings. A missing opponent name could throw before a controlled refusal. | **Verified corrected in source:** monetary quote types/bounds, identities, receipt linkage, timestamp/state coherence and terminal accounting are checked before use/replay. Generated admission/start/terminal records also pass this same parser before any write. |
| CR-3 | `applyHolobotExperience` loops before the candidate's post-computation finite-number check. An owner-writable entrant changed after admission to `experience: Infinity` or `"1e309"` could therefore hang the invocation. | **Verified corrected in source:** known species, finite safe integer progression fields, expected next-level threshold, bounded current experience and numeric boosts are checked at admission and again before settlement progression. Unknown species cannot inherit the ACE fallback. |
| CR-4 | A fresh device missing both request ID and match ID could not discover its held lease through the first candidate's ID-required resume operation. | **Verified corrected in source:** optional-ID resume reads only the authenticated account's parent and child, validates their schemas/IDs and open-versus-terminal consistency, and performs no writes. Known-ID historical receipt lookup remains available. |

These are source findings, not claims that malicious code was exercised against a live account. The emulator executed the corrected rejection controls after the guards were present; the vulnerable unbounded progression loop was not deliberately invoked.

Follow-up review also caught a consistency edge between the global performance limit and the persisted quote's limit. Settlement now enforces the issued `maxPerformanceEvents`, and the common record parser runs before admission/start/terminal writes, so a newly generated record must be replayable under its own invariants. A future incompatible price/rank release still needs explicit outstanding-match migration handling.

Final source disposition: no remaining must-fix defect identified in the reviewed slice. This is a source-review result; the listed deployment gates remain separate requirements.

Measured candidate evidence reviewed: the first transaction run passed **38/39** groups; its cross-activity race encountered gRPC code 3, `Transaction is invalid or closed`, instead of the business refusal. The second run passed **39/39** in **77.232 s**, including all three review-finding controls, modified-payload terminal replay, and both account-deletion cases. It used **one** narrowly bounded emulator transport retry with the identical uid/body/time, followed by the expected `activity_conflict` refusal and zero-write comparison. The local Firestore SDK retries code 3 only for a different `transaction has expired` message; this explains the test-only treatment without adding a production catch-all retry or loosening the outcome assertion. The first failure remains part of the evidence. Callable-only storage rules separately passed **3/3** principal groups.

Fresh-device recovery follow-up: `resume` now accepts an omitted `matchId`, returning the latest account match/receipt or a null match when no Arena parent exists. A missing referenced child, malformed parent, or mismatch between the parent's open flag and the child's terminal state is an `unavailable` refusal, never an inferred unlock. This source correction was added after the 39-group run above. Its targeted run passed **6/6** groups in **3.529 s**, with **zero** emulator transport retries; it covers fresh-account discovery, open/expired/latest terminal discovery, malformed pointers, auth, malformed operations, retained-ID recovery and historical terminal replay. Clients still need to present the recovered state and explicit cancellation/HP-report flow before launch.

Additional retained checks reviewed: **29/29** host regression groups (**14.322 s**), **30/30** domain regression groups (**0.103 s**), and the Functions TypeScript build with **3/3 shared-file parity checks** passed. These are separate suites and are not summed into a claim of distinct end-to-end scenarios. No Unity build, editor operation, deployment or live-account mutation was performed by this review.
