# lite-host-drift-fix-1

This PR fixes two client drifts from the deployed host that lite-test-parity-1 (PR #141) exposed. It touches client code only. There are no `functions/` or `firestore.rules` edits, no deploys, no real accounts and no network installs. Citizen duels stay held: `CITY_LIVE_DUELS_HELD` is still `true` and `issueCityRival` still refuses.

**Deployed host used:** main `a90d061`, the sha in `mobile/test-fixtures/host-pin/HOST_PIN.json`. PR #151 re-pinned it after the brief named `3b1e790`. `a90d061` contains `8f82e19`. The integration lane checks that the built host's `src/` tree equals the pinned tree `3db577e`, and it did (see `integration.txt`, line 5).

## 1. Citizen issues without `playerCombatants`

**Host change.** Host commit `8f82e19` ("match gathering rival issue projection to Unity") changes `rivalBattleStore.ts`. For a roster-citizen issue (`storySchema: "arena-gathering-1"`, `rivalId`), the host still pins vitals and resolver fighters, then deletes the optional `playerCombatants` from the reply. Ordinary rival replies keep it.

**How Unity handles it.** `RivalBattleContract.Issue` (HolobotsUnity `RivalBattleContract.cs`) treats `playerCombatants` as optional. When it is absent, Unity:
- keeps its local player presentation payload;
- sends no `fielded` (`FieldedFor` returns null when no travel squad was issued);
- settles with the minimal legacy `didWin`.

In legacy mode the host sends no player stats at all. In resolver mode (`HOLOCITY_RIVAL_ISSUE_RESOLVER=1`, held), the pinned fighters arrive in `duel.player`.

**Lite fix** (`mobile/src/lib/cityRivalBattle.ts`):
- `CityRivalIssue.player` is now `CityCombatant | null`.
- If `playerCombatants` is absent, `player` is `null`. It is never filled from the profile or from local stats.
- If `playerCombatants` is present, it must still be a valid, non-empty squad. `null`, `{}`, `[]` and bad stats are all refused, as before.
- Every other check is unchanged: schema, battle id, expiry, encounter id, pilot id, a single valid opponent, and the expected bot.

**Caller change** (`CityRivalBattle.tsx`). `enterBattle` refuses a `null` entrant with `CITY_RIVAL_NO_ENTRANT`. This is PLACEHOLDER copy (Lex, DECISIONS #71). Local play therefore never runs on invented stats. The receipt screen reads `issue.player?.holobotId`.

**Re-enabling live citizen duels is a separate decision.** It needs a resolver-backed entrant, with stats read from `duel.player` and settled through `settleCityResolver`. That stays held.

## 2. `rivalTierStats.ts` byte sync

`mobile/src/lib/rivalTierStats.ts` is now copied from `origin/main`, which adds `RIVAL_NAMED_PROFILES` from 9e2f4eb. It is byte-identical to both `main` and `test-fixtures/host-pin/src/lib/rivalTierStats.ts` (`cmp`). The KNOWN DRIFT branch in `rivalLadderScaleParity.test.ts` is deleted. The test is back to a plain byte-identity assertion against `hostSourceFile("lib/rivalTierStats.ts")`, and its `typescript` import was dropped.

## Tests

- `cityRivalBattle.test.ts` has a new case. A citizen reply without `playerCombatants` reads as `player: null`, with host opponent stats and `raw` preserved. The case also checks fail-closed behaviour for: an empty or bad opponent squad, the wrong pilot, an expired issue, and `playerCombatants: null` or `{}`.
- `cityHost.integration.test.ts`, test 2, now runs against the real deployed host. For each of the 8 roster citizens it checks that:
  - the raw issue has no `playerCombatants` key;
  - the reader returns `player: null`;
  - the opponent fighter equals the host's `opponentSquad[0]` stats.

  It then settles the way Unity does in its minimal settle: a `didWin: false` loss with no `fielded`. It also checks the 25-Holos receipt, a replay with `alreadyProcessed`, the `rival_cooldown` `retryAfterMs` of 299,000, and 1,200 Holos in total.

  The local `ArenaCombatEngine` round was removed. It needed player stats that the host no longer sends, and inventing them is forbidden.

## Evidence

- `tsc.txt`: `npx tsc --noEmit` exit 0.
- `vitest.txt`: `npx vitest run` → 93 files passed with 1 skipped; 1273 tests passed with 4 skipped. The skipped file is the opt-in integration lane.
- `integration.txt`: the opt-in lane passes 3/3 against the built deployed host. It ran with `HOLOCITY_REQUIRE_HOST_INTEGRATION=1`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:18095` and `GCLOUD_PROJECT=demo-holocity-lite-parity`. Setup:
  - host: `git worktree add --detach <scratch> a90d061`, a symlinked `functions/node_modules`, then `npx tsc`;
  - emulator: `java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host=127.0.0.1 --port=18095`.
- `host80-mobile-replies.json`: the raw replies captured from that run (gathering, issue, settlement, replay, per-citizen summary, heal, craft). It uses only a throwaway local emulator uid.

## Follow-up found (not fixed here)

`readCityRivalSettlement` always returns a `duelReceipt` key, even when it is `undefined`. On a legacy settle, which carries no `duelReceipt` on the wire, `normalizeDuelReceipt(settlement)` therefore goes down the host-receipt path. It returns `receiptError` with `didWin: null`. Passing the raw settlement reply gives the correct `didWin: false` with `traceSource: "none"`, and that is what the integration test now uses.

This only affects the held legacy citizen-duel path: the live resolver path always has a real receipt. It is a one-line fix: only spread `duelReceipt` when the key is present. It should go in its own small PR with a playback test.
