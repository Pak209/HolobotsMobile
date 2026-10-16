# Real-time duel input-log design — DECISIONS #63.1(b)

2026-10-16 · W43 · **Proposal, documentation only.** No endpoint, flag, schema file, native library or simulator is implemented by this PR. All numerical protocol limits and work estimates below are proposed engineering defaults, not approved economy changes or measured performance.

## Decision and current boundary

Pak accepted long-term real-time combat with host re-simulation of timestamped inputs in Holocity `Documentation/DECISIONS.md` #63.1(b), inspected at `511c7c9f46dbb67a0b9157e6c6f716f49e5e1255`. #63.1(a) separately accepts **plan-then-play for RIVAL battles only now**; practice and zones stay real-time. `HOLOCITY_RIVAL_ISSUE_RESOLVER=1` still requires Pak's word after a play test. This design neither flips it nor claims existing real-time paths are now authoritative.

Host baseline: HolobotsMobile `465e21815801e7dcbbe76655e55f9188a7f4ebfb`, `functions/src/rival/rivalBattleStore.ts` and `functions/src/lib/duelResolver.ts`. Today a new issue defaults to legacy unless the exact resolver flag is `1`; stored mode governs settlement. Resolver mode accepts a batch of strike/heavy/defend/finisher intents, executes at most 120 rounds and emits `duel-receipt-1`; it is not a fixed-tick simulation of movement/guard/contact. See [host #85](https://github.com/Pak209/HolobotsMobile/pull/85) and [Holocity finding #2](https://github.com/Pak209/Holocity/pull/2): presentation-side autonomous contacts are the rationale for replacing authority, not a finding this docs PR fixes.

## One simulation implementation, two deployment artifacts

Recommend a small **Rust integer-only combat core**, source owned in a proposed `HolobotsMobile/shared/duel-sim/`, built from one pinned commit with a pinned toolchain. Host TypeScript is an adapter to its **WebAssembly** artifact; Unity C# is an adapter to the same source's **native C ABI** artifact (macOS dylib, iOS static library). Both adapters exchange canonical bytes and commands; neither duplicates combat equations. Node supports WebAssembly instantiation and Unity supports native plugins; this establishes a plausible integration route, not a verified project build. [Node documentation](https://nodejs.org/learn/getting-started/nodejs-with-webassembly), [Unity native plugin documentation](https://docs.unity3d.com/6000.0/Documentation/Manual/plug-ins-native.html).

The two artifacts are **not byte-identical binaries**. A signed build manifest pins source commit, toolchain, target, core protocol version, rules/content hash and each artifact's SHA-256. Matching output bytes on an adversarial golden corpus is mandatory for every artifact; it is not assumed merely because the source is shared. Unity's native plugin carries no networking/identity/reward code. Host WASM imports no clock, RNG, filesystem or WASI; adapters supply validated inputs and immutable admission state.

Alternatives: two independently maintained TS/C# solvers are rejected because they violate the one-implementation goal and invite drift. Embedding the same WASM binary in Unity would avoid separate compiler targets, but requires selecting/shipping an interpreter/runtime and proving its IL2CPP, platform licensing, memory and performance behavior; that is a fallback feasibility lane, not an assumed Unity feature. Moving the entire host to C# would disrupt the existing TypeScript/Firebase ownership. The Rust route adds build/release work; a bounded prototype must prove macOS/IL2CPP and Node parity before implementation is approved. No new dependency or runtime is installed here.

## Deterministic core boundary

Propose **30 fixed ticks/second**, independent of render frames, Animator speed and Unity FixedUpdate. Full 3D presentation remains interpolated. Simulation owns a small deterministic arena plane: integer X/Z positions in millimetres; integer facing, velocities and integer collision shapes; HP/STA/SYNC in fixed integer milli-units. Use checked signed 64-bit intermediates for combat/geometry, explicit division rounding toward zero, explicit clamps and bounds. No float, PhysX query, wall clock, Animator state, platform trig or unordered map iteration affects results. Presentation can use floats after decoding state. Overflow is a rejected invalid state, not a release-build accident; the RNG alone uses explicitly specified unsigned wrapping arithmetic. Rust's checked versus wrapping operations must be chosen explicitly. [Rust reference](https://doc.rust-lang.org/reference/behavior-not-considered-unsafe.html).

The issued immutable rules snapshot contains **host-authored** movement speeds, ranges, cooldowns, stamina/regen, guard windows, cancel windows, damage/contact ticks and CPU policy. Existing animation DamageFrame events only present feedback; core tick schedules own contact and interruption. Root motion cannot become authoritative movement. Model interrupted strikes, guard timing, disengage regeneration, deployed/benched instance identity, target selection and CPU autonomous behavior in the shared core before claiming existing feel parity. Bot definitions are admission snapshots, not client-supplied stats.

At each tick: expire stale held controls; apply ordered legal input commands; advance deterministic CPU policy; update kinematics; evaluate scheduled contacts/cancels/guards; apply simultaneous contact outcomes in stable actor-instance order; clamp resources; emit events; hash canonical state. Tie rules and contact simultaneity are versioned data, never native collection order. Propose a counter-based SHA-256 stream: hash the UTF-8 domain `duel-sim-1/rng`, the server-issued 32-byte seed, then little-endian u32 streamId, tick, eventIndex and drawIndex. Read the first four digest bytes as little-endian u32; use rejection sampling for bounded choices (increment drawIndex on rejection), never platform Random or floating random conversion. Separate numeric stream IDs for AI choice and contact variance prevent rendering or rejected commands consuming gameplay RNG. The implementation contract must pin domain bytes, stream IDs and test vectors, and benchmark this simple hash-based choice before accepting it; changing the RNG later increments simVersion.

## Proposed `duel-inputs-1` command log

This is a **new proposal**, distinct from existing `duel-intents-1`. A future issued mode `input-log` pins `simVersion`, `rulesHash`, `seed`, instance IDs, initial state, startAtServerMs, tickHz, maximum duration and session identity. Unknown modes fail closed. Existing issued legacy/resolver battles finish using their original handler; never route them into this protocol.

Illustrative complete append command; identifiers/hashes below are examples, not issued credentials:

```json
{
  "schemaVersion": "duel-inputs-1",
  "operation": "append",
  "battleId": "rb_example_0001",
  "sessionId": "ds_example_0001",
  "simVersion": "duel-sim-1",
  "rulesHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "chunkSeq": 0,
  "fromTick": 0,
  "throughTick": 14,
  "previousChunkHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "events": [
    {"seq": 0, "tick": 0, "actor": "owned-instance-ace", "action": "move", "x": 0, "z": 127},
    {"seq": 1, "tick": 4, "actor": "owned-instance-ace", "action": "strike", "target": "cpu-instance-wolf"},
    {"seq": 2, "tick": 9, "actor": "owned-instance-ace", "action": "guard_down"},
    {"seq": 3, "tick": 13, "actor": "owned-instance-ace", "action": "guard_up"}
  ]
}
```

Wire tick is the timestamp, an unsigned integer offset from the server-issued start. Client wall-clock timestamps are not accepted as authority. The adapter timestamps input using its monotonic clock mapped to startAtServerMs; the host bounds it by **server receipt time**, independently of client claims.

Allowed actions proposed: `move` (integer axes -127..127), `strike`, `heavy`, `finisher` (valid opponent target required), `guard_down`, `guard_up`, `disengage`, `deploy` (owned bench target required), `select_target` (valid opponent target). actor/target identify issued fighter instances, never merely a reusable holobotId. Each action has a strict allowed-field set; no damage/HP/winner/stats/cooldown claims. Commands can be denied in simulation (insufficient STA, invalid state) without changing the legal log. Malformed identities/shape/order refuse the whole chunk before persistence.

Events have contiguous global seq values, strictly increasing in transport order; ticks are nondecreasing and fall within the contiguous chunk range. At most 4 events per tick; conflicting same-tick commands follow explicit seq order, not a JSON object order. No missing or overlapping tick ranges. Empty chunks seal intervals with no new commands. Held movement/guard is refreshed at most every 15 ticks and automatically releases after 15 ticks without a refresh, including a lost connection; command types define renewal semantics. Render-frame catch-up records the original tick, not multiple copies of one button edge.

Proposed bounds: at most 180 seconds / 5,400 ticks, 8,192 input events per match, 64 events and 16 KiB UTF-8 per chunk, 2 MiB cumulative log bytes, 32 KiB immutable initial state, 32 KiB checkpoint state, 128 MiB replay memory, 250 ms p95 final replay CPU target and a 1-second hard replay CPU deadline. Limits are checked **before** allocation/execution; byte/event caps can terminate pathological input before duration cap. Timeout yields a pending/retryable server failure, never client victory. No balance, reward, match-duration policy or existing host TTL changes ship merely by listing these candidate limits.

## Host time, append commits and reconnect

Propose append every **15 ticks / 500 ms**. Admission fixes the start time and allowed build/rules. Server accepts a sealed interval only after its throughTick has occurred on the authoritative timeline and no later than **1,000 ms after that interval ends**; reject future sealing and late history. This allows up to 1 second of retrospective selection within uncommitted input and must be disclosed, not described as cheat-proof. A tick can be predicted ahead for rendering but cannot be committed ahead of host time. Timestamp bounds do not prove when a human pressed a button.

Persist each accepted chunk once with a canonical hash chained to the prior accepted hash; canonical encoding specifies field order, integer encoding, UTF-8/normalization policy and domain separators. Host computes hashes; a client hash is consistency evidence only, not an authentication secret. Owner auth, pinned match/session and open lease are required. Equal chunkSeq plus equal canonical bytes returns its saved acknowledgement; changed bytes refuse `input_conflict`. Gaps, late ranges, unknown versions and exhausted caps have explicit proposed refusals `input_gap`, `input_late`, `sim_version_mismatch`, `input_limit`; do not confuse these with existing shipped error codes.

The stream is monotonic: once sealed, earlier ticks cannot be rewritten. Missing chunks beyond deadline close the accepted prefix and synthesize **host-owned neutral/released inputs** for the remaining ticks. The CPU continues; the player cannot avoid a loss by disconnecting or withholding a fatal tail. The host must schedule/resume bounded authoritative completion and settle once, never trust a client final marker. A disconnect before start follows the admission cancellation policy; after start it follows this neutral-input completion policy, not a refund. Product must approve the final disconnect/forfeit presentation before shipping.

Resume returns the last acknowledged chunkSeq/hash, committed throughTick, authoritative checkpoint tick/state/hash and server time. The client discards incompatible predictions and retransmits only the unacknowledged identical chunk if still within the original deadline; reconnection never extends the match or reopens sealed history. A second device cannot open a second session for the same battle; explicit ownership/session fencing and transaction compare-and-set are required.

Do not keep one Firebase invocation running for 180 seconds. Append transactions and server-owned jobs operate on bounded chunks/checkpoints, with a durable lease/version. A periodic server checkpoint advances only through the irrevocably closed prefix; at missing deadlines it inserts neutral input and fences late arrivals. A final independent replay reconstructs from initial state plus canonical accepted log, verifies checkpoint hashes and computes the terminal receipt. Storage TTL/cleanup and account deletion cover chunks/checkpoints/receipts; no public client writes to those collections.

## Zero-tolerance authority and presentation correction

Compare **exact canonical state bytes/hash** at the same tick with **zero tolerance** for HP, STA, SYNC, positions, facing, actor state, cooldowns or RNG counters. Do not blend a numeric difference into authority. Host state wins even when client says victory; rewards/KO/progression occur once from the host terminal result. A mismatch is a telemetry event plus deterministic reproduction bundle (versions and input hashes), not automatic proof of cheating.

Unity corrects its simulation state to the host checkpoint, discards incompatible speculative events and replays acknowledged/remaining valid inputs. Visual transforms may ease to the corrected pose over a proposed 100 ms; HP/resource values and legal action state correct immediately. This cosmetic easing is not simulation tolerance. Suppress duplicate impact sounds/hit-stop/toasts by stable host event IDs; never replay a confirmed reward animation on resume. A predicted KO uses a pending result card until settlement, and a reversed prediction must show the host result explicitly.

A real-time tick/event receipt cannot be disguised as the existing 120-round `duel-receipt-1`. Propose a separately reviewed **`duel-receipt-2`** with battle/session/version identifiers, terminalTick, initial/final state hashes, ordered tick/event records, final per-instance vitals and host winner/reason. Events contain the host's damage/contact/guard/KO decisions and unique IDs; continuous state checkpoints support correction. The final receipt either embeds bounded events or references authenticated immutable paged event chunks by server hash; it does not fit an unbounded single document. Adapters may reuse the current visual move/HP handling, but must not rename ticks to rounds or drop ordering to satisfy v1. A schema-version change and both-client compatibility work are required before launch; no JSON Schema files are changed by this design.

## Anti-cheat guarantees and explicit limits

Host-owned admission and deterministic replay stop client-supplied damage, fabricated didWin, changed fighter stats/rules, resource underflow and replayed payouts. Monotonic chunk acceptance limits rewriting past the committed prefix. Seed/mode/version cannot be selected or rerolled after paid start. Transactions enforce one settlement even with concurrent finish/resume/retry.

A known deterministic seed and client-readable simulation permit offline prediction, automation, perfect inputs and opponent-policy inspection. Client timing claims, obfuscation, signing or a hash chain do not prove human play. The 1-second acceptance window permits bounded hindsight; withholding within it remains possible. This proposal targets **PvE integrity**, not competitive PvP fairness. PvP requires server-received live input ordering/hidden-information policy and separate latency/fairness design; it cannot be advertised as solved by post-match logs. More frequent checkpoints reduce correction distance and hindsight exposure but raise operating cost.

## Cost model, lanes and gates

For the proposed 180-second cap and 500-ms chunks: at most **360 append calls**, plus admission/resume/final calls. An illustrative transaction with 2 reads + 2 writes per append means **720 reads and 720 writes per maximum-length duel**, before checkpoint/job/receipt overhead. At 1,000 such duels this is **360,000 append calls and 720,000 reads + 720,000 writes**. These are operation counts, not pricing or a billing forecast; use observed traffic and current regional billing before approval. At most 2 MiB accepted log per duel implies 2,000 MiB (~1.95 GiB) per 1,000 maximum-size logs before replicas/indexes/checkpoints. Avoid cumulative-log rewrites on every append.

At 5,400 ticks, a 250-ms replay target permits roughly **46 microseconds/tick** including overhead; proposed Unity simulation budget is **0.5 ms/tick p95** with <=128 MiB host replay memory. These are gates to measure, not benchmark claims. Record cold WASM instantiate, warm replay, concurrent load, checkpoint latency, bytes/event, Node memory and native frame cost for the full 12-bot moveset matrix. Chunk validation and admission database work are budgeted separately from simulation CPU.

| Lane | Deliverable / stop gate | Planning effort, not measured |
| --- | --- | --- |
| L1 host/core | Portable integer prototype, pinned RNG/encoding, native+WASM parity, interrupted attacks/guard/disengage | 5–8 engineer-days |
| L2 host transport | Issue/append/checkpoint/resume/neutral-tail/settle, ownership/rules/emulator adversarial cases | 4–7 days |
| L3 Unity adapter | Input sampling, predicted native core, correction, animation-event de-authority, receipt-v2 presentation | 5–8 days |
| L4 verification/release | 12-bot corpus, 10,000 seeds, all platforms, disconnect/fuzz/load tests, playtest/flag rollout | 3–5 days |

Total **17–28 engineer-days**, with L2/L3 parallel only after L1's ABI/protocol freezes; not a promised calendar schedule. First milestone is a 1–2 day feasibility slice within L1; if Node/native/IL2CPP parity or performance fails, stop and review the WASM-runtime alternative rather than fork the solver.

Acceptance requires byte-identical states for every tick across debug/release WASM/native builds; randomized input/order/overflow corpus; altered seed/rules/actor/stats/timestamps/damage/win attempts; chunk duplication/reordering/conflicting replay; delayed/drop-tail/resume/device fencing; exact-once rewards; preserved legacy and plan-resolver compatibility. No visual acceptance can replace these checks. Each execution lane observes the existing two-failed-attempt hold and producer editor ledger rules.

Rollout proposal: test-only issued mode first, shadow host replay without changing existing payouts in an isolated emulator, then a separately approved small PvE cohort. Retain old handlers for pinned open battles; rollback stops new input-log admissions and drains/replays already-issued logs on their pinned version. Do not set the current resolver flag as a shortcut to enabling this different mode. Pak's playtest/flip gate, practice/zone real-time scope and all existing holds remain.

## Verification of this design

Checked decision wording, current host mode switch and receipt fields against the pinned sources. Checked external integration claims against primary Node/Unity/Rust documentation. JSON example parses; listed limits/cost arithmetic cross-checked. No implementation, unit/emulator benchmark, deterministic parity proof, editor run, native build, account use or deployment is claimed. Proposed new schemas and errors require follow-up contract review; this document is the review artifact.
