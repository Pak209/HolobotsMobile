# arena-match-3v3-1: Arena 3v3 contract proposal

**Status: PROPOSAL. Schema and fixture only. The runtime is HELD for a later lane.**
No host code changes in this PR. The deployed `arenaMatchHost` checks
`schemaVersion` first, so today it refuses every `arena-match-3v3-1` request as
`invalid_request` before it reads Firestore. The contract test asserts this.

Files:

- `Schemas/arena-match-request-3v3-1.json`: the requests.
- `Schemas/arena-match-3v3-1.json`: the reply projection.
- `functions/scripts/fixtures/arena-match-3v3/lifecycle.json`: one hand-authored lifecycle with known-bad refusals.
- `functions/scripts/test-arena-match-3v3-contract.mjs`: Ajv validation and lifecycle invariants. It runs in `npm test` and uses the functions-local `ajv`.

Rule 1 holds: **the host decides.** The host owns every fighter's vitals, the
active slot, the turn, the phase, the CPU send-in, the outcome, the one entry
charge and the reward quote. Clients send intents and render the reply.

## Decision: a new version pair, not an extension of arena-match-1

I chose a new pair (`arena-match-3v3-1` and `arena-match-request-3v3-1`) over an
additive extension, for four reasons:

1. **The 1v1 record validator trusts one fighter.** `arenaMatchStore.ts`
   `match()` (exported as `readArenaMatchRecord` for story progression) requires
   `finalVitals` to hold exactly one key, the single `entrant`. A 3v3 terminal
   record writes three. Extending arena-match-1 would mean loosening an invariant
   that story progression depends on. Otherwise every 3v3 record would read as
   `unavailable`.
2. **The 1v1 request shape is closed.** Every arena-match-1 request branch is
   `additionalProperties: false`, and the host's `command()` whitelists fields
   per operation. Adding `holobotIds`, `swap`, `report` and `turn` would change
   what a deployed 1v1 host and client accept. A new version keeps both
   arena-match-1 schemas and the 1v1 runtime byte-identical, and the contract
   test checks that the two versions never validate each other's fixtures.
3. **3v3 settle needs no client HP.** In 1v1, `settle` and `cancel` carry
   `playerFinalHealth`. In 3v3 the host already holds every fighter's vitals, so
   settle carries only performance counts and cancel carries nothing. An
   extension would mix two trust models in one shape.
4. **The ids cannot collide.** 3v3 match ids are `a3_[a-f0-9]{32}`. A 3v3 id sent
   to a 1v1 operation fails the `am_` pattern, and the reverse also fails.

**Shared on purpose:**

- The callable `arenaMatchHost`, dispatched on `schemaVersion`.
- The account lease `arenaMatches/{uid}`, so one Arena activity is open per
  account across both formats.
- The `matches` and `requests` subcollections.
- The tier table and the HttpsError mapping (`invalid_request` to
  invalid-argument, `unknown_match` to not-found, `unavailable` to unavailable,
  everything else to failed-precondition, with details `{rejectionCode}`).

Open runtime item: today a 1v1 `resume` that finds a 3v3 lease returns
`unavailable`, because of the `recordSchemaVersion` check. The runtime lane must
decide whether that stays fail-closed or becomes a typed `activity_conflict`.

## Host-owned state (reply `match`)

- **`team` and `opponentTeam`.** Exactly three slots each, in issue order. `slot`
  equals the array index and never changes. Each slot holds:
  - `fighter`: the frozen #118 snapshot `{holobotId, level, displayName, tier}`,
    exactly those four keys, frozen at issue.
  - `vitals`: `{currentHealth, maxHealth}`. **There is no STA field.**
  - `status`: one of `active`, `bench` or `ko`. `ko` requires
    `currentHealth === 0`; `active` and `bench` require HP > 0.
  - Optional `combat`: frozen stats for the client-observed bout sim. The
    runtime lane pins this shape. Presentation never reads HP from it.
- **`battle`.** `{turn, phase, activeSlot, opponentActiveSlot, voluntarySwapsUsed, winner}`.
  `phase` is one of `ready`, `command`, `send_in` or `over`. `winner` is
  non-null exactly in `over`.
- **`entryReceipt`.** One object: the **one** entry charge for the whole match.
  There is no per-fighter charge field. The schema is `additionalProperties:
  false` at the match and slot level, so an `entryReceipts` array or a slot-level
  receipt fails validation.
- **`rules`** (`arena-3v3-rules-1`). The frozen quote: fee, rewards, bonuses,
  `voluntarySwapLimit`, and three constant policies:
  - `benchRegen: "none"`: benched HP never changes.
  - `sendIn: "forced_on_ko"`.
  - `opponentSendIn: "next_alive_slot"`.
- **`settlementReceipt`.** Null until the match is terminal. It then holds the
  outcome, one settlement or refund, and `finalVitals` with all three team bots,
  which are written to the account's `holobotVitals` ledger.
- **Top-level `intent`.** For `report` and `swap`, an echo
  `{intentId, operation, appliedTurn}`. Null for every other operation.

## Operations

| op | legal when | carries | host does |
|---|---|---|---|
| `issue` | no open Arena lease and no other activity | `requestId, tierId, paymentMethod, holobotIds[3]` | Validates 3 distinct, uniquely owned, living bots and freezes each as a snapshot with ledger HP (no full-HP default). Picks the CPU team from the tier pool. Charges **once**. `state: issued`, `phase: ready`, `turn: 0`. |
| `start` | `issued`, not expired | `matchId` | `state: active`, `phase: command`. |
| `resume` | always | optional `matchId` | Returns the current projection, `alreadyProcessed: true`. |
| `report` | `phase: command` | `intentId, turn, activeHealth, opponentHealth` | A client-observed checkpoint for the two **active** fighters. Each value must be ≤ the host's current HP, and both must not be 0. The host applies them, increments `turn` and resolves KOs (below). |
| `swap` | `phase: command` (voluntary) or `send_in` (forced) | `intentId, turn, holobotId` | The target must be on the team, alive and not active. A voluntary swap benches the active fighter at its host HP and uses one of `voluntarySwapLimit`. A forced send-in uses none. `phase` returns to `command`. `turn` increments. **No HP changes.** |
| `settle` | `phase: over`, not expired | `combosCompleted, perfectDefenses` | Outcome from the host `winner`. One reward quote. Writes `finalVitals` for all three bots. Terminal replay pays nothing twice. |
| `cancel` | `issued` or `active` | `matchId` | Before start: one refund of the one charge. After start: a forfeit that writes the host-held vitals. No client HP. |

**KO resolution after a `report`:**

- **Opponent active at 0:** that slot becomes `ko`, and the host sends in the
  CPU team's next living slot. If none is left, `phase: over` and `winner:
  player`.
- **Player active at 0:** that slot becomes `ko`. If a living bench fighter
  remains, `phase: send_in`; while in send_in, only `swap` is legal. If none is
  left, `phase: over` and `winner: opponent`.

**Refusal precedence for `report` and `swap`:**

0. **Structure.** A malformed request is refused as `invalid_request` before
   anything else, by both the schema and the host's field whitelist. A request
   with no `turn` falls here.
1. **Intent replay.** The same `intentId` with an identical body returns the
   **current** match, `alreadyProcessed: true` and the original echo. The same
   `intentId` with a different body is refused as `request_conflict`.
2. **Phase checks:**
   - `ready`, or a terminal state: `invalid_state`.
   - Expired: `match_expired`.
   - `report` during `send_in`: `send_in_required`.
3. **Turn check:** a turn other than `battle.turn` is refused as
   `turn_mismatch`.
4. **Swap target checks**, in order: `not_on_team`, `fighter_ko`,
   `fighter_active`, `swap_limit`.

`settle` before `over` is refused as `not_over`. A refusal never changes any
host state, and the turn does not move.

**Idempotency:**

| operation | mechanism |
|---|---|
| `issue` | `requestId` plus an identity hash of `[tierId, paymentMethod, ...holobotIds]` (as in arena-match-1) |
| `report`, `swap` | `intentId` plus `turn` |
| `settle`, `cancel` | terminal replay |

A client persists the pending request and retries the same body. It never
applies a swap or report locally before the host replies.

## Trust boundary (stated plainly)

`report` has the same trust model as arena-match-1 `settle`: the bout is a
client-observed CPU sim, and the host binds and clamps what the client reports.
HP can only go down, never above the host value, and never both sides to zero.
The host does **not** prove that the combat happened. This proposal does not
claim more than #120 does.

The roster (`swap`), the bench vitals, the CPU send-in, the turn, the outcome,
the charge and the rewards are all decided by the host. A later lane can replace
`report` with host simulation over `duel-inputs-1` command logs (`duel-sim-1`
already models 2–6 actors with bench and deploy) without changing the
team/slot/swap shape. In duel-sim-1 vocabulary, a forced send-in is a "deploy"
of the first surviving bench actor, and benched fighters are actors with
`deployed: false`. Note one difference: duel-sim-1's prototype regenerates the
bench, but this contract says `benchRegen: none` until Pak rules otherwise.

## Fixture

`lifecycle.json` (21 steps: 15 accepted, 6 refused) is **hand-authored. No host
produced it.**

- **The path:** resume (empty) → issue → start → report (opponent KO, host sends
  in the next CPU slot) → voluntary swap → swap replay → report (player KO,
  send_in) → forced send-in → report (opponent KO) → report (player KO,
  send_in) → forced send-in → report (all CPU KO, over) → settle → settle
  replay → resume.
- **Known-bad refusals:**
  - swap before start: `invalid_state`
  - **swap without a turn**: `invalid_request` (the schema refuses it too)
  - stale turn: `turn_mismatch`
  - **swap to a KO'd fighter**: `fighter_ko`
  - report during send_in: `send_in_required`
  - settle before over: `not_over`

**The test asserts:**

- Every accepted request and reply validates.
- One `matchId`, one `entryReceipt`, identical in every projection.
- Snapshots stay frozen.
- `turn` goes up by exactly one per accepted intent.
- Replays and refusals change nothing.
- HP never rises, a swap changes no HP, bench HP is frozen while benched, and a
  KO is final.
- A KO forces a send-in, and a forced send-in uses no voluntary swap.
- The CPU send-in is the next living slot.
- Settle writes all three bots' host vitals.
- The schema refuses client HP, STA or level fields, `benchIndex` swaps, wrong
  team sizes, duplicate bots, client-named opponents, per-fighter charges and
  incoherent states.
- The arena-match-1 schemas and fixture are unchanged, and the two versions
  never cross.

## Pak calls (placeholders in the fixture)

1. **Swap timing.** Is a voluntary swap allowed at any `command` turn, and what
   is `voluntarySwapLimit`? The fixture uses 2. Does a voluntary swap give the
   CPU a free hit?
2. **Bench regen.** The proposal is `none`. Any regen would be a host-owned rule
   with a new rules version, never client-side.
3. **3v3 entry price.** The fixture uses the 1v1 rookie fee (50 Holos, or 1
   pass), charged once.
4. **Rewards.**
   - The reward quote (the fixture reuses rookie 1v1 numbers).
   - Who gets EXP (the fixture gives each bot that took the field the full
     `awardedExp`).
   - Which blueprint drops (the fixture uses the CPU lead's).
5. **CPU team selection.** Who is on it from the tier pool, and in what order.
6. **STA.** It is not in the contract. Should the host ever carry STA across
   bouts?

## The runtime lane must still

- Implement `arena-match-3v3-1` dispatch in `transactArenaMatch`, with its own
  record validator (three `finalVitals` entries) and an `a3_` id generator.
- Use the shared lease and activity guards, and `requireLivingVitals` for all
  three bots.
- Store intents for replay under `arenaMatches/{uid}/intents/{intentId}`, with
  an identity hash.
- Produce an emulator-generated fixture to replace this hand-authored one, plus
  emulator tests and a deploy plan.
- Decide the 1v1 `resume` behavior when it finds a 3v3 lease.
