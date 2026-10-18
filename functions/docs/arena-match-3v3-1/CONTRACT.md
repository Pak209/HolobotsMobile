# arena-match-3v3-1: Arena 3v3 contract proposal

**Status: PROPOSAL. Schema and fixture only. The runtime is HELD for a later lane.**

**Default decision** (producer, 2026-10-17; Pak may override): **client-asserted
bout HP is not accepted.** The 3v3 runtime waits for host simulation. It stays
HELD until a host-resolver lane (`arena-host-resolver-1`) can simulate bouts on
the host. This is hard rule 1, the same class as security finding S1.

No host code changes in this PR. The deployed `arenaMatchHost` checks
`schemaVersion` first, so today it refuses every `arena-match-3v3-1` request as
`invalid_request` before it reads Firestore. The contract test asserts this.

Files:

- `Schemas/arena-match-request-3v3-1.json`: the requests.
- `Schemas/arena-match-3v3-1.json`: the reply projection.
- `functions/scripts/fixtures/arena-match-3v3/lifecycle.json`: one hand-authored lifecycle with known-bad refusals.
- `functions/scripts/test-arena-match-3v3-contract.mjs`: Ajv validation and lifecycle invariants. It runs in `npm test` and uses the functions-local `ajv`.

Rule 1: **the host decides.**

- every fighter's vitals, and so every KO and the winner (under the default
  decision, from host-simulated bouts);
- the active slot, the turn and the phase;
- the legality of every swap;
- the CPU send-in;
- the one entry charge and the frozen reward quote.

Clients send intents and render the reply. **No client message decides a bout.**

- **Bout HP.** Under the default decision, bout HP comes only from the host
  resolver (`arena-host-resolver-1`). The `report` request in this proposal is
  kept only as a **defensive shape check**, and it is **not the authority**: a
  value above the host's stored HP, or both sides at 0, is refused as
  `invalid_request` (the same shape rule as 1v1 settle). A report the shape
  check accepts still decides nothing. The resolver lane is expected to replace
  or amend `report`, for example with a `duel-inputs-1` command log the host
  simulates.
- **Performance counts**, from `settle`, in 0..`maxPerformanceEvents`, are still
  client-asserted reward multipliers (#120 parity). Whether 3v3 keeps them is
  Pak call 8.

The fixture's bout values are **hand-authored stand-ins for host-resolved
bouts**. They are not reports the host accepted. See "Default decision and trust
boundary" below.

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
| `report` | `phase: command` | `intentId, turn, activeHealth, opponentHealth` | **Defensive shape check only. Not the authority, and HELD with the runtime.** A value above the host's stored HP for an active fighter, or both values at 0, is **refused** as `invalid_request`. This is the 1v1 shape rule: `arenaMatchStore` refuses `playerFinalHealth` above the entrant's HP, and a both-zero settle, the same way. Under the default decision the bout itself is resolved by the host (`arena-host-resolver-1`). The host then stores **its own** vitals, increments `turn` and resolves KOs (below). Only the two active slots change. |
| `swap` | `phase: command` (voluntary) or `send_in` (forced) | `intentId, turn, holobotId` | The target must be on the team, alive and not active. A voluntary swap benches the active fighter at its host HP and uses one of `voluntarySwapLimit`. A forced send-in uses none. `phase` returns to `command`. `turn` increments. **No HP changes.** |
| `settle` | `phase: over` (also after `expiresAtMs`; see "Expiry"), and at least `ARENA_MIN_SETTLE_MS` after start. On `main` since #143 (S1 bounded mitigation), that floor is 20,000 ms: a win sooner is `too_fast`, and a loss that soon closes but pays nothing. It is a plausibility floor, not proof of combat. | `combosCompleted, perfectDefenses` (client-asserted, 0..`maxPerformanceEvents`) | Outcome from the host `winner`. One reward quote, scaled by the asserted counts. Writes `finalVitals` for all three bots. Terminal replay pays nothing twice. |
| `cancel` | `issued`, or `active` in `command` or `send_in` | `matchId` | Before start: one refund of the one charge. After start, before a winner exists: a forfeit that writes the host-held vitals. In `over` it is refused as `settle_required`: a decided result cannot become a forfeit. No client HP. |

**KO resolution after a host-resolved bout step:**

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
4. **Report shape check** (`report` only; defensive, not the authority):
   `activeHealth` above the host's stored HP for the player's active fighter,
   `opponentHealth` above the stored HP for the CPU's active fighter, or both at
   0 is refused as `invalid_request`.
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

## Default decision and trust boundary (stated plainly)

**Default (producer, pending Pak's override): client-asserted bout HP is not
accepted.** The runtime waits for host simulation (`arena-host-resolver-1`).
Under this default:

- a client `report` never decides a bout, a KO or the winner;
- the host derives every KO and the winner only from its own simulated vitals;
- the `report` shape check (refusing HP above the stored value, or both sides at
  0) stays as a defensive guard on malformed input, not as authority.

**Why the default.** If the host accepted reported HP, as #120's 1v1 CPU
practice does, then nothing would bound damage per report. A modified client
could report `opponentHealth: 0` three times, keep its own HP, and be recorded
the winner. That is the same class as security finding S1.

**If Pak overrides** and accepts client-asserted HP at #120 parity, that
weakness applies as stated. The host would store a shape-valid report and derive
the winner from it, without proving that the combat happened. That would
require a contract amendment and an explicit Pak sign-off.

`combosCompleted` and `perfectDefenses` are client-asserted reward multipliers,
capped at `maxPerformanceEvents`. Unbounded, 25 and 25 would scale EXP and SYNC by
up to 4.75x with the fixture rules.

Since #143, `main`'s 1v1 host applies S1 bounded mitigations:

- the 20 s floor;
- a performance clamp by receipt length: at most one combo per 2 s and one
  perfect defense per 3 s;
- a daily cap of 10 paid CPU settles per account. A settle past the cap closes
  the match and writes HP, but pays nothing (`settlement.payoutWithheld`).

The 3v3 runtime must apply the same bounds or stricter. Whether 3v3 keeps the
counts at all is Pak call 8.

What the host does decide:

- the roster (every `swap` is legality-checked);
- the bench vitals (frozen; no regen);
- the CPU send-in;
- the turn and the phase;
- the one entry charge;
- the frozen reward quote;
- every KO and the winner, derived from its own vitals. Under the default
  decision those come from host-simulated bouts, never from a client report.

`arena-host-resolver-1` is expected to replace `report` with host simulation over `duel-inputs-1` command logs (`duel-sim-1`
already models 2–6 actors with bench and deploy) without changing the
team/slot/swap shape. In duel-sim-1 vocabulary, a forced send-in is a "deploy"
of the first surviving bench actor, and benched fighters are actors with
`deployed: false`. Note one difference: duel-sim-1's prototype regenerates the
bench, but this contract says `benchRegen: none` until Pak rules otherwise.

## Fixture

`lifecycle.json` (25 steps: 15 accepted, 10 refused) is **hand-authored. No host
produced it.**

- **The path:** resume (empty) → issue → start → bout step (opponent KO, host
  sends in the next CPU slot) → voluntary swap → swap replay → bout step
  (player KO, send_in) → forced send-in → bout step (opponent KO) → bout step
  (player KO, send_in) → forced send-in → bout step (all CPU KO, over) → settle
  → settle replay → resume.
- **Bout steps.** These use the current `report` wire shape, but their HP values
  are **hand-authored stand-ins for host-resolved bouts**. Under the default
  decision, the host resolver produces these projections; a client report does
  not.
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
- Every refused report breaks the defensive shape rule. Both report refusals are
  well-formed requests, so it is the host, not the schema, that refuses them.
  The shape check is not the authority.
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
  - Only a bout step moves HP, and only on the two active slots. A CPU fighter
    sent in on a KO keeps its benched HP.
  - A KO, send_in or win is read from the host projection, never from request
    values.
  - A swap never touches the CPU team.
  - The CPU switches only on a KO.
  - In send_in, a swap is the only accepted intent.
  - A reused `intentId` is only ever a byte-identical replay.
- The arena-match-1 schemas are pinned by sha256 to `origin/main` 3b1e790,
  together with the fixture. The two versions never cross.

## Pak calls (placeholders in the fixture)

1. **Rule 1 for 3v3: override the default?** The default (producer, 2026-10-17)
   is that client-asserted bout HP is not accepted, and the runtime waits for
   `arena-host-resolver-1` to simulate bouts on the host. Pak may override this
   to accept #120-parity client-asserted HP. That would need a contract
   amendment, and it carries the weakness described in the trust-boundary
   section.
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
   Is `main`'s 20 s S1 floor right for a three-bout match? Should a
   late settle after expiry honor the asserted counts, or zero them? The
   proposal is to zero them.
9. **Buddy.** DECISIONS #71 places a BUDDY strip above the bench. Should the 3v3
   admission freeze a Buddy Unit snapshot from the account's host `buddyUnits`
   inventory into the reply? Today the reply carries none, and the lite client
   shows an honest empty strip.

## The runtime lane must still

- Wait for `arena-host-resolver-1` (the default decision): bouts must be
  simulated on the host before any 3v3 runtime ships.
- Implement `arena-match-3v3-1` dispatch in `transactArenaMatch`, with its own
  record validator (three `finalVitals` entries, plus every coherence rule
  above) and an `a3_` id generator.
- Pin a closed `combat` shape for the bout sim in a contract amendment.
- Apply `main`'s S1 bounded mitigations (#143), or stricter ones: the 20 s settle
  floor, the per-duration performance clamp and the daily paid-settle cap.
- Amend the settlement shape with `payoutWithheld` (`daily_cap` /
  `under_floor`), as the hardened 1v1 settlement now carries. This proposal's
  closed settlement does not yet carry it.
- Use the shared lease and activity guards, and `requireLivingVitals` for all
  three bots.
- Store intents for replay under `arenaMatches/{uid}/intents/{intentId}`, with
  an identity hash.
- Produce an emulator-generated fixture to replace this hand-authored one, plus
  emulator tests and a deploy plan.
- Decide the 1v1 `resume` behavior when it finds a 3v3 lease.
