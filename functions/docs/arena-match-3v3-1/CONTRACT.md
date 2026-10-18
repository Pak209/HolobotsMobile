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

Rule 1, and exactly where it stops. **The host decides:**

- the active slot, the turn and the phase;
- the legality of every swap;
- the CPU send-in;
- the one entry charge and the frozen reward quote.

The host **stores** every fighter's vitals. Clients send intents and render the
reply.

Two inputs are **client-asserted**, exactly as in arena-match-1 (#120). The host
stores and bounds them but **does not decide or prove** them:

- **Bout HP**, from `report`. The host refuses (`invalid_request`) a value above
  its stored HP for that fighter, or both sides at 0. Otherwise it stores the
  values as reported, and derives the winner from its stored vitals.
- **Performance counts**, from `settle`, in 0..`maxPerformanceEvents`. They scale
  the reward quote.

See "Trust boundary" below, and Pak call 1: whether to accept client-asserted
bout HP for 3v3 at all. This proposal does not make a reported victory
authoritative.

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
  - There is no `combat` bag in this version. The client-observed bout sim
    needs frozen combat stats. The runtime lane adds them as a **closed** shape
    in an amendment, so no open object can smuggle STA, HP, level or a charge
    past the schema.
- **`battle`.** `{turn, phase, activeSlot, opponentActiveSlot, voluntarySwapsUsed, winner}`.
  `phase` is one of `ready`, `command`, `send_in` or `over`. `winner` is
  non-null exactly in `over`.
- **`entryReceipt`.** One object: the **one** entry charge for the whole match.
  Its `amount` equals the frozen `rules.entryFeeHolos` (tokens) or
  `rules.entryFeePasses` (pass). The client never assumes a price. There is no
  per-fighter charge field. The schema is `additionalProperties: false` at the
  match and slot level, so an `entryReceipts` array or a slot-level receipt fails
  validation.
- **`rules`** (`arena-3v3-rules-1`). The frozen quote:
  - the Holos fee and the pass price;
  - the rewards and bonuses;
  - `voluntarySwapLimit`;
  - three constant policies:
    - `benchRegen: "none"`: benched HP never changes.
    - `sendIn: "forced_on_ko"`.
    - `opponentSendIn: "next_alive_slot"`.
- **`settlementReceipt`.** Null until the match is terminal. It then holds the
  outcome, one settlement or refund, and `finalVitals` with all three team bots,
  which are written to the account's `holobotVitals` ledger.
- **Top-level `intent`.** For `report` and `swap`, an echo
  `{intentId, operation, appliedTurn}`. Null for every other operation.

**Coherence the schema enforces.** The reply schema has **26** conditional
(`if`/`then`/`else`) rules: 20 at the match level, 3 on the settlement
receipt, 1 on a slot, 1 on the battle, and 1 at the root.

A one-off mutation sweep deleted each rule, then each `then` and `else`
branch, then each clause inside them: 118 mutants in all. **113 fail the
suite.** The 5 survivors are equivalent, because a stricter rule always
refuses the same input:

- the battle `else` and its `winner: null` clause (the slot couplings already
  forbid a winner outside `over`);
- the refund's `settlement: null` clause (the win/loss rule's `else` repeats
  it);
- the settled outcome enum (the winner→outcome rules repeat it);
- the forfeit `winner: null` clause (the phase coupling repeats it).

The sweep is not part of `npm test`.

- **KO and HP:** `ko` exactly when HP is 0.
- **Winner and phase:** `winner` is non-null exactly in `over`.
- **Active slots:**
  - In `ready` and `command`, `team[activeSlot]` is the only active fighter.
  - In `send_in`, `team[activeSlot]` is KO'd, no fighter is active, and a
    living bench fighter remains.
  - While the match is undecided, `opponentTeam[opponentActiveSlot]` is the
    CPU's only active fighter.
- **Winner and KO:**
  - `winner: player` means every CPU fighter is KO'd and at least one player
    fighter lives.
  - `winner: opponent` means the mirror.
  - A double wipe can never carry a winner.
- **State and phase:**
  - `issued` means `ready` and turn 0.
  - `active` is never `ready`.
  - A terminal state carries `closedAtMs` and a receipt.
  - `settled` means `over` and a start time.
- **Outcome:**
  - A settled outcome is the host winner (`player` → `win`, `opponent` →
    `loss`), and a loss pays no Holos and no blueprint.
  - `cancelled` and `expired` close only as `forfeit` or
    `cancelled_before_start`.
  - `cancelled_before_start` is unstarted (`ready`, turn 0) and refunds.
  - `forfeit` is after start and before any winner, in `command` or `send_in`,
    and carries no performance report.
- **Receipts:**
  - Win and loss carry a settlement and a report, and never a refund.
  - A forfeit carries vitals for all three bots and nothing else.
  - A refund carries no settlement, report or vitals.
- **Envelope:** a reply with a match carries its `a3_` id. A reply without a match
  carries a null id and no intent echo.

## Operations

| op | legal when | carries | host does |
|---|---|---|---|
| `issue` | no open Arena lease and no other activity | `requestId, tierId, paymentMethod, holobotIds[3]` | Validates 3 distinct, uniquely owned, living bots and freezes each as a snapshot with ledger HP (no full-HP default). Picks the CPU team from the tier pool. Charges **once**. `state: issued`, `phase: ready`, `turn: 0`. |
| `start` | `issued`, not expired | `matchId` | `state: active`, `phase: command`. |
| `resume` | always | optional `matchId` | Returns the current projection, `alreadyProcessed: true`. |
| `report` | `phase: command` | `intentId, turn, activeHealth, opponentHealth` | A **client-asserted** checkpoint for the two **active** fighters. A value above the host's stored HP for that fighter, or both values at 0, is **refused** as `invalid_request`. This is the 1v1 rule: `arenaMatchStore` refuses `playerFinalHealth` above the entrant's HP, and a both-zero settle, the same way. Otherwise the host stores the values as reported, increments `turn` and resolves KOs (below). It touches no other slot. |
| `swap` | `phase: command` (voluntary) or `send_in` (forced) | `intentId, turn, holobotId` | The target must be on the team, alive and not active. A voluntary swap benches the active fighter at its host HP and uses one of `voluntarySwapLimit`. A forced send-in uses none. `phase` returns to `command`. `turn` increments. **No HP changes.** |
| `settle` | `phase: over` (also after `expiresAtMs`; see "Expiry"), and at least `ARENA_MIN_SETTLE_MS` (1000 ms) after start (otherwise `too_fast`, the same #120 plausibility floor, not proof of combat) | `combosCompleted, perfectDefenses` (client-asserted, 0..`maxPerformanceEvents`) | Outcome from the host `winner`. One reward quote, scaled by the asserted counts. Writes `finalVitals` for all three bots. Terminal replay pays nothing twice. |
| `cancel` | `issued`, or `active` in `command` or `send_in` | `matchId` | Before start: one refund of the one charge. After start, before a winner exists: a forfeit that writes the host-held vitals. In `over` it is refused as `settle_required`: a decided result cannot become a forfeit. No client HP. |

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
   - `ready`, `over` (the winner is decided), or a terminal state:
     `invalid_state`.
   - Expired: `match_expired`.
   - `battle.turn` at the cap (1000, the schema maximum): `turn_limit`.
     Cancel, which gives a forfeit, stays legal.
   - `report` during `send_in`: `send_in_required`.
3. **Turn check:** a turn other than `battle.turn` is refused as
   `turn_mismatch`.
4. **Report HP check** (`report` only): `activeHealth` above the host's stored
   HP for the player's active fighter, `opponentHealth` above the stored HP for
   the CPU's active fighter, or both at 0 is refused as `invalid_request`.
5. **Swap target checks**, in order: `not_on_team`, `fighter_ko`,
   `fighter_active`, `swap_limit`.

`settle` before `over` is refused as `not_over` before expiry and as
`match_expired` after it. `cancel` in `over` is refused as `settle_required`.
A refusal never changes any host state, and the turn does not move.

**Expiry.** `report`, `swap` and `start` after `expiresAtMs` are refused as
`match_expired`, so no bout outcome can change after expiry.

A match that reached `over` before expiry already has its winner. `settle`
therefore stays legal for it after expiry, and records `state: settled` with
`closedAtMs > expiresAtMs`. That keeps the account's shared Arena lease from
being stranded open: cancel is refused in `over`, and a decided result can
never expire into a forfeit.

An undecided match that expires is closed by `cancel`. That gives a forfeit
(`state: expired`) after start, or a refund before start, as in 1v1.

The test's late-settle positive control pins this. It reports `{0, 0}`
performance counts, because the proposal zeroes asserted counts on a late
settle; that is pending Pak call 8.

**Idempotency:**

| operation | mechanism |
|---|---|
| `issue` | `requestId` plus an identity hash of `[tierId, paymentMethod, ...holobotIds]` (as in arena-match-1) |
| `report`, `swap` | `intentId` plus `turn` |
| `settle`, `cancel` | terminal replay |

A client persists the pending request and retries the same body. It never
applies a swap or report locally before the host replies.

## Trust boundary (stated plainly)

`report` has the same trust model as arena-match-1 `settle`. The bout is a
client-observed CPU sim. The host stores what the client reports. It refuses
only an impossible report: HP above the stored value, or both sides at 0. It
**does not decide** the reported HP. Nothing bounds damage per report. A modified client can report
`opponentHealth: 0` three times and keep its own HP, and the host will derive
`winner: player` from that. The host does **not** prove that the combat
happened.

`combosCompleted` and `perfectDefenses` are client-asserted reward multipliers,
capped at `maxPerformanceEvents`. With the fixture rules, 25 and 25 scale EXP
and SYNC by up to 4.75x. That is the same mechanism and cap as the 1v1
`rewards()`. The only plausibility check is the `too_fast` floor, which settle
keeps from #120. This proposal claims no more than #120 does, which is that
reported victory is not authoritative.

What the host does decide:

- the roster (every `swap` is legality-checked);
- the bench vitals (frozen; no regen);
- the CPU send-in;
- the turn and the phase;
- the one entry charge;
- the frozen reward quote;
- the winner, derived from its stored vitals. The host stores and bounds the
  reported HP, but it does not decide that HP.

A later lane can replace
`report` with host simulation over `duel-inputs-1` command logs (`duel-sim-1`
already models 2–6 actors with bench and deploy) without changing the
team/slot/swap shape. In duel-sim-1 vocabulary, a forced send-in is a "deploy"
of the first surviving bench actor, and benched fighters are actors with
`deployed: false`. Note one difference: duel-sim-1's prototype regenerates the
bench, but this contract says `benchRegen: none` until Pak rules otherwise.

## Fixture

`lifecycle.json` (25 steps: 15 accepted, 10 refused) is **hand-authored. No host
produced it.**

- **The path:** resume (empty) → issue → start → report (opponent KO, host sends
  in the next CPU slot) → voluntary swap → swap replay → report (player KO,
  send_in) → forced send-in → report (opponent KO) → report (player KO,
  send_in) → forced send-in → report (all CPU KO, over) → settle → settle
  replay → resume.
- **Known-bad refusals:**
  - swap before start: `invalid_state`
  - **swap without a turn**: `invalid_request` (the schema refuses it too)
  - **report with HP above the stored value** (ACE 200 against a stored 172):
    `invalid_request`
  - **report with both sides at 0**: `invalid_request`
  - stale turn: `turn_mismatch`
  - **swap to a KO'd fighter**: `fighter_ko`
  - report during send_in: `send_in_required`
  - settle before over: `not_over`
  - swap after the match is decided: `invalid_state`
  - cancel after the match is decided: `settle_required`

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
  team sizes, duplicate bots, client-named opponents and per-fighter charges.
- Every refused report breaks the stored-HP rule. Both report refusals are
  well-formed requests, so it is the host, not the schema, that refuses them.
- The schema refuses every coherence violation listed above. The mutation sweep
  results for its 26 conditional rules are under "Coherence".
- Positive controls build the paths the lifecycle does not walk:
  - a player wipe (ACE KO'd from the last send-in state);
  - a settled loss;
  - a mid-match forfeit;
  - a refund before start;
  - a late settle after expiry;
  - a pass-paid entry at `entryFeePasses`.
- Every accepted step is checked with the previous accepted state:
  - Only a report moves HP, and only on the two reported slots. A CPU fighter
    sent in on a KO keeps its benched HP.
  - A swap never touches the CPU team.
  - The CPU switches only on a KO.
  - In send_in, a swap is the only accepted intent.
  - A reused `intentId` is only ever a byte-identical replay.
- The arena-match-1 schemas are pinned by sha256 to `origin/main` 3b1e790,
  together with the fixture. The two versions never cross.

## Pak calls (placeholders in the fixture)

1. **Rule 1 for 3v3.** Accept client-asserted bout HP for 3v3, matching #120's
   CPU practice? Or hold the 3v3 runtime until a host sim over `duel-inputs-1`
   command logs (`duel-sim-1`) decides the bouts? This call gates the runtime
   lane.
2. **Swap timing.** Is a voluntary swap allowed at any `command` turn, and what
   is `voluntarySwapLimit`? The fixture uses 2. Does a voluntary swap give the
   CPU a free hit?
3. **Bench regen.** The proposal is `none`. Any regen would be a host-owned rule
   with a new rules version, never client-side.
4. **3v3 entry price.** The fixture uses the 1v1 rookie fee (50 Holos) and
   `entryFeePasses: 1`, charged once. Both are host-frozen in `rules`.
5. **Rewards.**
   - The reward quote (the fixture reuses rookie 1v1 numbers).
   - Who gets EXP (the fixture gives each bot that took the field the full
     `awardedExp`).
   - Which blueprint drops (the fixture uses the CPU lead's).
6. **CPU team selection.** Who is on it from the tier pool, and in what order.
7. **STA.** It is not in the contract. Should the host ever carry STA across
   bouts?
8. **Performance counts in 3v3.** Keep the client-asserted 0..25 multipliers
   (the 1v1 parity shown here), make them host-derived, or drop them for 3v3?
   Is the 1000 ms `too_fast` floor enough for a three-bout match? Should a
   late settle after expiry honor the asserted counts, or zero them? The
   proposal is to zero them.
9. **Buddy.** DECISIONS #71 places a BUDDY strip above the bench. Should the 3v3
   admission freeze a Buddy Unit snapshot from the account's host `buddyUnits`
   inventory into the reply? Today the reply carries none, and the lite client
   shows an honest empty strip.

## The runtime lane must still

- Implement `arena-match-3v3-1` dispatch in `transactArenaMatch`, with its own
  record validator (three `finalVitals` entries, plus every coherence rule
  above) and an `a3_` id generator.
- Pin a closed `combat` shape for the bout sim in a contract amendment.
- Use the shared lease and activity guards, and `requireLivingVitals` for all
  three bots.
- Store intents for replay under `arenaMatches/{uid}/intents/{intentId}`, with
  an identity hash.
- Produce an emulator-generated fixture to replace this hand-authored one, plus
  emulator tests and a deploy plan.
- Decide the 1v1 `resume` behavior when it finds a 3v3 lease.
