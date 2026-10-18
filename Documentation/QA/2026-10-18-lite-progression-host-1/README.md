# lite-progression-host-1: quests, training and Daily Missions through the City

This lane moves lite's quest and training runs, and the Daily Missions display, onto the host records that host PR #145 (`codex/host-economy-hardening-2`, head `e9091f0`) adds. It also matches lite-arena-polish-1's (#144) anticipated `payoutCapped` / `retryAfterMs` reads to #145's real shapes. It is the client half that lets the producer turn off the host's legacy timer flag (`HOLOCITY_LEGACY_QUEST_TIMERS`).

There are two client PRs. Neither touches `functions/`, `firestore.rules`, deploy config, PvP, 3v3, Home/City or duel-camera files.

| PR | Base | Scope |
|---|---|---|
| [#146](https://github.com/Pak209/HolobotsMobile/pull/146) | `mobile-holocity-lite` | Quests, Training, Daily Missions, LN7 (arena fields), offline QA cells |
| [#147](https://github.com/Pak209/HolobotsMobile/pull/147) | `main` | `mobile/src/lite/**` quest/training only (main's gated tree has no host dashboard, so Daily Missions stay lite-only) |

Hard rule 1 holds: the City (host) starts, times, rolls and pays. The client sends a request (`{questId | courseId, holobotName, requestId}`) and shows what the City recorded. Every new player string is marked PLACEHOLDER (Lex) and says "the City", never "host" (DECISIONS #71).

## Base and holds

- **Lite PR.** The base is the GitHub-verified `mobile-holocity-lite` tip `038038b`. #137, #141 and #142 squash-merged while this lane ran. The lane first built on #144's head `1badad3`, which merged those three locally (#141 `b0c43fc`, #142 `bbc323d`, #137 `e828c21`). `038038b`'s tree equals that local merge base (`b4f0bc7`, tree `a54f52f`), so #144's five commits and this lane's commits were replayed onto it with an identical final tree (`a8079bd`). #144 is still open: until it lands, the PR diff also shows its commits. **Rebase once #144 lands.** Commit map: `f1f21b8`→`af8eab9`, `1aac2ab`→`a25c4aa`, `933118b`→`7cc6b63`.
- **Main PR.** The base is the GitHub-verified `main` `95c00a7`. It touches only `mobile/src/lite/**`. No open PR touches these files (#138 touches other `mobile/src/lite` arena/qa files; #136 is host-only).
- **Host #145 is OPEN** (head `e9091f0`, GitHub-verified at start). Both PRs are **DRAFT and HELD on #145**. Until #145 is deployed, `startQuestRun` / `startTrainingSession` do not exist on the deployed host. A start then fails with `not-found`, which shows "The City couldn't find that. It may not be open yet." Claims of legacy runs keep working (the deployed host has no flag yet). Do not ship either PR before the deploy.

## Row → change → evidence

### Quests and training through the City (both PRs)

| Item | Change | Evidence |
|---|---|---|
| Start before a run | SEND asks `startQuestRun`, SELECT asks `startTrainingSession`, with only `{questId \| courseId, holobotName, requestId}`. The City validates the bot, slots and energy, debits the energy, rolls the boost and stamps its clock. | `progressionHost.test.ts` "SEND asks startQuestRun with the request only…", "training: SELECT asks…" (request keys are exactly the host's `readStartCommand` keys; nothing is written to Firestore). The fixture records that the host refuses a start carrying `endsAt` / `holobotPower` (`invalid_request`). |
| No client timer writes | The screens no longer call `updateProfile` for runs. No `endsAt`, `startedAt`, `holobotPower`, boosts or `dailyEnergy` debit is written. The client start builders (`startQuestRun` / `startTrainingSession` in `progressionSystems.ts`) are deleted on lite. Main keeps them for the main app, and the gated screens no longer import them. | "the screens never write a run, a timer, a power score or the energy debit" (source scan + export check); on main the import check for the shared builders. |
| City end time | Cards read the server-only `users/{uid}.progressionTimers` through the owner's own user-doc listener (`useCityProgression`, which reads them with the `rewardSystem` run copies from the same snapshot; clients cannot write `progressionTimers`). A running card shows `ENDS hh:mm · 11m 55s LEFT` from the City's `endsAtMs`. A malformed record reads UNAVAILABLE (as the host fails closed), never a partial list or a guessed time. | "reads the host record after both starts…", "absent = no City runs; anything malformed = UNAVAILABLE…", "the card shows the City's end time…". |
| Claim against the City record | CLAIM sends the City run id (`qr_…`) to `claimQuestRun`, or calls `claimTrainingSession`. The host's display copy in `rewardSystem.activeQuests` (same `qr_` id) is never shown twice or promoted to a run while the record is unreadable. | "CLAIM asks claimQuestRun with the City run id", "the host's rewardSystem display copy (qr_ id) is never shown twice…". |
| Refusal → City copy | Every `TimerErrorCode` (13) has its own line, plus `not-found` (callable not deployed), `unauthenticated` and a generic line. No raw code reaches the screen. A transport failure or an unreadable reply is an UNKNOWN outcome: the request id is kept, so a retry is the identical request and the City replays it (`alreadyProcessed`), never twice. | "each TimerErrorCode the host can send has its own line, for every action; none says host", "no reply (transport) is an UNKNOWN outcome…", "an unknown outcome keeps the request id…". |
| Legacy in-flight runs | A run an older app started on client timers (`rewardSystem.activeQuests` entry without a `qr_` id, or `activeTraining` with no City record) is shown as "STARTED ON AN OLDER APP". It claims by its own id while the City honours them (flag on). After the flag goes off the City refuses `not_started_on_host`, and the card closes honestly: "THE CITY CAN'T PAY THIS RUN · START A NEW ONE", with no CLAIM. Nothing is hidden or re-timed. A legacy training blocks a new SELECT until claimed or refused, because the City's start would overwrite its display copy. | "flag ON: a finished legacy quest is offered CLAIM…", "flag OFF: the City refuses not_started_on_host…", "a legacy session blocks a new training start…". The fixture records the host's own answers for both flag states. |
| Board / sync boost | The quest-board refresh and the sync-boost toggle write only their own keys as dotted paths (`rewardSystem.availableQuestIds`, `…questRefreshesRemaining`, `…lastQuestRefreshDate`, `…syncBoostEnabled`). They never re-send the run display copies or the mission mirror. | "the only rewardSystem writes left are the board / sync-boost keys, as dotted paths". |

### Daily Missions from the City's ledger (lite)

| Item | Change | Evidence |
|---|---|---|
| Ledger first | `readDashboardAccount` reads the snapshot's additive `dailyMissionLedger` strictly against `Schemas/daily-mission-ledger-1.json`. Any extra, missing or mistyped key reads as absent, never as zero. `buildDailyMissions(profile, date, ledger)` takes counts and claimed flags from it. | `hostHardening2Contract.test.ts` "reads #145's recorded summary…", "is strict…". |
| CLAIM only from the ledger | `claimable` is true only with the ledger in hand. Without it (older host, read loading or failed) the device copy is shown for display only. Claims pause, with a PLACEHOLDER note and RETRY. | "the forged rewardSystem mirror (99 / 99) changes nothing…", "CLAIM comes only from ledger progress". |
| Read only while open | `UserStatsModal` mounts the dashboard store only while visible (`useHostDashboard(visible ? uid : undefined)`). A successful claim publishes `notifyHostEconomyChanged`, so the City's claimed flag replaces the local one. | Code path; covered by the store tests in `hostDashboard*.test.ts`. |
| Mission keys out of quest/training writes | `MobileProgressionSystem` no longer includes the four mission keys, and no quest/training path writes `rewardSystem` as a map. | "the quest/training read model no longer carries the four mission keys…". |

### LN7: #144's anticipated fields matched to #145 (lite)

| Item | Change | Evidence |
|---|---|---|
| `payoutCapped` | Read only at the top level of the issue reply, where #145 puts it. A match-level flag is ignored. Absent means unknown. | `hostHardening2Contract.test.ts` "every recorded issue reply carries a top-level boolean payoutCapped…"; `arenaPolish.test.ts` (A)3. |
| `retryAfterMs` | Unchanged read (`details.retryAfterMs`), confirmed against #145's recorded `too_fast` refusal (2976 ms; CPU floor 3 s). | "the recorded too_fast refusal carries details.retryAfterMs…". |
| Fixture | `qa/fixtures/arena-admitted-lifecycle.json` is now #145's byte copy (blob `9bdedb40`, sha256 `b454b8db…`). The QA cell title drops "ANTICIPATED". | sha-pinned in `hostHardening2Contract.test.ts`; all arena suites pass on it unchanged. |

## Fixtures and provenance

| Fixture | Source | Pin |
|---|---|---|
| `qa/fixtures/progression-timers-1.json` (lite) and `lite/qa/fixtures/progression-timers-1.json` (main) | **Generated by #145's own pure functions** at `e9091f0`: `buildQuestStart` / `questRunView`, `buildTrainingStart` / `trainingView`, `resolveQuestClaim` / `resolveTrainingClaim` (flag on and off), and `timerHttpsError` for all 13 `TimerErrorCode`s, on a synthetic profile. No account data. | sha256 `dc58332b…691d` (lite test). On main, `progressionHost.test.ts` **regenerates it from `functions/src/lib/progressionTimers.ts`** and compares; it is skipped until #145 is on main. Proven locally by dropping #145's files in: 27/27 pass; with a perturbed host table the check fails (known-bad control). |
| `qa/fixtures/daily-mission-ledger.json` (lite) | #145's byte copy of `functions/scripts/fixtures/desktop-account/daily-mission-ledger.json` (blob `ab42c552`), including its forged 99/99 mirror. | sha256 `8689f081…d4ec` |
| `qa/fixtures/arena-admitted-lifecycle.json` (lite) | #145's byte copy of `functions/scripts/fixtures/arena-match/admitted-lifecycle.json` (blob `9bdedb40`): `payoutCapped: false` on the issue replies and the `too_fast` refusal with `retryAfterMs: 2976`. | sha256 `b454b8db…83d1` |

## Verification

Full mobile `npx vitest run` and `npx tsc --noEmit`, before and after, on each branch (`node_modules` symlinked from the primary checkout; no installs).

| Branch | Before | After |
|---|---|---|
| lite (`claude/lite-progression-host-1`) | vitest 1221 pass / 4 skip (90 files + 1 skipped); tsc 0 | vitest **1270 pass / 4 skip** (93 files + 1 skipped); tsc **0** |
| main (`claude/lite-progression-host-1-main`) | vitest 877 pass / 4 skip; 2 files fail to load (no `react-test-renderer` locally: `liteBoundary.test.ts`, `hostState/hooks.test.ts`; known, CI is fine); tsc 2 (the same) | vitest **906 pass / 5 skip** (the new skip is the #145 parity check), the same 2 known load failures; tsc the same 2 |

Main with #145's `progressionTimers.ts` / `progressionEconomy.ts` / `progressionTimerErrors.ts` dropped into the worktree temporarily: `progressionHost.test.ts` 30/30 (parity on). With a perturbed host quest duration: the parity test fails (known-bad control). The files were restored afterwards (`git restore` / `rm`).

`node scripts/pin-host.mjs --check e9091f0` on lite: 8 pinned files differ from the deployed pin `3b1e790` (`config/zoneExpedition`, `desktop/desktopAccountReply`, `desktop/desktopDashboardFields`, `holozone/expedition`, `lib/desktopItems`, `lib/economy`, `lib/holoZoneRuns`, `lib/progressionEconomy`). That is the re-pin's work once the hardening set is deployed (HELD, below).

## Self-review (read-only critic)

One read-only critic subagent reviewed `f1f21b8` against #145 at `e9091f0`. It read only through git objects (`git show` / `git diff` / `git grep`) and made no ref or working-tree writes. It was refute-first on rule 1, legacy-flag safety and "host" on screen. **No high-severity finding; rule 1 and rule 3 held.** Fixed in `7cc6b63` (lite) and `82d5735` (main):

| # | Finding (verdict, severity) | Fix |
|---|---|---|
| F1 | A legacy training with an unreadable `endsAt` (e.g. a main-app Timestamp) blocked SELECT forever: no CLAIM, so the City could never refuse it (CONFIRMED path, medium). | An unreadable end time reads `legacy_ready`: TRY CLAIM is offered and the City's answer closes it. |
| F2 | A City card refused `not_started_on_host` (already paid, reply lost, flag off) showed the older-app copy (CONFIRMED, low). | `progressionRefusalCopy(…, cardSource)`: a City card gets "may already be claimed". |
| F3 | Cards were classified from two listeners (AuthContext `rewardSystem` + the timers listener) that can commit apart (PLAUSIBLE, low). | `useCityProgression` reads `progressionTimers` and `rewardSystem` from one snapshot. |
| F5 | Refused legacy runs reopened each launch (memory only) (CONFIRMED, low). | Persisted per account in AsyncStorage (`progression-legacy-refused-1:<uid>`, last 50). Display state only. |
| F6 | A failed timers listener never recovered (CONFIRMED, low). | RETRY on the note, and a re-subscribe on foreground. |
| F7 | Mission CLAIM stayed enabled during a re-read; double taps (CONFIRMED, low; the host refuses both). | One claim at a time; claims only when the ledger read is settled. |
| F8 | The offline QA harness could reach real claim callables with a persisted dev session (CONFIRMED, low). | Every claim needs a session (`uid` / `user`). |
| F9 | One unknown `questId` / `courseId` blanks the whole record (PLAUSIBLE, low). | **Not changed.** This is fail-closed like the host, and the tables are parity-tested. A new quest or course needs a client release before it is offered. Noted for the host lane. |
| F4 | A resurrected host training display copy (no run id) looks like a legacy run (PLAUSIBLE, low; host gap). | Host note below. |

The critic also said the fixture's "generated by #145" claim was unproven in lite. The generator is the builder in main's `progressionHost.test.ts`: it regenerates the fixture from #145's functions once they are on main, and it passed locally as shown above. In addition, the "no client writes" proof is now app-wide: a scan of every runtime `src` file for `rewardSystem` writers and users-doc `updateDoc`s.

## Simulator witness

One bounded run at `f1f21b8` (now `af8eab9`, same tree; clean), with offline Metro and the cached `fun.holobots.mobile.w64` on iPhone 17 Pro / iOS 26.5. Nothing was built or installed. Evidence is in `~/HolobotsVault/QA/2026-10-18-lite-progression-host-1/`: four cell PNGs, `metro.log`, `launch.txt` and `source-head.txt`.

- Metro: `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_HOLOCITY_PREVIEW=1 npx expo start --offline --port 8081 --clear`, giving `iOS Bundled 14317ms index.js (1646 modules)` with no error lines.
- Navigation: `simctl openurl holobotsw64://qa/<cell>`, 6 s per cell, then `simctl io screenshot`.
- Cleanup: the app was terminated, Metro stopped, and port 8081 is free. The simulator was left booted.

| Cell | Result |
|---|---|
| 01 ProgressionQuests | PASS. ACTIVE QUESTS 1/3 counts the City run only. CAVE EXPLORATION · ACE shows "ENDS 11:34 · …" from the City record and RUNNING. FOREST PATROL · KUMA shows "STARTED ON AN OLDER APP · TRY CLAIM" with CLAIM enabled. FACTORY RAID · SHADOW shows "THE CITY CAN'T PAY THIS RUN · START A NEW ONE" with CLOSED. The picker offers KUMA, because ACE is busy on the City run and a legacy run does not hold a bot. |
| 02 ProgressionTraining | PASS. "KUMA is in ALL training." with "ENDS 12:04 · …" and the City's rolled boost (+7 ×5, EXP +140). Every SELECT is disabled (training_active). |
| 03 ProgressionMissions | PASS. The ledger gives Check-in 1/1 CLAIM, Arena 0/3 and Pack 1/1 Claimed, although the device mirror says 99/99. |
| 04 ProgressionMissionsPaused | PASS. No ledger: the device count is shown (3/3), every Claim is disabled, the summary says 0 Tickets, and "Couldn't reach the City. Showing this device's count; claims are paused. RETRY". |

**Changed since the witness, covered by tests only:** the remaining time now reads "11m 55s LEFT" / "1h 02m LEFT", because the witness showed "ENDS 11:34 · 11:55", which reads as two clock times.

## HELD / not done

- **#145 merge and deploy (both PRs).** Both PRs are DRAFT and HELD on host #145. Before the deploy, `startQuestRun` / `startTrainingSession` do not exist, so SEND / SELECT show "The City couldn't find that. It may not be open yet." **Do not ship either PR before #145 is deployed.**
- **Legacy-flag-off readiness.** Once these PRs ship, lite and main's gated tree never write client timers and read only the City's records. The flag (`HOLOCITY_LEGACY_QUEST_TIMERS`) is then needed only for runs started by older builds (and by the main app, which this lane does not change). After it goes off, those runs show the honest closed state. **The producer decides when to turn it off, after the hardening deploy and after these ship.**
- **Re-pin #141's host pin: HELD.** The hardening set is not deployed (and #145 is not merged). When it is: `node mobile/scripts/pin-host.mjs --check <deployed main sha>`, then `--sha <deployed main sha>` on `mobile-holocity-lite`. Update the known-drift ratchets, and take main's updated parity tests (#145 adds `getHolobotPowerScore` parity to `progressionServerParity.test.ts`).
- **Rebase the lite PR once #144 lands.**
- **Main's gated tree has no Daily Missions change.** It has no host-dashboard reader; its `DailyMissionsModal` still claims from the device copy (the host still validates every claim). Port `hostDashboard`'s ledger reader in a later main lane.
- **Host notes (no host edits here):**
  - F4: the host's `rewardSystem.activeTraining` display copy carries no run id, unlike quests (`qr_…`). A stale full-map write by an older client after a City claim makes it look like a legacy run, and with the flag on `resolveTrainingClaim` would pay it again. Suggestion: put `runId` (`tr_…`) on the display copy, and have both legacy paths refuse `qr_` / `tr_` ids.
  - Dead legacy copies are never pruned: the host refuses `not_started_on_host` before writing, and clients can no longer remove them. Suggestion: prune the refused legacy entry, or sweep legacy copies when the flag goes off.
  - `useEnergyRegen` (pre-existing, unchanged) writes an absolute `dailyEnergy` from the last snapshot. It can overwrite a host debit that lands in between, which is the S3 "energy not hardened" note.
- **Not witnessed on device:** the start / claim round trips (they need the deployed callables) and the critic fixes (tests only). On the witnessed cells, after F8 the offline missions cell's Claim is disabled, because there is no session.
