# W59 deterministic TypeScript core — `duel-sim-1`

Standalone, unwired prototype. `simulate(trustedRulesSnapshot, seed, assembledLog)` runs at **30 Hz**, consumes a `duel-inputs-1` command log and returns the initial state hash, input hash, an ordered hash/events entry for every executed tick, and final state/hash. There is no callable, clock, database, reward, network, Unity code or existing resolver change. Host integration must load rules from its own immutable admission; **never pass client-supplied stats to this function**.

The user's W59 direction selects TypeScript under `functions/src/sim/`, overriding the merged #101/#102 Rust/WASM packaging recommendation for this lane. This is not a shared binary or proof of Unity parity. A future Unity twin must consume these vectors and match every tick; independently maintained equations remain a drift risk. Neither transport JSON Schema nor `duel-receipt-2` is introduced here. The current `duel-receipt-1`, legacy/resolver routing and flip hold stay unchanged.

## Contract boundary and capacity

`types.ts` describes the immutable rules, initial actor-instance records, command events, state and tick events. The log here is **assembled** `{schemaVersion:"duel-inputs-1", events:[...]}`; it is not the append/session/chunk envelope in the design. Authentication, server time fences, sealed chunk ranges, late input, device fencing, ownership, neutral-tail completion, storage and payouts belong to the later host endpoint. No claim that post-match logs alone prevent hindsight cheating.

Rules supply all movement, shape, move timing, costs, damage, guard, regeneration, CPU cadence and timeout choices. No production balance defaults or 12-bot stat mapping is invented. JSON vector rules are synthetic testing values. One deployed actor per side, up to three actors per side; instance IDs are ASCII `[A-Za-z0-9_-]{1,64}` and unique even for mirror bots. CPU ownership is per team. Commands cannot address CPU actors.

Capacity bounds: 2–6 actors, 1–7,200 ticks, 8,192 commands total, at most four commands per tick, axes −127…127, arena half-size at most 1,000,000 mm, radius 1…arena half-size, speed up to 100,000 mm/tick, integer resources/damage/cost/variance ≤1,000,000,000. The 7,200-tick implementation capacity is **not approval of a 240-second match policy**. A host-issued duration must be separately approved; no live mode is admitted. Canonical values are limited to 2 MiB, 100,000 nodes, depth 32, array length 8,192, object keys 128, ASCII string length 256. Sparse arrays, non-finite/fractional/unsafe integers, negative zero, unknown fields/actions, wrong targets, reordered or gapped seq values and >4 commands/tick reject before replay. Combat-illegal but structurally legal commands produce explicit denial events.

Nine actions: `move`, `strike`, `heavy`, `finisher`, `guard_down`, `guard_up`, `disengage`, `deploy`, `select_target`. Ticks are nondecreasing, seq is contiguous from zero. Move requires x/z; attacks/select/deploy require target; other extra fields are forbidden. Full schema/version review remains a separate lane.

## Deterministic order and arithmetic

1. Expire move/guard controls. Refresh period is supplied as `heldTicks`, bounded 1–15.
2. Apply command seq order, then CPU commands in ascending ASCII actor-instance ID order. CPU stream 1 chooses a move uniformly from strike/heavy/finisher at its supplied cadence; outside range it approaches on the dominant cardinal axis.
3. Integrate integer mm positions. Diagonal movement uses L1 normalization `max(127, |x|+|z|)` and truncation toward zero, not square roots. Clamp the circle within arena bounds. Swept-circle contact blocks both proposed movements, preventing single-tick tunnelling.
4. Evaluate scheduled contacts against the same pre-contact state. Stream 2 chooses hit chance, stream 3 symmetric integer damage variance. Guard multiplies damage by the supplied basis-point factor; repeated refresh does not restart its supplied guard window. Apply contact outcomes in actor order, allowing simultaneous trades/mutual KO. Interrupt cancels a target's later pending attack; same-tick contacts survive.
5. Clamp resources; KO clears held input/attack. Regen happens when not attacking/stunned (including the bench); disengage chooses the supplied extra rate. Successful attack consumes cost at start, builds supplied SYNC on a hit, and never refunds on cancellation. Movement/disengage/guard can cancel only after the move's supplied cancel tick; recovery remains spent.
6. Auto-deploy the first surviving actor by ID, using its current host-pinned/previously simulated bench position; overlap blocks deployment until clear. Manual deploy uses the same collision rule and requires a living active actor with no pending attack/recovery. Deployment does not reset HP/resources. This explicit prototype behavior is not a claim of parity with current Unity feel.
7. Terminal KO wins if only one team survives; mutual KO draws. At the supplied cap, either draw or compare total remaining team HP according to the snapshot. Hash state after that tick's terminal decision. Future commands after a terminal tick are structurally checked but not executed.

All externally supplied values and stored numeric state are safe JS integers. `mulDiv` uses checked signed-64-bit multiplication, BigInt division toward zero and safe-integer conversion. Circle and swept-circle geometry uses **exact arbitrary-precision BigInt intermediates**, because cross-multiplied swept distances can exceed signed 64 bits within the bounded coordinate domain. This is a deliberate TypeScript-prototype difference from the design's checked-i64-only recommendation; a Unity twin needs equivalent BigInteger arithmetic or a separately versioned bounded algorithm. No float trigonometry, physics query, wall clock or platform random contributes to simulation. Safe bounded resource sums remain below 2^53.

`select_target` records the selection, but attack commands still require an explicit valid target. CPU has no learned policy, pathfinding, auto finisher preference or balance tuning. There is no production host stat adapter or claim of the shipped 12 movesets/feel mapping.

## Canonical encoding and RNG

Canonical encoding is binary and independent of JSON whitespace/property insertion order:

| Tag | Encoding after tag |
|---|---|
| 0 | null, no payload |
| 1 / 2 | false / true, no payload |
| 3 | signed i64 little endian; accepted range is JS safe integer, excluding −0 |
| 4 | u32 LE ASCII byte length, then bytes; no Unicode normalization |
| 5 | u32 LE element count, each encoded value in array order |
| 6 | u32 LE property count, then encoded key/value pairs sorted by ASCII key |

Rules fighters are normalized by instance ID before hashing. State includes simVersion, rulesHash, seed, tick, terminal winner/reason and every mutable fighter field (positions/facing, held controls, attack schedule, cooldown/stun, target, deployment and resources). Future command history is independently pinned by `inputHash`. The initial tick is −1. Each tick hash is SHA-256 of these canonical state bytes; this is a consistency digest, not authentication. `canonicalBytes` is exported for the twin's byte-level comparisons.

RNG bytes exactly: UTF-8 `duel-sim-1/rng` (no terminator) + decoded 32-byte lowercase-hex seed + LE u32 stream ID + tick + event index + draw index. Read digest bytes 0–3 as LE u32. For bound n, reject words ≥`floor(2^32/n)*n`, increment only drawIndex, then modulo n. Stream IDs: 1 CPU choice, 2 hit chance, 3 damage variance. Event index is actor's sorted snapshot index; no rejected input or render event consumes a shared stream. A 65,536-rejection safety cap fails rather than hanging.

Independent Python `hashlib.sha256`/`struct.pack('<IIII',...)` microvectors:

- zero seed, counters 1/0/0/0 → digest `2aa66864b9e524a1b7343be4f8ac7454877d3275096d2a2f97338138acb26037`, word **1684579882**.
- seed bytes 00…1f, counters 2/31/7/4 → digest `94082278924cd38f0dab9cd2dbe57b8238513dc3ef52a9801d9f8e9926ca7201`, word **2015496340**.

## Frozen vectors and verification

`functions/scripts/fixtures/duel-sim/vectors.json` contains **24 scripted bouts**, complete rules/seed/log and frozen initial/final/per-tick hashes. Covers neutral, strike, heavy, finisher, insufficient SYNC/STA, guard expiry/release, miss/range, held expiry, diagonal movement, collision, cancel/denied cancel, interruption, mutual KO, CPU, variance, manual/automatic deployment, target selection and disengage regeneration.

These are candidate-produced regression fixtures, **not independent Unity parity evidence**. Tests never rewrite them. Expected arithmetic outcomes, canonical bytes and RNG microvectors are independently asserted in `test-duel-sim.mjs`. Changes to semantics/encoding require deliberate vector review and simVersion compatibility decisions; do not blindly regenerate failed expectations.

Run `npm run build`, `npm run test:duel-sim` and `npm test` from functions. W59 has 33 focused tests: 24 vector replays plus nine independent/adversarial test groups. Native/Unity parity, 10,000-seed platform matrix, producer feel review, replay CPU/memory acceptance, host integration, transport schema and live migration remain future gates. No editor/deploy/account use or flag change.

## Offline movement version 2 (DECISIONS #70)

`duel-sim-2` is an explicit opt-in **offline** rules snapshot. Existing `duel-sim-1`
inputs, state shapes and 24 frozen bouts (555 tick hashes) are unchanged. The dormant
host verification seam explicitly rejects v2. Nothing issues, settles or pays from
v2, and the C# twin still implements v1 only; a future parity lane must port these
rules and match all movement hashes before wiring it to a host mode.

V2 adds required `movement: {[fighterInstanceId]: {speedMmPerSecond,
preferredRangeMm}}`. Each fighter's old `speedMmPerTick` must be 0 (no two competing
speeds). Every move's `rangeMm` and each preferred range must be one of Close 1500,
Mid 4000, Long 8000. Input logs remain `duel-inputs-1`, with no additional actions.
The rules hash pins every number. `simVersion` in the state is `duel-sim-2`.

The exact provisional producer table is mirrored from Unity's
`Assets/Battle/Scripts/Combat/Movement/SpeedTable.cs:DefaultEntries` (read-only
working-tree source inspected 2026-10-17; the movement brief itself specifies only
1.6–3.2 m/s and fast/slow groupings). These are **placeholders, not approved balance**:

| Bot | Run m/s | Preferred tier |
|---|---:|---|
| ACE | 3.2 | Mid |
| WOLF | 3.0 | Close |
| HARE | 3.2 | Close |
| SHADOW | 3.0 | Close |
| KEN | 2.6 | Close |
| TSUIN | 2.6 | Close |
| WAKE | 2.4 | Mid |
| JUSAN | 2.4 | Close |
| KURAI | 2.4 | Mid |
| ERA | 2.2 | Mid |
| GAMA | 2.0 | Close |
| KUMA | 1.6 | Close |
| TORA | 1.6 | Close |

- An out-of-range strike/heavy/finisher queues a move and closes. Resource
  availability is checked at request and again at execution; attack costs are
  charged only when the windup starts. Dash can spend the last STA on the way,
  causing an explicit `insufficient_stamina` denial at execution, never underflow.
- Idle fighters keep 90% of their preferred reach. `disengage` backs off beyond
  the opponent's longest reach by 1 integer mm and holds when already outside;
  it never approaches an opponent. Directional `move` temporarily overrides
  autonomy. Guard stays planted. New attacks re-engage. Queues cancel on manual
  movement, guard, switch, inactive target or KO.
- An autonomous gap of at least 4000 mm starts a dash if cooldown and STA permit.
  It commits its direction for 9 ticks, travels 4000 mm on an unobstructed axis,
  spends 1 STA at start and sets `ready = tick + ceil(360000 / speedMmPerSecond)`.
  Cooldown thus equals 120 ticks at 3 m/s, 113 at 3.2, 225 at 1.6. Collision,
  ring bounds or a hit interruption can shorten it. A hit cancels its remainder.
  At 0 STA running continues; running is free.
- Town ring means **12,000 mm radius**, centred on snapshot origin; fighter
  centres stay inside `12000 - radiusMm`. V2 requires `arenaHalfSizeMm=12000`.
  Arena's 15.5 m variant remains a later version/config change, not inferred here.
  Squared distances and radial projection use BigInt with ceiling integer square
  roots. Projection/truncation is conservative; diagonal travel can lose integer
  millimetres. Running carries `/30` remainders; a dash uses cumulative `/9`
  displacement. Negative zero is normalized before hashing.
- Each fighter's hashed `movement` state contains `queued`, `dashReadyTick`,
  `dashTicks`, `dashX`, `dashZ`, `runRemainder`. Queue stores `{move,target}` or null.
  All fighters choose movement against the same pre-movement positions, followed
  by the existing swept collision/contact/resource phases. Damage, RNG and timing
  rules are unchanged; speed does not scale attacks.

`movement-vectors.json` adds eight frozen bouts beside the untouched v1 file:
fast-vs-slow chase, slow-vs-fast escape, long-range opener, dash-out-of-STA,
zero-STA running, diagonal ring bound, Mid keep-range, and Long back-off.
`generate-movement-vectors.mjs` is an explicit authoring tool, never run by tests.
