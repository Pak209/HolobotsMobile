# Town presence — M1 host (2026-10-10)

Other signed-in pilots can be projected into HoloCity without sharing accounts or combat. This PR adds the host half; Unity is a staged package, not installed. No production deploy ran.

Contract: `presence-1`, matching the Unity M1 design (`Documentation/HANDOFFS/2026-10-10-m1-ghosts-in-town-design.md`). Caller UID comes only from authentication. The host reads the existing wardrobe-3 city loadout and travel-squad-1 records. Requests cannot supply names, clothes, levels, rank or economy. A server principal is refused, as required by SERVER_TOKEN.md. Every write is an aggregate-doc transaction, retaining parallel pilots, pruning expired rows, and removing opt-outs and deleted accounts. Deletion now removes the public row after profile deletion, so a racing heartbeat cannot resurrect a deleted identity.

| Gate | Result | Known-bad control |
|---|---|---|
| TypeScript and shared parity | 0 errors; 3 parity files unchanged | Test-only invalid TypeScript is rejected by the same compiler (verify.sh) |
| Pure projection | 4 tests pass | Forged name, level and wardrobe do not appear; bad scene/deployment/non-finite values refused |
| Local Firestore transaction | 3 tests pass | No-auth/server principals refused; invalid deployment writes nothing; expired emote cannot revive a pilot |
| Firestore rules | 2 tests pass | All forged creates/updates/deletes and anonymous reads refused; foreign/malformed opt-out denied |

Existing pure function regression: **124/124 pass**.

Run `bash scripts/verify-town-presence.sh`; dependencies must already be installed (no download). Emulator tests use demo-only project, isolated port, cached emulator and no Pak account. Local emulator never deploys.

Bounds are a conservative town presentation envelope, X/Z ±256 m, Y −64..256 m; 0.5 m rounded positions, 90 s expiry, 3 s wave. Chair must verify the current scene fits this envelope before installation. These are presentation coordinates, not collision validation. One Firestore document is deliberate for M1; write-contention/cost at larger crowds still needs deployment telemetry. Mobile is not a presence source.

Deploy only after Pak merges/approves: `presenceHost`, `deleteUserAccountV2`, rules. A real two-pilot Play witness is deferred to the editor lane against a local emulator; this host suite does not prove visual replicas or production presence.

## 2026-10-11 re-verification + write-path / expiry gates (chair lane)

Run 2026-10-11 01:41–02:08 UTC (2026-10-10 18:41–19:08 PDT), off-editor. LOCAL Firestore emulator only: `--project demo-holobots-presence`, port 8792, plus the demo namespaces `demo-holobots-presence-expiry` (expiry file) and `demo-presence-rules-weakened` (known-bad rules). No deploy, no credentials, no installs or downloads (cached emulator JAR v1.19.8, Java on PATH).

**PR head e0c508e as-is:** build 0 errors (3 parity files in sync), pure 4/4, emulator 3/3, rules 2/2.

**Added:** `rules-tests/tests/presence-write-paths.test.ts` (+ `readRulesText` / `initTestEnvWithRules` in `rules-tests/src/helpers.ts`), `functions/scripts/test-presence-expiry-emulator.mjs`, one pure test in `test-presence.mjs`. Wiring: `functions/package.json` `test` gains `test-presence.mjs`; `test:emulator` gains both presence emulator files. `scripts/verify-town-presence.sh` falls back to the `java` on PATH when `/usr/libexec/java_home` is absent, and takes `PRESENCE_EMULATOR_PORT` (default 8781). It also runs the new files and passes `vitest --no-cache --configLoader runner`, so nothing is written into a shared `node_modules`, and it removes its generated config on exit.

Mutants below are scratch copies of compiled `functions/lib` or of `firestore.rules`. They were run against the unchanged test files and never committed.

| Gate | Result | Known-bad control |
|---|---|---|
| Every client write path on `presenceScenes`. Write types: create, overwrite, update, merge, delete, WriteBatch set/update/delete, runTransaction set/update/delete, get-then-set. Paths: `HoloCity_Main`, `NeonForest`, `HoloCity_Main/x/y`, plus field-path writes of only `pilots.<uid>` (including deleteField and increment). Callers: the row owner, another pilot, a `holoServer`-claim token and an unauthenticated caller | 176/176 denied | Weakened copy (`allow list, write: if false;` → `allow write: if isSignedIn();`): 101/176 allowed, exactly the signed-in writes on `presenceScenes/{scene}`. With rules disabled, 58/58 distinct attempts succeed, so each denial is the rules' verdict. File run against a weakened `firestore.rules`: 75/176 denied, 2 tests fail. Against an "own row update" weakening: 139/176 denied, 3 tests fail |
| Reads | Signed-in `get` of `HoloCity_Main` is allowed. Unauthenticated get, list, documentId query, collection group, `NeonForest` get and nested get are denied | Same seeded doc, read by an allowed principal and a refused one |
| `expiresAtMs = updatedAtMs + 90 000` (stored row and ack) | pass | TTL 60 s mutant: 5/9 expiry tests fail and the PR's pure test 2 fails (1/5). The PR's emulator file stays 3/3 under it |
| Boundary: a row at `now == expiresAtMs` is pruned by any pilot's next write (another pilot's heartbeat, leave or wave, or a newcomer's heartbeat); 1 ms earlier it survives unchanged | pass (8 cases) | `>=` mutant: 6/9 fail. `> now + 1` mutant: 4/9 fail. The in-file `weakPrune` / `noExpiry` / `overPrune` copies disagree with `prunePresence` only at the boundary |
| A fresh heartbeat refreshes `expiresAtMs` (boundary moves to T0 + 120 s) | pass | Fails under both prune mutants and the TTL mutant |
| An expired pilot's wave is refused with `invalid_request`: the doc is unchanged, the row is never resurrected, and a wave never extends the row's life | pass | `>=` mutant fails it (the wave at expiry is accepted) |
| `leave` removes the row immediately while unexpired; the other row is untouched | pass | Ignored-leave mutant fails it (and the PR's emulator test 2) |
| A pruned row never reappears on later writes; one pilot's expiry never touches another's row | pass | `>=` mutant fails both. `noExpiry` copy keeps expired rows |
| Two parallel heartbeats keep both rows, under a forced read-read-commit-commit overlap | pass 6/6 runs (the real host retried, more than 2 attempts) | The same overlap without a transaction loses one row 6/6. The non-transactional host mutant is caught 3/3 here, but only 6/8 by the PR's `Promise.all` test, which is race-dependent |
| Position rounding to the 0.5 m grid, plus all six clamps (pure) | pass | Whole-metre rounding gives `[1,3,-4]` instead of `[1.5,2.5,-4.5]`. The PR's inputs (`[1.23,2.23,-4.21]`) could not tell 0.5 m from 1 m |
| Verify script on a host without `java_home` | Reaches the emulator step | With no java on PATH it exits 1 ("java not found"). The old line printed "No such file" and continued only because errexit ignores assignment prefixes |

**Regression:**

- `npm --prefix functions test`: 129/129.
- Presence emulator files: 12/12.
- Full `test:emulator` file list (14 files): 104/104.
- Full `rules-tests` `vitest run`: 16 files, 98 tests.
- `PRESENCE_EMULATOR_PORT=8792 bash scripts/verify-town-presence.sh`: exit 0.

**Note:** the full emulator list rewrites 4 tracked fixtures in `Documentation/QA/2026-10-01-buddy-unit-tiers/fixtures/`. This is pre-existing behaviour; they were restored and not committed. The desktop-account fixtures show real drift: `travelSquad` revision 0 → 1, `[]` → `["ace"]`.

Commands (every emulator run under `timeout -k 15 <s>`, with `NO_UPDATE_NOTIFIER=1 METADATA_SERVER_DETECTION=none`). `<scratch>.json` is `firebase.json` without `functions`, with `emulators.firestore.port` 8792 and `singleProjectMode` false; `firestore.rules` is symlinked beside it.

```
npm --prefix functions run build
node --test functions/scripts/test-presence.mjs
npm --prefix functions test
rules-tests/node_modules/.bin/firebase emulators:exec --config <scratch>.json --project demo-holobots-presence --only firestore \
  'export GCLOUD_PROJECT=demo-holobots-presence; node --test functions/scripts/test-presence-emulator.mjs functions/scripts/test-presence-expiry-emulator.mjs;
   cd functions && node --test <the 14 test:emulator files>; cd ../rules-tests && ./node_modules/.bin/vitest run --no-cache --configLoader runner'
PRESENCE_EMULATOR_PORT=8792 bash scripts/verify-town-presence.sh
```
