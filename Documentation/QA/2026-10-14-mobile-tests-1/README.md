# mobile-tests-1

2026-10-14. W9 adds tests and text evidence on main `694be3483625b8e6fb74e63a683b61a27e857579`. No production implementation, dependencies, contract schemas, economy values, editor assets, or shared dirty files changed. No emulator, deployment, credits, or Pak account was used. Storage and time are mocked only where they are external boundaries; the actual store, parser, objective derivation, and host contract helpers execute.

## Inventory and coverage boundary

| Requested surface | Existing implementation | Coverage delivered | Status |
|---|---|---|---|
| Local story flag persistence | `mobile/src/lib/story/storyFlags.ts`, used by `OverworldScreen.tsx` | 30 new store cases | Covered |
| Host desktop account reply / story flags | No production mobile callable consumer; existing mobile parity tests import host reply builders | 20 new host-backed desktop story-flag contract cases across desktop-account-1/-2/-3 | Contract covered; actual mobile integration HELD / missing |
| Rival cooldown reply consumption | No production mobile `rivalBattleHost`, `rival_cooldown`, or `retryAfterMs` consumer; existing economy parity test imports host helper | 18 new host-backed cooldown cases, with fake time for remaining milliseconds | Contract covered; actual mobile hook/countdown integration HELD / missing |
| Profile subscription | `AuthContext.tsx` calls `subscribeToUserProfile` in `mobile/src/lib/profile.ts`, backed by Firestore `onSnapshot` | Inventoried; neither mapper/types nor context reads #80 story fields | No invented desktop-response adapter or hook |

The two story shapes are distinct. The local Story Mode slice-0 cache is `{flags: Record<string, boolean>, checkpoint}` in AsyncStorage under `story:v1:<uid>`. #80 host account `storyFlags` is `{arenaGatheringSeen: boolean, tournamentsWon: number, arenaArcBuilt: boolean, holoZonesArcBuilt: boolean}`. The store tests do not claim that local boolean flags consume, synchronize, or authorize that host map.

The production search excluded test files and included all `httpsCallable` and `onSnapshot` uses, `desktopAccount`, `rivalBattle`, `retryAfterMs`, `rival_cooldown`, and all four #80 flag names. Four existing hooks are `useWatchBridge`, `useWorkout`, `useRealtimeArena`, and `useEnergyRegen`; none implements those requested reply consumers. The WebView bridge already refuses client-authored progression and validates its inbound checkpoint map bounds in separate existing tests.

## New behavior tests

- `mobile/src/lib/story/__tests__/storyFlags.test.ts` — initial state/objective, per-UID isolation, flag/checkpoint persistence across a fresh store, valid false values and nonboolean filtering, malformed roots/flag maps/checkpoint shapes, sequential-load and same-value flag idempotence, listener identity/unsubscribe, defensive copies at flag/checkpoint boundaries, read/write failure warnings and usable state, later successful persistence, and the default AsyncStorage adapter.
- `mobile/src/lib/__tests__/desktopStoryFlagsParity.test.ts` — four field defaults, existing gathered progress, numeric tournament counts 0–3 and the third-win Arena flag across all three account reply versions, no source-profile mutation, and malformed state refusal. Assertions allow unrelated additive reply fields so a later Pilot Rank merge does not break them.
- `mobile/src/lib/__tests__/rivalCooldownContract.test.ts` — unchanged 300000-ms contract, exact remaining milliseconds at elapsed 0/1/120000/299999, admission at 300000 and later, independent rival IDs, future-timestamp handling, missing/malformed ledgers, copied maps, and pruning exactly expired entries while preserving live rivals. These are host helper contract tests, not a simulated production mobile cooldown UI.

## Known-bad first controls

Before the healthy candidate suite, three bounded intentional source mutations were run in this isolated worktree. Every control exited 1 at an expected assertion. Sources were restored in `finally` blocks; before/after SHA-256 values match in `mutation-results.json`, and the production-file diff is empty. Mutated code is not committed. These are expected red controls, not unexplained candidate failures.

| Control | Temporary defect | Catching behavior |
|---|---|---|
| local-copy | Return the internal flag map | Mutating a returned snapshot changes the store; defensive-copy assertion fails |
| rival-remaining-time | Add 1 ms to `retryAfterMs` | Exact remaining-time assertions fail at all four tested elapsed values |
| desktop-default | Default `tournamentsWon` to 1 | Every desktop reply version fails the required zero-default assertion |

The runner is archived as `run-mutation-controls.py`; it confines writes to the selected source files, uses only the local Vitest command, bounds each command to 120 seconds, and restores exact source bytes even on failure. Per-control logs and the result manifest are archived alongside it.

## Verification

- Main baseline: **48 files passed; 439 tests passed, 1 existing skip, 0 failed** (440 total), **2.29 s**. Baseline typecheck passed. There were no preexisting failures to excuse.
- Candidate initial run: **51 files passed; 507 tests passed, 1 existing skip, 0 failed** (508 total), **12.48 s**. Typecheck passed. **68 new tests**: 30 store, 20 desktop story contract, 18 cooldown contract.
- Final parallel attempt after making the default-adapter assertion independent of JSON key order: **50 files passed / 1 failed**, **506 tests passed / 1 failed / 1 existing skip**, **116.36 s**. All 68 new tests passed; the unchanged `battleSettlementParity` full-grid test exceeded its existing **5000 ms** timeout. Increased resource contention is suspected from the much longer suite/transform times, but is not established. This failure is retained in `final-parallel-timeout.txt`. The final typecheck completed successfully (`final-typecheck.txt`).
- Final attempt 2 used `--maxWorkers=1`, the same assertions and unchanged **5000 ms** test timeout, under a **300-second** process-group bound: **50 files passed / 1 failed**, **506 tests passed / 1 failed / 1 existing skip**, **53.27 s** Vitest duration (**68.557 s** process wall time). The same unchanged Arena full-grid test took **5874 ms** and timed out. All **68 new cases passed**. The process completed within its bound; no third attempt was taken. **Final full-suite validation is HELD; publish as DRAFT.** See `final-single-worker.txt` and `final-single-worker-result.json`.
- Independent parent review found no blocker in the store behavior coverage, both contract suites, or the coverage-boundary inventory. The implementation remains unchanged.

Commands: `npm --prefix mobile test` and `npm --prefix mobile run typecheck`. The existing skipped Genesis UI case remains the only skipped test; no tests were newly skipped or disabled.

## Limits and observations held for separate work

0. Final full-suite validation is **HELD** after two failed final attempts on the same unchanged Arena parity timeout. Baseline and initial candidate passed; typecheck remains green. Resource contention is suspected, not proven. No timeout or assertion was relaxed.
1. Actual mobile hooks/stores consuming desktop reply story state and rival cooldown refusals are absent. Their integration coverage is **HELD / missing implementation**; this PR does not create those product paths.
2. Store load idempotence is **sequential**. Source inspection shows no shared in-flight load promise: two first loads can both read and a late completion can replace newer local state. Concurrent load/mutation safety is not claimed or fixed here.
3. Persisted checkpoint parsing checks shape via `isStoryCheckpoint`; map/bounds validation happens at the inbound bridge. Local storage is not an authorization boundary. The parser also treats an array flag map as an object, so boolean entries can become numeric string keys; this coverage does not claim rejection of arrays. Production sanitization changes are outside this tests-only lane.
4. Persistence errors are logged while in-memory state stays usable. There is no automatic durability guarantee or retry of an identical same-value flag after a failed write. Listener exceptions and overlapping async storage writes are not isolated/serialized by this store; this PR does not claim otherwise.
5. Host-backed parity tests are not full callable/emulator tests and do not validate an absent mobile transport/error-mapping layer. They preserve existing 5-minute rival cooldown values; W1's zone cooldown/CPU retune is outside this branch.

All unrelated holds remain in place. No production account was read or written.
