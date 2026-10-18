# lite-test-parity-1: parity tests run against the deployed host; the host integration lane fails loudly

Base: `mobile-holocity-lite` c187921. Host pin: `main` 3b1e790 (#129), the commit the Firebase functions host is deployed from. This PR closes functioning-critic rows **F5** and **F6** (`HolobotsUnity/Documentation/HANDOFFS/2026-10-17-critic-review.md`). It changes test files, `mobile/vitest.config.ts` and test fixtures and helpers only. It does not touch product code, `functions/`, `firestore.rules` or CI.

## F5: what the parity tests import now

Before this PR, 20 test files under `mobile/src/lib/__tests__` imported `../../../../functions/src/...`. That is the branch's own host copy, which is 23 files / +1220 lines behind main. The tests passed against a host that is not deployed.

Now they import `mobile/test-fixtures/host-pin/src/...`. That folder is a verbatim copy of the 43 host files the tests need: 23 entry points plus their relative-import closure. The files come from git objects at 3b1e790, not from a working tree. `host-pin/HOST_PIN.json` records the full sha and each file's git blob id, and those ids match `git rev-parse 3b1e790:functions/src/<path>`. Every run prints which host it used:

```
[host-pin] parity imports resolve to test-fixtures/host-pin/src (pinned 3b1e790d80f2ef8067bdcb7b1e94c6aa0047b04f: origin/main 3b1e790 (#129): the commit the Firebase functions host is deployed from (2026-10-17))
```

`src/lib/__tests__/hostPin.test.ts` keeps the pin honest. Each of these fails the suite:

| Check | Fails when |
|---|---|
| Snapshot vs manifest | a byte of `host-pin/src` was edited by hand, or a stray file was added or removed |
| Snapshot = test imports + closure | a test imports a host module that is not pinned, or the pin carries unused files |
| No branch host | any test imports `../functions/src/` or `../functions/lib/` again |
| Resolved host = pinned bytes | the host being served (`HOLOCITY_HOST_ROOT`) differs from the pin. This is the drift check. |
| Manifest vs git objects | the manifest's blob ids differ from 3b1e790's tree. It only runs when the clone has that commit. Otherwise it is reported as **skipped**, with the reason and `git fetch origin 3b1e790`. A shallow CI checkout lands here, and the content check above still runs. |

`HOLOCITY_HOST_ROOT=<any functions/ dir>` redirects every pinned import, plus the `battleSettlement.ts` byte read, to that checkout. It is a small resolver plugin in `vitest.config.ts`, and it runs only when the variable is set. Use it to preview a re-pin or to run a known-bad control. A missing file in that root is a load error, never a fallback.

**Why vendor, not an alias to a main checkout or a sync of `functions/`.** CI's mobile job checks out only the PR head, depth 1. An alias or env var has nothing to point at there unless `ci.yml` fetches main, and `ci.yml` is out of this lane's bounds. Syncing `functions/` would collide with the host lane that owns `functions/` on main tonight. A sha-stamped snapshot is the only option that makes the default run (CI, any clone, offline) test the deployed host with no workflow change. Re-pinning also produces a reviewable diff of exactly the host code the client is tested against. It costs 43 fixture files (~370 KB). They are imported only by tests, so they never reach the app bundle.

**Re-pin after every host deploy** (git objects only, no network once the sha is fetched):

```sh
cd mobile
node scripts/pin-host.mjs --check <deployed sha>   # exit 1 + list if the pin has drifted from what is deployed
node scripts/pin-host.mjs --sha <deployed sha> --note "<what is deployed from it>"
npx vitest run
```

`--check` with no argument checks that the snapshot is byte-identical to the pinned commit. When a local clone has `origin/main` and main has moved past the pin in a pinned file, the suite prints a warning, not a failure, because main can carry undeployed host changes.

**desktopAccountParity.** The key assertion now compares sorted keys against main's real key set: `attributePoints, battleStats, battlefieldMovement, boostedAttributes, career, displayStats, experience, level, name, nextLevelExp, rank`. It is order-insensitive *and* exact. If the deployed host adds or drops a holobot field, the test fails at re-pin time. Before the fix, against the pin, the old assertion reproduced the critic's failure exactly: `expected [ 'battlefieldMovement', …(1) ] to deeply equal [ 'battleStats', 'displayStats' ]`.

## F6: the real-host + Firestore suite cannot silently skip

`cityHost.integration.test.ts` has a gate with four prerequisites:

- `HOLOCITY_TEST_HOST_ROOT` is set to a built `functions/` dir with `lib/admin.js`.
- `FIRESTORE_EMULATOR_HOST` is `127.0.0.1:<port>`.
- `GCLOUD_PROJECT` is a `demo-` project.
- The existing "Production is forbidden" guard still passes.

| Mode | Result |
|---|---|
| Default (nothing set) | skipped, and the reason is printed: `[cityHost.integration] SKIPPED (opt-in): HOLOCITY_TEST_HOST_ROOT is not set …; HOLOCITY_REQUIRE_HOST_INTEGRATION=1 makes this a failure.` |
| `HOLOCITY_REQUIRE_HOST_INTEGRATION=1`, a prerequisite missing | **exit 1**, `FAIL … Error: HOLOCITY_REQUIRE_HOST_INTEGRATION=1 but: <each missing prerequisite>` |
| All prerequisites met | runs. It logs whether the host's `src/` matches the pinned deployed host (content check against `HOST_PIN.json`) and records that in the capture. |

The other opt-in emulator proof, in `genesisSignupParity.test.ts`, needs a desktop-created UID. It now prints its skip reason too. No test in the mobile suite skips without saying why.

**Run it locally** against the deployed host, using a loopback emulator, a demo project and throwaway UIDs:

```sh
# 1. Build the pinned host in a scratch checkout (reuse an existing functions/node_modules, or npm ci)
git worktree add --detach ../host-3b1e790 3b1e790
ln -s "$PWD/functions/node_modules" ../host-3b1e790/functions/node_modules
(cd ../host-3b1e790/functions && npx tsc)
# 2. Loopback Firestore emulator; this is the cached jar, so nothing downloads
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host=127.0.0.1 --port=18095
# 3. From mobile/, in another shell
HOLOCITY_REQUIRE_HOST_INTEGRATION=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:18095 \
GCLOUD_PROJECT=demo-holocity-lite-parity HOLOCITY_TEST_HOST_ROOT="$PWD/../../host-3b1e790/functions" \
npx vitest run src/lib/__tests__/cityHost.integration.test.ts
```

## Results

| Run | Files | Tests | tsc |
|---|---|---|---|
| Before, lite c187921 (parity on the branch's `functions/`) | 75 passed, 1 skipped | 687 passed, 4 skipped (silent) | 0 |
| After, default (pinned 3b1e790) | 76 passed, 1 skipped | **694 passed**, 4 skipped (each with a printed reason) | 0 |
| After, `HOLOCITY_HOST_ROOT` = main 3b1e790 checkout | 76 passed, 1 skipped | 694 passed, 4 skipped | n/a |
| **Known-bad control:** `HOLOCITY_HOST_ROOT=../functions` (the stale branch copy) | **2 failed**, 74 passed | **2 failed**, 692 passed | n/a |
| `HOLOCITY_HOST_ROOT=/nonexistent` | startup error: `has no src/ directory` | n/a | n/a |

The 7 new tests are all in `hostPin.test.ts`. The known-bad control ([log](known-bad-control.txt)) caught the drift twice:

- `hostPin`: `differs config/zoneExpedition.ts, differs desktop/desktopAccountReply.ts, missing desktop/desktopDashboardFields.ts, differs holozone/expedition.ts, missing lib/battlefieldMovement.ts, differs lib/rivalLadder.ts, differs lib/rivalTierStats.ts, missing sim/movement.ts, missing sim/types.ts, missing story/tournamentUnlocks.ts`
- `desktopAccountParity`: the stale host lacks `battlefieldMovement`

`node scripts/pin-host.mjs --check origin/mobile-holocity-lite` reports the same 10 files and exits 1.

**Emulator run, against the deployed host: 1 passed, 2 failed** ([log](emulator-run-deployed-host.txt)). The host's `src/` matches the pin. Firestore emulator v1.19.8 was already cached, ran via `java -jar` on 127.0.0.1:18095 with project `demo-holocity-lite-parity`, and was stopped afterwards. The UIDs were throwaway (`mobile_city_throwaway_<ms>`, `debug_*`), and each one's `users` / `rivalBattles` / `workshop*` docs were deleted.

1. PASS: the real gathering reply parses, Arena opens and Zone stays hidden.
2. **FAIL, a real contract break that the always-skipping suite was hiding.** Host commit 8f82e19 (2026-10-15, "match gathering rival issue projection to Unity", on both main and lite) deletes `playerCombatants` from roster-citizen issues. The lite reader `readCityRivalIssue` (`mobile/src/lib/cityRivalBattle.ts:33-35`) still requires it, so every citizen issue is refused with "The rival host did not return a playable squad". The branch's own stale host fails the same way. Live citizen duels are currently off in lite (critic F8, bdb1c6d), so players cannot reach this today. It is product code, so this lane does not fix it.
3. FAIL (`battle_open`). This is a cascade: test 2 left its issued battle open. A one-off debug run made the same host calls without the client reader, and the host behaves as the test expects: 8 loss settlements × 25 Holos → 1200, heal cost 0 for `["ace"]`, craft 1 repair kit for 3 fragments, replay `alreadyProcessed`.

## HELD / not done

- **CI does not run the integration lane yet.** Adding an emulator job with `HOLOCITY_REQUIRE_HOST_INTEGRATION=1` means editing `.github/workflows/ci.yml`, which is outside this lane. It would fail today because of finding 2.
- **The `readCityRivalIssue` fix** (accept citizen issues without `playerCombatants`, or source the entrant the way Unity does) is product code for a lite arena lane.
- Re-pinning stays manual. It is part of each host deploy (`--check <deployed sha>`).
- Simulator: not run (not needed). No deploy, no real account, no network install, no `functions/` or rules edit.
