# Duel simulation implementation plan — W58

2026-10-16 · DECISIONS #63.1(b) · **Planning only.** This document schedules implementation; it does not implement a core, add schemas or dependencies, approve a runtime, change rules, enable a mode, or authorize deployment. Both repositories carry the same plan text.

## Baseline and scope

Source decisions: merged [HolobotsMobile #101](https://github.com/Pak209/HolobotsMobile/pull/101) (`735b5ce0215ff2e4f779dea1f7b41c1dd491cd8e`) and [Holocity #17](https://github.com/Pak209/Holocity/pull/17) (`4d6524e328d26292128849965d63ddd5ec49df62`). Their input-log design remains the protocol rationale. Host inspected at `5a2b223` and Unity main at `cd40ed32f`. The former defines legacy issue by default unless `HOLOCITY_RIVAL_ISSUE_RESOLVER=1`; stored mode selects settlement. Neither merged design is an implementation or evidence of parity.

Initial release scope is **Rival PvE real-time input-log duels**. Existing practice and zone real-time paths, tournament bracket resolution, legacy rivals and plan-then-play resolver battles retain their current handlers. Migration of other modes needs its own adapter and gate. No new economy numbers. Rewards, ownership, progression and final outcomes remain exclusively host-owned. Unity uses the shared core for speculative presentation; it cannot write authoritative health, settlement or rewards.

## One source, two artifacts

Adopt the merged design's Rust route provisionally, subject to lane S0. Proposed source and package layout (all paths below are future deliverables):

```text
HolobotsMobile/
  shared/duel-sim/
    Cargo.toml, Cargo.lock, rust-toolchain.toml
    crates/core/       # integer state, input, CPU policy, combat, canonical encoding
    crates/ffi/        # native C ABI over core; no independent combat equations
    crates/wasm/       # memory/export wrapper over core; no WASI or ambient imports
    include/          # versioned C header, ownership and error contract
    vectors/          # canonical inputs, per-tick states, events and expected hashes
    schemas/          # canonical duel-inputs-1, receipt-v2 and transport contracts
    release/          # artifact-manifest format, reproducible build instructions
  functions/src/lib/duelSimAdapter.ts
  functions/src/rival/duelInputHost.ts
  functions/scripts/test-duel-sim-*.mjs
Holocity/
  Assets/Holobots/DuelSim/Runtime/  # C# ABI adapter, recorder, prediction/correction
  Assets/Plugins/DuelSim/         # approved native artifacts + platform importer metas
  Assets/Holobots/Shared/Editor/Tests/  # native parity and recorder/correction tests
  Schemas/                       # exact reviewed mirrors of the canonical wire schemas
```

`core` has no engine, database, network, wall-clock or platform RNG access. Host TypeScript and Unity C# only validate/encode commands, call the core, transport/store results and present them. Do not port equations to C# or TypeScript. Host runs `wasm32-unknown-unknown`; Unity receives macOS native libraries (arm64 and x86_64 where shipped), iOS device arm64 static library and simulator slices as needed. Target availability, IL2CPP linkage, plugin packaging and licensing must be demonstrated in S0, not presumed.

The binaries differ but derive from **one pinned source commit, lockfile and toolchain**. A versioned release manifest records simVersion, ABI version, rules/content hash, source commit, target, artifact SHA-256 and vector-suite hash. Build automation produces both artifact families from that commit; Unity consumes an explicit pinned release, never a moving branch or a hand-edited copy of Rust. Manifest signing/provenance verification belongs to the release lane; missing release credentials become a human action only when actually encountered. Native assets use the approved artifact channel and repository binary policy; no raw build output is added by this docs PR.

The ABI uses fixed-width integers and length-delimited canonical byte buffers, opaque handles and explicit status codes; no Rust layout, strings or native pointers cross as serialized state. Specify allocation/free ownership, maximum buffers, supported ABI negotiation and panic containment. Both wrappers call the same core encode/decode routines. Cancellation or a replay budget expiry yields a host pending/failure state, never a client result.

## Ordered lanes and time boxes

One engineer-day = **8 focused hours**. These are maximum initial effort boxes, not a calendar promise or approval to run builds/deploys. Total is **25 engineer-days / 200 hours**, a refinement within the design's 17–28 day estimate. Work in checkpoints of at most 3 hours; after two failed attempts on the same gate, stop that item as HELD with command, input/version hashes, failure, elapsed time and resource measurements. Re-scope before exceeding a lane box. Do not hide failed feasibility by implementing another solver.

Each implementation PR targets **main**, with dependencies recorded in its body; merge prerequisites first, then rebase. Do not base on sibling branches. Schema/DTO/ABI changes use `Contract-Change:` commits. Each row may produce a host and Unity PR where ownership crosses repositories; they are reviewed as a coordinated contract pair.

| Order / lane | Owner and PR boundary | Depends on | Time box | Exit evidence |
| --- | --- | --- | --- | --- |
| S0 `duel-sim-portability-1` | Host shared core spike + Unity native test adapter; no live admission | Merged design | 2 days / 16 h | Same minimal vector bytes under Node WASM, macOS native and Unity IL2CPP; artifact provenance, cold/warm timings, memory and linkage evidence. Fail → HELD; evaluate the design's same-WASM-runtime fallback separately. |
| S1 `duel-input-schema-1` | Host canonical schemas/ABI specification + Unity mirrors/DTO contract PR | S0 feasibility | 1 day / 8 h | Frozen canonical encoding, instance/sequence rules, positive/negative vectors; schema parity check; all unresolved protocol choices below resolved or explicitly held. |
| S2 `duel-sim-core-1` | Rust core + wrappers + host-authored immutable rules adapter | S1 | 4 days / 32 h | Exact per-tick parity for movement/contact/interrupt/guard/regen/deploy/CPU; all 12 bot definitions mapped, no local combat authority left in adapters. |
| S3 `duel-input-host-1` | Issue routing, append/resume/verify callable, durable completion, rules and settle transaction | S2 (can prepare transport against S1 fixtures) | 6 days / 48 h | Throwaway-pilot emulator refusal/concurrency/disconnect matrix; bounded replay; exact-once existing rewards; legacy/resolver regression green. |
| S4 `duel-input-unity-1` | Native integration, recorder, network buffering, correction and receipt-v2 presentation | S2 + S1 transport fixtures; integrates with S3 | 6 days / 48 h | Input capture independent of frame rate; same-tick state equality; no duplicate effects; corrected KO/result; native tests and producer Play witness. |
| S5 `duel-sim-vectors-1` | Cross-target corpus, fuzz/replay/load runners and release manifest verification | Starts with S1; final gate after S2–S4 | 4 days / 32 h | 10,000-seed corpus, every-tick byte equality across supported debug/release targets, resource/cost table, recovery and mode-matrix results. |
| S6 `duel-input-migration-1` | Capability admission, disabled rollout control, rollback/drain runbook and smoke script | S3–S5 green | 2 days / 16 h | Emulator-only migration and rollback rehearsal; reviewed build/version allowlist; producer playtest evidence and explicit release/flip gate. No automatic deployment. |

Order: **S0 → S1 → S2 → (S3 ∥ S4) → S5 final gate → S6**. S5 writes independent expected vectors during S1/S2 and runs them continuously; it is not deferred testing. S3/S4 may prepare against frozen fixtures after S1, but cannot claim integration completion before S2. Feasibility precedes feature work. S0's native proof is future separately scheduled build work; it consumes no build authorization in this docs task. The editor owner must CLAIM/RELEASE for every future Unity run, clean scenes in memory, never answer Save.

## S1 contract package

Create the actual **`duel-inputs-1` schema PR**, not a rename of `duel-intents-1`. Define command/envelope strict keys, maximum lengths and operation-specific request/reply schemas. Publish identical schema files in both repositories with a hash comparison check. Include proposed `duel-receipt-2` and checkpoint/ack/refusal shapes in the same coordinated review, or explicitly block dependent lanes until those companion contracts land. Existing `duel-receipt-1` remains unchanged.

Pin these details in S1:

- Issue envelope version and `duel.mode="input-log"`; battle/session/actor instance IDs, 32-byte host seed, simVersion, ABI/protocol version, rulesHash, immutable initial state, server start, tickHz and duration. Existing clients must not see an unknown mode: capability admission gates issuance, not a client-selected mode. A changed issue reply needs a reviewed version, not an undocumented optional payload.
- Ordered events `{seq,tick,actor,action,...}` with integer axes for move and instance `target` where required. Actions: move, strike, heavy, finisher, guard_down/up, disengage, deploy, select_target. Reject damage/didWin/stats and unknown fields, negative/fractional ticks, impossible instance identities and conflicting chunk bytes. Combat-illegal but structurally valid input is deterministically denied by core, not silently removed from the log.
- Canonical bytes: field order, signed/unsigned widths, endianness, domain separators, UTF-8/normalization, number overflow behavior, explicit actor iteration order, RNG stream IDs and rounding. Never hash incidental JSON serializer output. Include hand-audited encoding/RNG examples and invalid examples.
- Acknowledgement includes accepted sequence/hash and throughTick; resume includes server time and authoritative checkpoint/state/hash. Verify returns a terminal receipt or a bounded pending status. Full refusal table and retryability distinguish protocol rejection, authentication failure and server budget exhaustion; `input_conflict`, `input_gap`, `input_late`, `sim_version_mismatch`, `input_limit` remain proposed until this PR lands. Add names for future sealing, unsupported mode and session fencing in this review, not ad hoc during implementation.

Candidate limits inherited from the design, **not approved policy**: 30 Hz; 15-tick / 500-ms chunks and held-control expiry; 1,000-ms late window; 4 events/tick; 64 events and 16 KiB/chunk; 8,192 events and 2 MiB accepted log/match; 32 KiB initial/checkpoint state; 128 MiB replay memory; 250-ms p95 replay target; 1-second hard replay CPU budget; 0.5-ms p95 Unity simulation/tick. Limits are validated before allocations. The design's 180 seconds / 5,400 ticks conflicts with assuming a universal 240-second squad cap from scoreboard presentation. S1 must pin **host-issued per-mode duration** with product approval, or keep squad input-log admission disabled. A UI countdown is never match policy. Final contact tie rules, disconnect/forfeit wording and retention TTL are explicit S1/S6 decisions; do not invent economy or duration changes to unblock code.

## S2 deterministic behavior and authority audit

Port the approved combat specification into one integer core, not the existing Unity physics execution. State uses integer X/Z millimetres, explicit facing/velocity/collision shapes, fixed integer milli-unit HP/STA/SYNC and checked 64-bit intermediates. Overflow rejects state; explicit RNG wrapping is separate. Core tick order follows the merged design: held-input expiry → ordered commands → deterministic CPU → kinematics → scheduled contacts/cancels/guards → stable simultaneous outcomes → clamps/events/hash. Pin the SHA-256 counter-stream algorithm and rejection-sampling vectors before balancing or optimizing it.

Rules and stats come from host admission snapshots and host rival tier/moveset data. Inventory every current autonomous attack/contact, DamageFrame, root-motion and physics path. For **input-log mode only**, remove their ability to alter simulation state; drive them from stable core event IDs. Preserve legacy/resolver presentation paths until their admissions drain. Do not claim feel parity until guard/cancel windows, interrupted attacks, disengage, bench/deploy and all 12 movesets have vectors and a producer witness. The prior authority finding remains open for unaffected real-time modes.

## S3 host verify endpoint and persistence

Propose an authenticated callable **`duelInputHost`** with append/resume/verify operations; final naming is frozen in S1. Admission still belongs to the existing rival host, which stores mode, immutable seed/rules/build and session. The callable never accepts client initial stats, terminal HP, damage or winner as authority. `verify` takes identifiers (and an optional comparison hash), reads the stored immutable admission plus accepted canonical chunks, and returns host status/receipt. It must not accept a replacement full log at finish.

Split S3's box into admission/mode dispatch (1 day), append/resume/rules (2 days), durable checkpoint/neutral-tail worker (1 day), final replay/settlement (1 day), emulator/race and regression verification (1 day). Store chunks separately under server-owned battle records, with bounded checkpoints and immutable receipt/event pages; exact collection paths and indexes belong in its PR. Deny client writes; include TTL/account-deletion cleanup and version retention.

Append uses server receipt time and compare-and-set session/lease/version. Exact duplicate chunks return the saved ack; changed bytes conflict; gaps/overlap/future/late intervals refuse before persistence. No partial acceptance. Missing input after the deadline closes the prefix and supplies neutral/released commands through **elapsed** host ticks; CPU continues. Early verify never fast-forwards an unfinished match to fabricate a terminal result. Durable completion triggers on elapsed terminal conditions/cap, without a 180-second invocation or a required client final request.

Final replay starts independently from initial state and canonical accepted log (including deterministic host neutral-tail policy), verifies checkpoint hashes with tolerance **zero**, and creates the terminal receipt. Run CPU work outside Firestore retryable transactions; fence the resulting receipt by immutable input hash/version and terminal lease. A short transaction atomically records the receipt hash/settlement marker and applies existing reward/KO/progression writes once. Concurrent verify, worker, resume and transaction retries return the same recorded result. Budget failure stays pending with bounded server retry/operator visibility; it never falls back to didWin. Test recovery after replay completes but before commit, and after commit before response.

## S4 recorder and correction presentation

Split S4 into ABI/lifecycle (1 day), recorder and reliable transport (2 days), correction/event presentation (2 days), native tests and producer handoff (1 day). The recorder maps monotonic input time to host-issued ticks at 30 Hz, keeps contiguous sequence/chunk ranges, sends empty chunks, refreshes held controls within their expiry and deduplicates button edges during frame catch-up. It retains only bounded unacknowledged buffers. Resume retransmits identical unacknowledged bytes only inside the original deadline; device/session fencing cannot extend a match.

Load only the manifest-pinned native core/rules. Missing plugin, bad hash or unsupported ABI refuses input-log admission cleanly; do not substitute a C# solver or legacy settle for an already-issued input-log battle. Reuse current combat-HUD portrait/resource widgets and event presentation, with a dedicated receipt-v2 adapter alongside `DuelReceiptPlayer`; do not coerce ticks into v1 attack rounds.

On same-tick state/hash mismatch: replace prediction with the host checkpoint, invalidate speculative events, replay only still-valid inputs, update HP/STA/SYNC/action legality immediately, then optionally ease **visual pose only** over the proposed 100 ms. Dedupe sound, impact, hit-stop, toast and result events by stable IDs. Predicted KO is pending until host settlement; a reversed prediction visibly changes to the host result. Zero tolerance applies to authoritative values, not cosmetic interpolation. Record a reproduction bundle without credentials/personal account data; divergence alone is not a cheating verdict.

## S5 vectors and measurable acceptance

Vectors are versioned with source/rules hashes, canonical admission/log bytes and expected **every-tick** state/event bytes plus terminal receipt hash. Keep independent hand-calculated microcases; do not regenerate expectations from the candidate under test and call that parity. Freeze expected hashes separately from implementation edits. Both WASM and native runners consume the exact same corpus. Unity tests compare native outputs before any rendering.

| Corpus | Required cases / assertion |
| --- | --- |
| Arithmetic/encoding | Signed division/rounding, zero and boundary values, overflow refusal, endian/UTF-8 ordering, RNG stream separation/rejection sampling, debug vs release. |
| Combat | Strike/heavy/finisher/guard/miss, contact ties, cancel/interrupt, insufficient STA, regen, KO, neutral held expiry, deploy/bench and mirror-bot instance identities; all 12 bots and 1v1 plus proposed squad cases. |
| Seed/matrix | 10,000 deterministic seeds spanning all ordered 12×12 bot pairings (144) and reviewed tier boundaries; publish distribution and coverage counts. This is not 10,000 seeds per pair. Every tick equal, not merely the same winner. |
| Transport/security | Malformed shape, damage/didWin injection, altered seed/rules/actor, duplicate/conflicting/gapped/reordered chunks, future/late ticks, cap exhaustion, two-device lease races and unauthorized reads/writes. |
| Recovery | Drop before start, drop after fatal input, missing tail, delayed ack/resume, app kill, worker restart, commit/response loss, exact-once reward and event effects. |
| Compatibility | Legacy→legacy, resolver→resolver, input-log→input-log by stored issue mode; flag changes mid-match; old client excluded from new mode; retained old sim/rules version drains after rollback. |

Benchmark cold WASM instantiation separately from warm simulation; measure p50/p95/max CPU, peak memory, bytes/event, append/checkpoint latency and Unity simulation time under render stalls. Verify hard execution timeout can interrupt/bound work; a promise timeout alone cannot stop synchronous CPU. Compare against candidate budgets above and report failures without relaxing limits silently. At 180 seconds/500 ms, maximum append count is 360; the design's illustrative 2-read/2-write transaction implies 720 reads + 720 writes before jobs/checkpoints. A 240-second candidate would be 480 calls and 960 + 960, requiring renewed budget review. No billing prices or measured performance are asserted here.

## S6 migration from resolver mode and rollback

1. Ship disabled artifacts, validators and handlers in reviewed PRs; run emulator only with throwaway pilots. Tests must preserve the current legacy default and resolver flag behavior. No deploy is authorized by this plan.
2. Ship Unity capability reporting, native hash/version checks, recorder and both v1/v2 presenters before new-mode admission is permitted. A new **separate, default-off input-log admission control** is proposed; freeze its exact name/config in S6. `HOLOCITY_RIVAL_ISSUE_RESOLVER=1` never selects input-log mode.
3. Shadow replay in isolated emulator/test accounts only; do not replay a batch `playerIntents` log as if it contained real-time movement. Exercise real recorder chunks; no shadow payout writes. Retain approved legacy/resolver behavior and existing economy.
4. After S5 and producer playtest, Pak explicitly authorizes deploy and a small supported PvE cohort. Server selects new mode only for allowlisted compatible builds/rules; clients cannot request a downgrade or arbitrary seed. Record versioned telemetry and pause criteria before activation.
5. Existing legacy battles finish with legacy settlement; resolver battles finish with their pinned resolver and `duel-receipt-1`; input-log battles finish with their pinned sim/rules and v2. Never change stored mode or reinterpret an in-flight log when flags change.
6. Rollback disables **new** input-log admissions, retains the pinned worker/core/schema/rules artifacts and drains/replays open input-log battles to one host settlement. Unsupported/corrupt versions remain pending for recovery, not legacy client victory. Remove old binaries/handlers only after an audited zero-open-battles + retention window, through a separate PR.

Unknown modes fail closed. The current legacy acceptance flag must not be disabled until legitimate legacy issues drain. Product approvals for disconnect copy, duration, release/flip and platform credential work remain future gates; they do not block drafting this plan and are not implied approvals. No deploy, Pak account, credits, editor run, scene save, library rebuild or build occurs in W58.

## Plan verification and handoff

The two merged designs were read and compared; source text matches. Current host routing, Node 22 package engine and build/check:shared scripts were inspected. Lane budgets sum to 25 days / 200 hours; dependency order and candidate call-count arithmetic were checked. Both plan copies must be byte-identical; PR diffs contain only Markdown. No unit/emulator/native performance or deterministic correctness result is claimed for this docs-only work. Implementation lanes must run their own tests, plus `npm run build` and `npm run check:shared` for host changes and producer-owned clean in-memory Unity validation for client changes.

All numerical protocol defaults above retain the design's **proposed** status until the corresponding contract/product gate. All existing holds remain. When an execution lane actually reaches a human-only blocker, file it in PakOS Actions Needed with the exact blocked lane and actionable step; do not file speculative future credential work now.
