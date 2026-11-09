# Plan-and-send client contract (rival + Guild Court beast)

For client builders. The server resolves the fight: the client sends a plan, the host returns a receipt, and the client
plays the receipt back. Rulings: `~/HolobotsVault/QA/2026-11-07-city-missions-arena/PLAN.md`, build 43 section.

Both fights use the same `duel` block, plan, and receipt (`functions/src/lib/duelResolver.ts`, `duel-receipt-1`).

## The flow

1. Send `issue` with `duelSchema: "duel-receipt-1"`.
2. Read `duel.mode` in the reply. **Only `"resolver"` means plan-and-send.** Any other value uses the path for that mode.
3. Let the pilot build the plan, then send `settle` with `playerIntents` only.
4. On `too_fast`, wait `details.retryAfterMs` and resend the identical body.
5. Play `duelReceipt` back. Rewards and HP are already final.

Retrying a settle is safe: a settled fight replays its stored receipt and pays nothing.

## Shared shapes

**`duel` on the issue reply**

```jsonc
{ "mode": "resolver", "schemaVersion": "duel-receipt-1", "maxRounds": 120,
  "player":   [ /* DuelFighterStats, in fighting order */ ],
  "opponent": [ /* DuelFighterStats */ ] }
```

`DuelFighterStats`: `{ holobotId, level, tier, maxHealth, currentHealth?, attack, defense, speed, maxStamina, staminaRegen, moveset }`.
`moveset` has one row each for `strike`, `heavy`, `defend`, `finisher`:
`{ moveId, staminaCost, damageScale, syncGain, syncCost, staminaRestore, guardReduction, source }`.
The seed is never sent before the receipt.

**`playerIntents`**: 1 to 120 strings, each `strike`, `heavy`, `defend` or `finisher`. A shorter list repeats for the whole
fight. An action the fighter can't afford becomes a `wait` in the receipt, with a `refusal`.

**`duelReceipt`**

```jsonc
{ "schemaVersion": "duel-receipt-1", "seed": 123, "winner": "player" /* or "opponent" */,
  "reason": "knockout" /* or "round_limit" */,
  "rounds": [ { "round": 1, "side": "player", "attacker": "ace", "defender": "cacheback", "move": "strike", "moveId": "…",
                "requested": "strike", "hit": true, "damage": 60, "defenderHpAfter": 220, "staAfter": 6, "syncAfter": 10,
                "refusal": "insufficient_stamina" /* optional; also sync_not_ready, knocked_out */ } ],
  "playerFinal":   [ { "holobotId": "ace", "currentHealth": 120, "maxHealth": 150, "stamina": 5, "maxStamina": 7, "sync": 40 } ],
  "opponentFinal": [ /* same row */ ] }
```

`rounds` holds up to 240 rows, one per side per round, in the order they happened.

## Rival: `rivalBattleHost`

A resolver battle needs **both** the request's `duelSchema` and the server's `HOLOCITY_RIVAL_ISSUE_RESOLVER=1`. A client that
doesn't send `duelSchema` always gets the legacy path. With the flag off, an opted-in client gets `duel.mode: "legacy"` and
plays the legacy path, so it must branch on `duel.mode`.

```jsonc
// issue. Add storySchema / rivalId for a gathering citizen, as today.
{ "schemaVersion": "rival-battle-3", "operation": "issue", "duelSchema": "duel-receipt-1", "healthSchema": "rival-health-1" }
// settle: anything else on the body is ignored
{ "schemaVersion": "rival-battle-3", "operation": "settle", "battleId": "rb_…", "playerIntents": ["strike", "strike", "heavy", "defend"] }
```

The issue reply is the usual `rival-battle-3` reply plus `duel`. A gathering citizen's reply omits `playerCombatants`; use
`duel.player`. The settle reply is the usual one plus `duelReceipt`.

| `details.rejectionCode` | HTTPS code | Meaning |
|---|---|---|
| `too_fast` | `failed-precondition` | Settle within 20 s of issue, for any plan. `details.retryAfterMs` says when; nothing was written and the plan was not resolved. |
| `invalid_request` | `invalid-argument` | Bad `duelSchema`, or missing or invalid `playerIntents` on a resolver battle. |
| `unknown_battle` | `not-found` | Not this pilot's battle. |
| `battle_expired` | `failed-precondition` | Past the 2-hour window. |
| `squad_required` | `failed-precondition` | Resolver issue with no owned travel squad. |
| `too_many_open` | `failed-precondition` | Another fight is open. |
| `activity_conflict` | `failed-precondition` | An Arena match or expedition is open. |
| `rival_cooldown` | `failed-precondition` | Same rival within 5 minutes; `details.retryAfterMs`. |
| `unavailable` | `unavailable` | Stored state is malformed. |

## Guild Court beast: `holoZoneHost`

Opt-in per request, with no server flag, for `zoneId: "guild_court"` only. The fight is one Holobot against one Cacheback.

```jsonc
// issue: holobotId is the one Holobot that fights; it must be in the travel squad
{ "schemaVersion": "holozone-run-2", "operation": "issue", "zoneId": "guild_court", "duelSchema": "duel-receipt-1", "holobotId": "ace" }
// settle: the plan only. kills, bossDefeated, fielded, health or healthSchema on this body is invalid_request.
{ "schemaVersion": "holozone-run-2", "operation": "settle", "runId": "…", "playerIntents": ["strike", "strike", "heavy", "defend"] }
```

The issue reply is the usual run view plus `population` (null here), `playerCombatants[]` with `currentHealth`, and
`duel` (with `beastId: "cacheback"`). `status` re-serves `duel` while the run is open, so a client can resume.
The Cacheback's stats in `duel.opponent[0]` scale with the named Holobot's level at issue and are pinned for that run, so show
what the block says rather than a fixed number.

The settle reply is the `holozone-run-2` reply plus `duelReceipt`: `settlement`, `progression`, `holosGranted`,
`blueprintFragmentsGranted`.

**Rewards are the client-reported run's rewards.** A win counts as `kills: 1`, a loss as `kills: 0`, `bossDefeated: false`,
and `fielded` is the named Holobot.

| Result | Holos | Fragment | EXP |
|---|---|---|---|
| Win | 100 | 1 | battle table with 1 combo |
| Loss | 25 | 0 | battle table loss |

**HP is real on this path.** The receipt's final HP is written to the health ledger, and a knocked-out squad member refuses
the next zone issue with `holobot_ko`.

| `details.rejectionCode` | HTTPS code | Meaning |
|---|---|---|
| `too_fast` | `failed-precondition` | Settle within 20 s of issue, for any plan. `details.retryAfterMs` says when; nothing was written. |
| `invalid_request` | `invalid-argument` | Bad opt-in, Holobot not in the squad, a plan on a client-reported run, or a report on a pinned run. |
| `unknown_zone` | `invalid-argument` | Zone id not in the table. |
| `unknown_run` | `not-found` | Not this pilot's run, or it left the 10-run history. |
| `run_closed` / `run_expired` | `failed-precondition` | Superseded by a later issue, or past 2 hours. |
| `holobot_ko` | `failed-precondition` | A squad member or the named fighter is at 0 HP. |
| `zone_cooldown` | `failed-precondition` | Within 3 minutes of the last settle; `details.retryAfterMs`. |
| `activity_conflict` | `failed-precondition` | An Arena match or expedition is open. |
| `unavailable` | `unavailable` | Stored state is malformed. |

A client that sends no `duelSchema` keeps today's client-reported run, unchanged.

## Other client-visible changes on this branch

**Intro chain.** `win_arena_battle` (kind `arena`, `destinationId: ""`, 150 Holos) sits between `win_rival_battle` and
`visit_portal`. Claim it after an Arena win; `not_met` means not yet. A client must accept the new `kind`. A pilot who had
claimed `visit_portal` before this shipped sees the step `claimed: true` with a zero reward.

**First Hare.** While `capture_buddy` is the current step, a Buddy Unit thrown at a Hare always lands. The Unit is spent and
`captureResult.captureChance01` is 1. Pre-throw world-state odds still show the normal chance.

**Mission Board.** New capture postings never name `kurai_garden`. A posting already on a board still reads and completes.

**Equipped parts (branch `feat/parts-in-fights`).** `duel.player` and the receipt now include equipped parts on resolver fights, pinned at issue, so show the numbers in the block. The Guild Court Cacheback also gains the fighter's gear (ATK, DEF and HP 1:1), so read its numbers from `duel.opponent`. A part above the pilot's cups counts as unequipped; legendary parts need the Elite Cup while Legends is dormant, then the Legends Cup. Part HP exists only in the fight: `duel.player[].maxHealth` can be higher than the Holobot's own max, and the receipt uses that scale, while the health ledger keeps the Holobot's own max and the same fraction of health. No wire keys change. `equipHolobotPart` refuses a rare part without the Starter Cup, an epic part without the Champion Cup and a legendary part without the Elite Cup (the Legends Cup once it is live): `failed-precondition`, `details.rejectionCode: "part_locked"`, message "Win the Starter Cup to equip this part." Re-saving a part already equipped stays a no-op.

**Cup names.** The Rare Cup is now the Elite Cup: copy only, its `tournamentId` stays `"rare"`. A fourth cup, Legends, exists on the server but is dormant, so `tournamentsWon` stays 0..3 until clients ship readers for it (`story/CUP_PRIZES.md`).

**Cup entry before the gathering.** `arenaMatchHost` `issue` with a `tournamentId` now refuses a pilot whose `storyFlags.arenaGatheringSeen` is false, with `details.rejectionCode: "not_admitted"` (`failed-precondition`), before anything is charged. A client should send the pilot to the Arena forecourt rather than offer a retry. A cup entry that was already charged can be undone with `arenaMatchHost` `cancel{matchId}`, which refunds the fee or pass and frees the lease.

**Cup rides.** `cupPrize` (opt-in with `prizeSchema: "cup-prize-1"`) gains `ride`: `"skates"` for the Starter Cup,
`"hoverboard"` for the Champion Cup, `null` for the Elite Cup. It is also present when `alreadyPaid` is true. To know what a pilot
owns at any time, read `storyFlags.tournamentsWon`: 1 or more has skates, 2 or more has the hoverboard. There is no separate
store or story flag. Lite's ride mode `board` is the hoverboard.
