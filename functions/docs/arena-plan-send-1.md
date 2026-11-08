# Arena plan + send, and `progression[]` (arena-match-1 additions)

Pak, 2026-11-08. `arenaMatchHost` can resolve a CPU tier fight on the server from the pilot's plan, with the same
resolver and schemas as `rivalBattleHost` (`lib/duelResolver.ts`, `Schemas/duel-intents-1.json`, `Schemas/duel-receipt-1.json`).
Schema for the additions: `Schemas/arena-match-resolver-1.json` (`arena-match-1` and `arena-bracket-1` are byte-pinned, so they are not edited).
Tests: `scripts/test-arena-resolver.mjs` (runs in `npm test`, and on the emulator when its env is set).

## Resolver fight (opt-in)

| Step | Request | Reply |
|---|---|---|
| Issue | add `duelSchema:'duel-receipt-1'` to the normal issue (refused with `tournamentId`) | adds top-level `duel {mode:'resolver', schemaVersion:'duel-receipt-1', maxRounds:120, player:[fighter], opponent:[fighter]}` (also on start / resume) |
| Start | unchanged | |
| Settle | `{schemaVersion:'arena-match-1', operation:'settle', matchId, playerIntents:[1-120 of 'strike','heavy','defend','finisher']}`, nothing else | adds top-level `duelReceipt` (duel-receipt-1) and `progression`; `match.settlementReceipt.report` has `resolverWinner` |
| Cancel | `{operation:'cancel', matchId}` only; `playerFinalHealth` is refused | before start: refund. After start: forfeit, HP unchanged |

- A short list repeats by round number. The server rules HP, outcome and rewards; a replay returns the stored receipt and pays nothing.
- The seed stays on the server until the settle receipt, so a client cannot search for a winning plan.
- A stored mode can't change: legacy fields on a resolver match, or `playerIntents` on a legacy match, are `invalid_request`.
- One `requestId` can't switch mode (`request_conflict`).

Unchanged: fees, the quote's payouts, the 10 paid settles a day (`payoutWithheld:'daily_cap'`), expiry, activity conflicts.

Differences from the legacy path, both forced by server resolution:
1. **The 3 s floor refuses every settle before resolving**, with `too_fast` + `retryAfterMs`, whatever the outcome. The legacy rule (refuse a win, pay nothing for a loss) would tell a client whether a plan wins without spending anything.
2. **No performance bonus** (combos / perfect defenses are 0, the tournament bracket's rule). They were client reports. Base EXP and sync still pay; Holos and blueprints are unaffected.

## `progression[]`

Row: `{holobotId, expGained, levelBefore, levelAfter, attributePoints, experience, nextLevelExp, rank}` (the rival settle row).

| Reply | How to get it |
|---|---|
| `arenaMatchHost` settled match (settle, replay, resume), legacy or resolver | Always, top level. Unity's and Lite's arena readers ignore unknown root keys |
| `tournamentBracketHost` `advance` / `resume` | Send `progressionSchema:'battle-progression-1'`. Present once the bracket closes (win or elimination). Default replies are unchanged because Unity's `TournamentBracketReplies` rejects unknown keys |
| `tournamentResultHost` | Send the same `progressionSchema` |

`expGained` is the awarded amount (EXP Booster included; 0 when the payout was withheld). Records settled before this shipped have no row: arena replies omit the key, bracket opt-in replies return `[]`.
