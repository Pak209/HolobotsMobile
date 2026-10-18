# lite-test-parity-1: parity tests run against the deployed host; the host integration lane fails loudly

Base: `mobile-holocity-lite` c187921. Host pin: `main` 3b1e790 (#129), the commit the Firebase functions host is deployed from (the brief says so; nothing here checks it, see HELD). This PR closes functioning-critic rows **F5** and **F6** (`HolobotsUnity/Documentation/HANDOFFS/2026-10-17-critic-review.md`). It changes test files, `mobile/vitest.config.ts`, test fixtures and helpers, and adds one script. It does not touch product code, `functions/`, `firestore.rules` or CI.

## F5: what the parity tests import now

Before this PR, 20 test files under `mobile/src/lib/__tests__` used the branch's own host copy. All 20 imported `../../../../functions/src/...`, and 2 of them also read host files from disk (`battleSettlementParity`, `rivalLadderScaleParity`). That copy is 23 files / +1220 lines behind main.

Now they use `mobile/test-fixtures/host-pin/src/...`. That folder is a verbatim copy of the 43 host files the tests need: 23 entry points plus their relative-import closure. The files come from git objects at 3b1e790, not from a working tree. `host-pin/HOST_PIN.json` records:

- the full sha
- the tree id of `3b1e790:functions/src` (`srcTree` 006b1c7)
- each file's git blob id, matching `git rev-parse 3b1e790:functions/src/<path>`

Every run prints the host it used:

```
[host-pin] parity imports resolve to test-fixtures/host-pin/src (pinned 3b1e790d80f2ef8067bdcb7b1e94c6aa0047b04f: origin/main 3b1e790 (#129): the commit the Firebase functions host is deployed from (2026-10-17))
```

`src/lib/__tests__/hostPin.test.ts` and `vitest.config.ts` keep the pin honest. Each check fails the suite:

| Check | Fails when |
|---|---|
| Snapshot vs manifest | a byte of `host-pin/src` was edited, or a stray file was added or removed |
| Snapshot = what mobile/src names + closure | a source imports a host module that is not pinned, or the pin carries unused files |
| No branch host, at load time | anything loads a module from the branch's `functions/`, however it is reached: relative, `@/` alias, template or dynamic import, or a re-exporting helper. The plugin is in `vitest.config.ts`. |
| No branch host, statically | any string literal under `mobile/src` names `functions/src` or `functions/lib`, including `path.join(…, "functions", "src", …)` segments. This covers `fs` reads, which do not go through the loader. The scan reads literals only (TypeScript AST), so comments do not count. |
| Resolved host = pinned bytes | the host being served (`HOLOCITY_HOST_ROOT`) differs from the pin. This is the drift check. |
| Manifest vs git objects | the blob ids or `srcTree` differ from 3b1e790's tree. When the clone lacks 3b1e790 (a depth-1 CI checkout), this is **skipped with its reason printed**. `HOLOCITY_REQUIRE_HOST_PIN_GIT=1` makes the skip a failure. |

`HOLOCITY_HOST_ROOT=<any functions/ dir>` redirects every pinned import, plus the two byte reads (through `hostSourceFile`), to that checkout. It is a resolver plugin that runs only when the variable is set. Use it to preview a re-pin or to run the known-bad control. A file missing from that root is a load error, never a fallback.

**Why vendor, not an alias to a main checkout or a sync of `functions/`.** CI's mobile job checks out only the PR head, depth 1. An alias or env var has nothing to point at there unless `ci.yml` fetches main, and `ci.yml` is out of this lane's bounds. Syncing `functions/` would collide with the host lane that owns `functions/` on main tonight. A sha-stamped snapshot is the only option that makes the default run (CI, any clone, offline) test the deployed host with no workflow change. Re-pinning also produces a reviewable diff of exactly the host code the client is tested against. It costs 43 fixture files (~370 KB). Only tests import them, so they never reach the app bundle.

**Re-pin after every host deploy** (git objects only, no network once the sha is fetched):

```sh
cd mobile
node scripts/pin-host.mjs --check <deployed sha>   # exit 1 + list if the pin has drifted from what is deployed
node scripts/pin-host.mjs --sha <deployed sha> --note "<what is deployed from it>"
npx vitest run
```

`--check` with no argument verifies two things: the snapshot is byte-identical to the pinned commit, and `srcTree` matches. When the clone has `origin/main` and main has changed a pinned file since the pin, every run prints a warning, not a failure, because main can carry undeployed host changes. Nothing fails by itself after the next deploy until someone runs `--check <deployed sha>`. That is HELD below.

**desktopAccountParity.** The key assertion now compares sorted keys against main's real key set: `attributePoints, battleStats, battlefieldMovement, boostedAttributes, career, displayStats, experience, level, name, nextLevelExp, rank`. It is order-insensitive *and* exact. Before the fix, against the pin, the old assertion reproduced the critic's failure exactly: `expected [ 'battlefieldMovement', …(1) ] to deeply equal [ 'battleStats', 'displayStats' ]`.

**rivalLadderScaleParity, a known client drift recorded exactly.** "The pair is byte-identical" used to read the branch's own `functions/src/lib/rivalTierStats.ts`, which is why it passed. The deployed host's copy appends `RIVAL_NAMED_PROFILES` (main 9e2f4eb, the JUSAN story rival), and this branch's client copy `mobile/src/lib/rivalTierStats.ts` predates it. Syncing that file is product work, so this test now checks two things:

- the client copy is a byte-exact prefix of the deployed host's copy
- the host-only suffix declares exactly `RIVAL_NAMED_PROFILES`

It prints `KNOWN DRIFT` on every run. Any other change fails. So does the sync itself, because then the suffix is empty, and the known-drift branch must be deleted.

## F6: the real-host + Firestore suite cannot silently skip

`cityHost.integration.test.ts` has a gate with four prerequisites:

- `HOLOCITY_TEST_HOST_ROOT` is set to a built `functions/` dir with `lib/admin.js`.
- `FIRESTORE_EMULATOR_HOST` is `127.0.0.1:<port>`.
- `GCLOUD_PROJECT` is a `demo-` project.
- The existing "Production is forbidden" guard still passes.

When it runs, it identifies its host by content: the whole `src/` tree id against the pin's `srcTree`, and `lib/*.js` no older than `src/*.ts`.

| Mode | Result |
|---|---|
| Default (nothing set) | skipped, and the reason is printed: `[cityHost.integration] SKIPPED (opt-in): HOLOCITY_TEST_HOST_ROOT is not set …; HOLOCITY_REQUIRE_HOST_INTEGRATION=1 makes this a failure.` |
| `HOLOCITY_REQUIRE_HOST_INTEGRATION=1`, a prerequisite missing | **exit 1**, `Error: HOLOCITY_REQUIRE_HOST_INTEGRATION=1 but: <each missing prerequisite>`. The file FAILs, and its 3 tests are reported as skipped. |
| `=1`, but the host is not the pinned deployed host, or `lib/` is stale | **exit 1** before any data is written ([log](emulator-refuses-stale-host.txt)): `src/ tree 53c0bed… is not the pinned deployed host's 006b1c7…`, or `lib/ is older than or missing for 1 src/ file(s) … rebuild` |
| All prerequisites set, no `=1` | runs against whatever host is given and prints whether it is the pinned deployed host (for testing a candidate host) |

The other opt-in emulator proof, in `genesisSignupParity.test.ts`, needs a desktop-created UID. It now prints its skip reason too. Every skip in the mobile suite says why: an AST scan by the self-review found no other conditional skips.

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
| After, default (pinned 3b1e790) | 76 passed, 1 skipped | **695 passed**, 4 skipped (each with a printed reason) | 0 |
| After, depth-1 clone (what CI checks out) | 76 passed, 1 skipped | 694 passed, 5 skipped (the 5th is the git cross-check, reason printed) | n/a |
| After, depth-1 clone + `HOLOCITY_REQUIRE_HOST_PIN_GIT=1` | 1 failed | git cross-check fails with its reason | n/a |
| After, `HOLOCITY_HOST_ROOT` = main 3b1e790 checkout | 76 passed, 1 skipped | 695 passed, 4 skipped | n/a |
| **Known-bad control:** `HOLOCITY_HOST_ROOT=../functions` (the stale branch copy) | **3 failed**, 73 passed | **4 failed**, 691 passed | n/a |
| `HOLOCITY_HOST_ROOT=/nonexistent` | startup error: `has no src/ directory` | n/a | n/a |

The 8 new tests are all in `hostPin.test.ts`. The known-bad control ([log](known-bad-control.txt)) catches the stale host in 4 tests:

1. `hostPin › resolved host serves exactly the pinned bytes` lists 10 files: `differs config/zoneExpedition.ts, differs desktop/desktopAccountReply.ts, missing desktop/desktopDashboardFields.ts, differs holozone/expedition.ts, missing lib/battlefieldMovement.ts, differs lib/rivalLadder.ts, differs lib/rivalTierStats.ts, missing sim/movement.ts, missing sim/types.ts, missing story/tournamentUnlocks.ts`.
2. `desktopAccountParity`: the stale host lacks `battlefieldMovement`.
3. `rivalLadderScaleParity`: the stale host lacks `RIVAL_NAMED_PROFILES`.
4. `hostPin › loading the branch copy is refused`: expected to fail here, because the control points at the branch copy on purpose.

`node scripts/pin-host.mjs --check origin/mobile-holocity-lite` reports the same 10 files and exits 1.

**Emulator run, against the deployed host: 1 passed, 2 failed** ([log](emulator-run-deployed-host.txt)). The host is verified as tree 006b1c7 with a fresh `lib/`. Firestore emulator v1.19.8 was already cached, ran via `java -jar` on 127.0.0.1:18095 with project `demo-holocity-lite-parity`, and was stopped afterwards. The UIDs were throwaway, and each one's `users` / `rivalBattles` / `workshop*` docs were deleted.

1. PASS: the real gathering reply parses, Arena opens and Zone stays hidden.
2. **FAIL, a real contract break that the always-skipping suite was hiding.** Host commit 8f82e19 (2026-10-15, "match gathering rival issue projection to Unity", on both main and lite) deletes `playerCombatants` from roster-citizen issues. The lite reader `readCityRivalIssue` (`mobile/src/lib/cityRivalBattle.ts:33-35`) still requires it, so every citizen issue is refused with "The rival host did not return a playable squad". The branch's own host fails the same way. Live citizen duels are currently off in lite (critic F8, bdb1c6d), so players cannot reach this today.
3. FAIL (`battle_open`). This is a cascade: test 2 left its issued battle open. A one-off debug run made the same host calls without the client reader, and the host behaves as the test expects: 8 loss settlements × 25 Holos → 1200, heal cost 0 for `["ace"]`, craft 1 repair kit for 3 fragments, replay `alreadyProcessed`.

## Adversarial self-review (read-only critic, disposable copy)

| # | Finding | Disposition |
|---|---|---|
| 1 HIGH | `rivalLadderScaleParity` still read the branch's `functions/` through `path.join` segments, and passed only because of that | fixed: reads the deployed host and records the known drift exactly |
| 2 MED | the text guard missed alias, template, helper and `path.join` routes | fixed: load-time refusal plus an AST literal scan of all of `mobile/src`. All four of the critic's routes now fail. |
| 3 MED | the origin/main warning used a mobile-relative pathspec and never fired; nothing fails after the next deploy | pathspec fixed (`:(top)`). A failure on deploy is HELD below. |
| 4 MED-LOW | in a shallow clone, a forged file plus manifest passes | `HOLOCITY_REQUIRE_HOST_PIN_GIT=1` fails instead of skipping. Wiring it into CI is HELD. |
| 5 LOW-MED | the integration lane could not tell which host it ran | fixed: whole-tree id plus `lib/` freshness, refused under `=1` |
| 12 | README CI counts | fixed (table above) |

Refuted: snapshot bytes = 3b1e790 (43/43 blob ids); one-byte edits caught; the redirect covers entry, transitive and JSON imports; gate modes and production safety; scope (no product, `functions/` or CI change; nothing vendored is reachable from the app). One mishap: while testing finding 3, the critic moved the shared `refs/remotes/origin/main` to c187921 twice, for about 3 seconds each time (21:50:15 and 21:56:03 local), and restored it to 3b1e790 both times. Any sibling session that read origin/main in those windows saw the wrong ref.

## HELD / not done

- **Deploy-time failure.** Nothing records the deployed sha in the repo, so the pin goes stale silently until someone runs `pin-host.mjs --check <deployed sha>`. The minimal fix: the deploy step writes a deployed-sha marker, and a test compares it with `HOST_PIN.json`. That needs deploy tooling owned by the host/producer lane.
- **CI.** `ci.yml` needs `git fetch --depth=1 origin <pin sha>` plus `HOLOCITY_REQUIRE_HOST_PIN_GIT=1`, and an emulator job with `HOLOCITY_REQUIRE_HOST_INTEGRATION=1`. That is outside this lane. The emulator job would fail today because of finding 2.
- **Product follow-ups** for a lite lane: the `readCityRivalIssue` fix (accept citizen issues without `playerCombatants`, or source the entrant the way Unity does), and syncing `mobile/src/lib/rivalTierStats.ts` from main (then delete the known-drift branch).
- **Is 3b1e790 what Firebase actually runs?** Only the deploy log or console can confirm it.
- Simulator: not run (not needed). No deploy, no real account, no network install, no `functions/` or rules edit.
