# W29 — live rival receipt consumer

Branch begins at PR #97 `786cd6f6d36cb05ae84faa40f742746ee4fea9e7`; PR targets `mobile-holocity-lite` as requested. Merge #97 first, then rebase this PR to remove its inherited hub changes. No host change, deploy, flag flip, live account, simulator or editor use.

## Delivered flow

`rivalBattleHost settle → validated reply + pinned issue → DuelPlaybackScreen(liveIssue, receipt)`.

- Legacy (explicit `duel.mode=legacy`, or pre-migration omitted duel): show the host settlement result and reward only. Ignore all client rounds, receipt-like extras and synthetic markers. Never invent a combat trace.
- Resolver (`duel.mode=resolver`, `duel-receipt-1`): use only host receipt rounds, recorded resources and winner; battle ID, squad identities and result must agree. Missing/invalid/unknown contracts show a receipt error, never a legacy fallback. The public issue has no seed; there is no fabricated client seed comparison.
- `settleCityResolver` handles an already-issued resolver admission, sends only `schemaVersion`, `operation`, issued `battleId`, and a copied 1–120 intent plan. Same battle/plan retry preserves host idempotency. Account identity is checked before and after the callable; no client outcome, damage, HP, fielded lineup or seed is sent.
- Existing city settlement route passes the original issue and actual settle reply into the live consumer, with no locally computed rounds. Offline preview keeps its fixture/client trace and existing toggle; it never uses the resolver callable.

## HELD: starting new live citizen battles

Citizen admission remains unavailable, before any issue request. The deployed legacy host requires a client `didWin` claim and does not provide an authoritative result-generation endpoint. Its gathering issue omits `playerCombatants`. There is no pre-issue capability probe; issuing just to learn the mode can strand a legacy admission. W29 does not invent a win/loss, silently forfeit, enable local authoritative combat or flip the server. The resolver transport/consumer is ready for already-issued admissions; a new intent-selection/admission UX and native validation are not shipped here.

## Dependencies and checks

Reuse #90/#95 `hostDuelReceipt.ts`, its tests and two W10 JSON fixtures byte-for-byte; reuse their `duelPlayback.ts` byte-for-byte. `DuelPlaybackScreen` adds the explicit live-mode entry to that existing viewer. These overlapping files should converge when #90/#95 land; no host commits are inherited.

Known-bad case first: a legacy reply containing resolver-like rounds must still show zero rounds; a resolver missing its receipt must never present `didWin` as a fallback. Tests cover legacy/pre-migration, all 16 recorded actions over 8 rounds, malformed/foreign battle and squad, conflicting result, replay, copied intent payload, unsupported/empty/overlong plans and account switches.

Validation: full Vitest and TypeScript results recorded in the PR body. Initial TypeScript check found a lost index-signature inference in the settlement projection; explicitly retaining the receipt/reward fields fixed it. No native rendering claim is made.
