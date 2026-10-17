# Arena admitted match flow: existing host contract proof

Base main cbc5e35. No runtime host changes or new admission ledger. `arenaMatchHost` already supports issue → start → settle on one durable `matchId`, plus resume and cancel. This lane adds the missing machine-readable request shape, expands the reply projection schema beyond fighter badges, and commits an actual authenticated throwaway callable lifecycle fixture.

## Client integration contract

Use `arena-match-1` for every request. `Schemas/arena-match-request-1.json` names the request document, not a new wire version. Issue takes requestId, tierId, paymentMethod, holobotId, opponentName; optional tournamentId is a separate host-bracket admission path. Retain the same requestId for an uncertain issue retry. Persist returned matchId before start. Resume may omit matchId for authenticated latest-match discovery; it never issues or charges. Start and settle must use the admitted matchId. Terminal retries return the stored ruling, not a fresh payout.

Never call chargeArenaEntry first: it already refuses `arena_match_required` (functions/src/arena/chargeArenaEntry.ts). Existing arenaMatchStore issue owns debit, from the unchanged Arena economy table: Rookie token fee 50 or 1 pass. The fixture starts with 1000 tokens, reaches 950 after issue and duplicate issue, and 1050 after one win reward of 100. Replayed settle preserves the full account. Existing regression coverage proves concurrent issue and settle once, lost replies, changed request conflicts, cancellation/refunds and old receipt replay while a newer match is open.

Use `match.entrant` and `match.opponent` snapshots from issue for fighter identity, level, displayName, tier and combat stats. The fixture proves those snapshots remain identical through start, resume and terminal replies. No second request for a badge. Reply schema is a lifecycle projection, allowing additional combat/rules/receipt fields; relational identity, state/account/economy and tier-specific opponent constraints remain host validation, not JSON Schema guarantees.

## Authority limitation — unchanged

CPU practice settle accepts client-reported final HP and performance counts. It does NOT verify combat, and the 1000 ms minimum is only a plausibility check. The host binds accounting, persistence and reward idempotency; it does not make reported victory authoritative. This is the existing hard-rule finding (Holocity #2), not fixed or broadened here. Host-resolved tournament brackets are a separate path. No input-log/resolver migration, client callers, prices, payouts or trust boundaries change.

Legacy lite CPU callers still use the closed balance-only route. Completing that client migration is separate work; this PR does not claim live client flow acceptance, live badge closure or deployment.

## Verification and evidence

Known-bad first: the obsolete balance-only charge call refuses arena_match_required without creating an account. Original regression controls also reproduce historical unpaid settlement and duplicate charge bugs from pinned old code; these controls are not current behavior.

Final unit schema/fixture tests: 2/2. TypeScript --noEmit green. check:shared: all 3 files in sync. Final emulator suite: **43/43 passed, 0 failed / skipped**, 71.278 seconds test-runner time, zero bounded transport retries. Includes 2 new callable checks and 41 existing lifecycle/concurrency regressions.

Attempt 1: current global Firebase CLI attempted uncached Firestore v1.21.0; stopped before any tests. No dependency install or build. Attempt 2 uses cached v1.19.8 directly, demo-arena-admitted-contract, loopback8192, throwaway pilots only, 300-second overall cap and finally cleanup of owned Java. No further retry permitted.

Vault: /Users/pak/HolobotsVault/QA/2026-10-17-arena-admitted-match-flow-1/. Sheet ≤1600, every cell inventoried, known-bad first. No editor, Player/app/host build output, deploy, credits or real account. Tests transpile TypeScript in memory through a scratch hook; no generated lib/dist.

Re-run schema units with `npm --prefix functions run test:arena-admitted-contract` after installing the repository's existing functions and rules-tests dependencies. Ajv is the already-declared rules-tests dependency; the unit script resolves it there and is deliberately separate from the Functions-only default test list. No new dependency is introduced.
