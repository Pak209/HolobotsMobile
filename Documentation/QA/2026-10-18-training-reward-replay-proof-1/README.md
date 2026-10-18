# training-reward-replay-proof-1: training and quest claims pay exactly once under legacy timers

Base: `origin/main` `8d60440169c6def299f12970e59a3ada1319380d` (#152). The deployed host is main `a90d061` (#143 + #145, `HOLOCITY_LEGACY_QUEST_TIMERS=1`). Since `a90d061`, only #150 (`functions/scripts/story-flags.mjs`, admin only) touched `functions/`, so the claim code tested here as "before" is the deployed code. Branch `codex/training-reward-replay-proof-1`.

Why: Lex (external reviewer, 2026-10-18) flagged the lite-progression-host-1 QA record (`4f5f2c5`, PR #146). It still listed a possible repeat-training-reward loophole through older saved app data (host note F4: a stale full-map `rewardSystem` write after a City claim "would pay it again"). The flag stays ON, because the original app still starts quests and training on client timers. So the host has to make every claim pay exactly once with the flag on.

## The stale-data paths (flag ON)

The original app (`mobile/src/screens/TrainingScreen.tsx:76`, `QuestsScreen.tsx:105`) starts a run by writing `users/{uid}.rewardSystem.activeTraining` / `activeQuests[]` itself. It claims with `claimTrainingSession({})` / `claimQuestRun({questRunId})`. Every `updateProfile({rewardSystem})` it makes (the sync-boost toggle at `TrainingScreen.tsx:104`, the board refresh at `QuestsScreen.tsx:76`, a start) writes the whole normalized map from the device's in-memory profile. Before this change, `resolveTrainingClaim` / `resolveQuestClaim` paid any complete record they found in `rewardSystem` when no server record existed. The claim cleared the record, but nothing remembered that the run had been paid.

| Path | What a client does |
|---|---|
| (a) | It claims, then writes an older copy of `rewardSystem` back (a restored backup, or a device that never cleared its copy) and claims again. Also the host-run variant: the City's display copy (training has no run id; quests have a `qr_` id) is resurrected after a City claim (F4). |
| (b) | Two devices claim the same run concurrently. Or device B, holding a stale profile, makes any full-map `rewardSystem` write and then claims. |
| (c) | A start is retried with the same or a different `requestId` after a timeout, and a claim is retried after a lost reply. |
| (d) | The client writes a record with `endsAt` in the past for a run it never started. |
| (e) | After a reinstall (a restored cache or old backup), the client re-sends an old claim after newer runs were claimed, with and without restoring the record. |

## Before / after (emulator, `functions/scripts/test-progression-replay-emulator.mjs`)

Payouts are counted from the account itself: KUMA's `boostedAttributes.attack` per training boost, and `syncPoints` per forest patrol (roll 0, always succeeds). "Before" is the same test file run against `origin/main` `8d60440`: 3 pass / 11 fail (known-bad, log kept locally).

| Path | Training: before → after | Quest: before → after |
|---|---|---|
| (a) restore the claimed legacy copy, claim 3 more times | **paid 4×** → 1× | **paid 4×** → 1× |
| (a) the City's display copy resurrected after a City claim (F4) | **paid 2×** → 1× | **paid 2×** (`qr_` id) → 1× |
| (b) two devices claim concurrently | 1× → 1× | 1× → 1× |
| (b) device B: stale full-map write, then claim | **paid 2×** → 1× | **paid 2×** → 1× |
| (c) start retried with the same / a different requestId; claim retried | 1× → 1× | 1× → 1× |
| (c) the retried claim's reply | refused `not_active` / `not_started_on_host` → the stored receipt, `alreadyProcessed: true` | same; the receipt repeats the rolled outcome, not a re-roll |
| (d) forged never-started runs, `endsAt` in the past | **5 of 5 paid** → 1 of 5 | **5 of 5 paid** (5 holobots) → 3 of 5 (the 3 quest slots); a run backdated a year → 0 |
| (e) reinstall re-sends an old claim after newer claims | **paid 3** (2 real) → 2 | **paid 3** (2 real) → 2 |
| Legacy clients keep working: a new run started after a claim, 3 concurrent quests, the same holobot again after its claim | pays → pays | pays → pays |

## The fix (host only; legacy clients unchanged)

- **Claim ledger.** Every paying claim, host or legacy, records the run in `users/{uid}.progressionTimers.claimed`. That field is server-only: it sits inside `progressionTimers`, which `firestore.rules` `protectedFieldsUntouched` already freezes and which is absent on create. Rules are unchanged; a new rules test proves the owner cannot write, delete or forge an entry. Each entry is keyed by a stable identity: `t:<courseId>:<HOLOBOT>:<startedAtMs>` / `q:<questId>:<HOLOBOT>:<startedAtMs>`.
  - A host run's start is the host clock.
  - A legacy run's start is `endsAt` minus the table duration (the field the claim already trusts).
  - So the City's display copy and a legacy copy of the same run get the same key.
  - Each entry also stores the run id, the source, the host-clock claim time and, for quests, the rolled outcome. The ledger keeps the most recent 60 claims, and a malformed ledger fails closed (`unavailable`).
- **Read before any payout.** A run already in the ledger replays its stored receipt (`{claimed: true, alreadyProcessed: true}` / `{rewards, succeeded, alreadyProcessed: true}`), on either flag value. It pays nothing and prunes the stale display copy from `rewardSystem`. A replay matches a quest by run id or by identity. A training claim with nothing to pay, within 15 min of the last training claim, also replays (the lost-reply retry: `claimTrainingSession` takes no arguments).
- **A `qr_` id with no server record never pays.** Only `startQuestRun` creates `qr_` runs, so a `qr_` display copy whose record is gone was already claimed. It is refused `not_active`.
- **Start order (legacy runs only).** The original app can start a training only after the previous one is claimed or overwritten. It holds at most 3 quests and sends a holobot on one quest at a time, each busy from start to claim. So a legacy run is refused `not_started_on_host` when its start comes before a claim it could not have coexisted with (5 min device-clock tolerance):
  - training: any earlier training claim (host or legacy);
  - quests: the same holobot's legacy claim, or a 4th legacy quest running at once.

  Host-started quests are not counted, because lite lets a City run and a legacy run overlap.
- **No new error code.** `TimerErrorCode` stays the 13 codes lite's copy covers. Replies only gain an optional `alreadyProcessed`, which both clients ignore (lite reads `succeeded` only).

## What the flag still allows

Path (d) cannot be closed while the flag is on. The host never saw a legacy start, so a forged record shaped like a real one is indistinguishable from it. The fix limits forged runs to the legitimate rate:
- training: one session per course duration, measured from the previous claim on the host clock;
- quests: 3 slots, one quest per holobot.

The first claim on an account with no ledger has nothing to compare against. Legacy boosts stay clamped to the course range (unchanged). Only turning `HOLOCITY_LEGACY_QUEST_TIMERS` off removes this. That stays the producer's call, after the original app ships `startQuestRun` / `startTrainingSession` and store adoption retires the client-timer builds (`functions/README.md`).

## Behaviour changes to note

- A second claim of a paid run now returns the stored receipt (`alreadyProcessed: true`) instead of `not_started_on_host` / `not_active`. Two assertions in `test-progression-timers-emulator.mjs` were updated to match.
- A legacy run that starts before a conflicting claim (above) is refused `not_started_on_host`. Lite shows "THE CITY CAN'T PAY THIS RUN". The original app shows the existing "started by an older version of the app" line.

## Verification (this branch)

| Check | Result |
|---|---|
| `functions` `npx tsc --noEmit` | 0 errors |
| `functions` `npm run check:shared` | 3 shared files in sync |
| `functions` `npm test` (`NODE_PATH=../rules-tests/node_modules`) | 352 tests: 351 pass, 1 skipped (was 348 / 347 / 1; +4 ledger unit tests) |
| `functions` `npm run test:emulator` | 187 / 187 pass (was 173; +14 replay-proof tests) |
| `rules-tests` emulator `vitest run` | 21 files, 114 / 114 pass (+1: the ledger is not client-writable) |
| `mobile` `src/lite/lib/__tests__/progressionHost.test.ts` (regenerates lite's `progression-timers-1.json` from the host's pure functions) | 30 / 30, unchanged fixture |
| `mobile` `src/lib/__tests__/progressionServerParity.test.ts` | 15 / 15 |

## Deploy set

Functions **`claimQuestRun`, `claimTrainingSession`, `startQuestRun`, `startTrainingSession`**, deployed together and carrying `HOLOCITY_LEGACY_QUEST_TIMERS=1` in `functions/.env.holobots-24046`. The start callables have to go too: the deployed start code rebuilds `progressionTimers` without unknown keys, so it would drop `claimed` on every start. No rules or index deploy.
