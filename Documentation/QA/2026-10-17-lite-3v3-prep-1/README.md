# lite-3v3-prep-1: Arena 3v3 bench prep (host runtime HELD)

**Status.** The contract proposal and the client prep are both done. There is **no live 3v3**:

- No host implements `arena-match-3v3-1`.
- The deployed `arenaMatchHost` refuses every 3v3 request as `invalid_request`.
- The Arena screen keeps 3v3 honestly unavailable: no charge, no Alert.
- The simulator witness is **HELD**. The run worked, but it caught a QA-harness bug; see "Simulator witness".

## PRs

- **Contract** [Pak209/HolobotsMobile#134](https://github.com/Pak209/HolobotsMobile/pull/134), into `main`, branch `claude/lite-3v3-prep-1-contract`, head `a2628ac`.
  - `Schemas/arena-match-3v3-1.json` and `Schemas/arena-match-request-3v3-1.json`.
  - A hand-authored fixture, `functions/scripts/fixtures/arena-match-3v3/lifecycle.json`: 23 steps (15 accepted, 8 refused), sha256 `9a9ff7e66d66e15dc1833eb8ae1134c83ac805b1e8d6462e25cc1abbe5d1abd1`.
  - `functions/scripts/test-arena-match-3v3-contract.mjs`, which runs in `npm test`.
  - `functions/docs/arena-match-3v3-1/CONTRACT.md`.
  - `functions/src` is untouched.
- **Client** [Pak209/HolobotsMobile#139](https://github.com/Pak209/HolobotsMobile/pull/139), into `mobile-holocity-lite`, branch `claude/lite-3v3-prep-1`, rebased on `c187921` (after #131, #132 and #133).

## What the client does

- **Reader.** `readArena3v3Reply` (`mobile/src/lib/arenaMatch3v3.ts`) is a strict reader at parity with the contract. It refuses:
  - unknown keys, STA, and a combat bag;
  - client prices (the pass price comes from `rules.entryFeePasses`);
  - incoherent active, KO, winner or outcome states, including a double wipe with a winner;
  - malformed receipts.
- **Swap.** `ArenaMatchFlow.swap(holobotId)` persists the exact `{schemaVersion, operation:'swap', matchId, intentId, turn, holobotId}` body under `arena-match-3v3-pending-1:<uid>` before sending it through the same `arenaMatchHost` callable.
  - Nothing changes locally until the host replies.
  - A host refusal (`details.rejectionCode`) clears the intent, and the state stays as it was.
  - A transport or unknown error keeps the exact body for `retrySwap()`, which resends it byte for byte, or fails.
  - A pending intent for another match fails closed (`arena_intent_stale`, zero sends) until `discardPendingSwap()`.
  - Nothing calls this live yet.
- **Bench cards.** `ArenaBenchCards` sits outside BattleArenaView. It shows an empty BUDDY strip, then the active card, then two bench cards.
  - The cards show host HP and the host LV badge, as a lower-left corner tab. There is no STA, no regen, and no local HP arithmetic.
  - SWAP IN appears only on an active match.
  - On-screen copy says "City", never "host" (DECISIONS #71; PLACEHOLDER until Lex).
- **3v3 entry.** The 3V3 SHOWDOWN button is disabled, with one honest line ("…nothing is charged"). The Alert is gone. #132's economy-signal calls in ArenaScreen are untouched.
- **QA routes.** Five QA routes, known-bad first: `ArenaBenchKnownBad`, `ArenaBenchCommand`, `ArenaBenchRefused`, `ArenaBenchSendIn`, `ArenaBenchSettled`. They are registered in the dev-only registry as one `...arenaBenchPreviewScreens` spread.

## Cold checks (final heads)

| suite | result |
|---|---|
| functions `npm run build` | OK |
| functions `npm test` | **319 tests: 318 pass, 0 fail, 1 skipped** (the 3v3 contract suite has 7) |
| functions `npm run check:shared` | 3 shared files in sync |
| mobile `npx vitest run` | **77 files (76 passed, 1 skipped); 898 tests: 894 pass, 4 skipped** (`arenaMatch3v3.test.ts` has 207) |
| mobile `npx tsc --noEmit` | exit 0 |

**Mutation checks** (one-off; not part of `npm test`):

- **Contract.** Deleting any of the 23 conditional schema rules, or either winner survivor clause, fails the suite.
- **Client reader.** Deleting a clause kills 131 of 135 mutants. The 4 survivors are equivalent mutants, where a stricter check always fires first:
  - the outcome enum;
  - the integer close time;
  - the forfeit `winner` check;
  - the integer entry amount.
- **Client flow.** 20 of 21 are killed. The survivor is `retrySwap`'s stale check, which `swap()` repeats.
- **Other client mutations** that the suite catches:
  - both optimistic-swap variants;
  - an on-screen "host" string;
  - `structuredClone` in app-bundled 3v3 code.

## Adversarial review (asked for by the parent session)

- **Round 1.** Four read-only critics plus six skeptics. Of 27 findings, **6 were confirmed** and none refuted. The confirmed ones:
  - CONTRACT.md overstated what the host decides. Report HP and the settle performance counts are client-asserted, as in #120.
  - The schema did not couple terminal state, outcome, winner and active slot.
  - The no-optimistic-swap tests compared against the live object.
  - `retrySwap` could send a brand-new swap into another match.

  All of them are fixed, plus the 7 overflow findings and 12 of the 14 lows. The two lows left: LOW14 (PvP 3v3) is out of scope, and LOW7 is covered by synthetic controls.
- **Round 2.** Two re-checkers plus two skeptics. **2 more were confirmed**, both now fixed:
  - An expired phase-over match had no exit. Settle is now legal for a decided match after expiry, which keeps the shared lease from being stranded.
  - Reader checks were unpinned by tests. Every clause is now targeted.

  Its 7 lows were also fixed: double-wipe winners, the sent-in CPU HP, clause probes, a pass control, two type gaps, and the cold-start retry error code.

## Simulator witness: HELD

There was one bounded run.

- **Setup:** iPhone 17 Pro / iOS 26.5, the cached `fun.holobots.mobile.w64` launched once, and Metro offline from this branch at `0014320`.
- **What happened:** it bundled 1623 modules with no redbox, and all five routes rendered. Every fixture cell then failed **inside the QA harness** with `Property 'structuredClone' doesn't exist`. Hermes here has none, and the tests run on Node, which does.
- **Known-bad cell:** it showed legacy local regen (bench STA 4→7). Its splice into a City reply crashed, so the reader refusal was not exercised on device.
- **Not shown:** bench cards, the LV corner tab, the BUDDY strip, or a swap round-trip on device.
- **The fix:** `4879400` uses a JSON deep copy and adds a guard test. It is **unwitnessed**, because there was no second attempt.

Evidence is in `~/HolobotsVault/QA/2026-10-17-lite-3v3-prep-1/`: `GATE_SHEET.png`, 5 cells, `metro.log`, `source-head.txt`, `cells.json` and `README.md`.

## HELD

- The 3v3 host runtime: dispatch, a record validator with every coherence rule, intents storage, a closed `combat` shape, and an emulator fixture and tests.
- Any deploy.
- A live witness against a real host.
- A re-witness of the bench QA routes after `4879400`.
- PvP 3v3 inside PvpArenaModal, which is reachable from ArenaScreen. It still uses legacy local authority (`pvpTeamBattle` bench regen). It is owned by lite-pvp-fighters-1 and outside this lane.
- ArenaScreen's own pre-existing strings that say "HOST" ("RESUME HOST MATCH", and others) break the DECISIONS #71 rule. They are left for lite-arena-polish-1.

## Pak calls

1. **Swap timing.** What is `voluntarySwapLimit` (placeholder 2)? Does a voluntary swap give the CPU a free hit?
2. **Bench regen.** The proposal is `none`.
3. **3v3 entry price.** Placeholders: 50 Holos, `entryFeePasses` 1, charged once.
4. **Rewards.** The reward quote, who gets EXP, and which blueprint drops.
5. **CPU team selection.**
6. **STA.** Should the host ever carry STA across bouts?
7. **Performance counts.** Client-asserted 0..25 in 3v3, as in 1v1? Is the 1000 ms `too_fast` floor enough? Should a late settle zero the counts (the proposal says yes)?
8. **Buddy.** Should the 3v3 admission freeze a Buddy Unit snapshot from the account's `buddyUnits`? Today the strip is empty.
