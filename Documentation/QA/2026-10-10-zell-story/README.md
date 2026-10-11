# Zell host story — review branch, feature off

The existing rival host can issue Zell as a named rival. The first accepted win on a host-stamped Zell fight marks him as an ally; a loss keeps him a rival. WOLF is the temporary partner. These defaults await Pak's call, and `HOLOCITY_ZELL_STORY` defaults off.

| Check | Result | Evidence |
|---|---|---|
| TypeScript + shared files | zero errors, parity passes | compile.txt, parity.txt |
| Pure host rules | 131 tests pass | unit.txt |
| Real Firestore story transactions | 11 pass, including concurrent duplicate wins and account deletion | emulator.txt |
| Existing rival/progression/health/deletion transactions | 24 pass | regression.txt |
| Client story access | 24 owner/foreign/anonymous denials; weakened-rule control fires | rules.txt |
| Transaction model | 11 pass; supplementary | transaction-model.txt |

Emulator ran from the already-cached Firestore JAR on loopback with demo projects. No downloads, credentials, live account or production deploy. Callable tests use `.run` with test authentication, not a deployed HTTP transport.

The optional `zell-story-1` response is additive over `rival-battle-3`. Ordinary replies stay unchanged; the companion Unity reader must land before activation. Existing client-reported battle settlements remain bounded by current host checks; this does not create a server combat simulation.

Pak calls: **WOLF** recommended for the temporary partner; **WIN** recommended for the first-win ally turn. No extra rewards or activation. Publication was rejected by automatic approval review, which still sees an earlier no-push instruction; root has the later direct approval and will handle publication.

## 2026-10-11 re-verification (chair lane)

Re-run of PR #65 (head `91f0a5f`, base `881e352`) off-editor, 2026-10-11 01:40–02:20 UTC. Firestore emulator: local only, cached JAR v1.19.8, port 8791, project `demo-holobots-zell`. No deploy, credentials, downloads or production access. Every gate has a known-bad control. Mutation controls ran in a scratch copy of this branch, never in the checkout. Each one failed exactly the tests named below, and the unmutated copy passed first.

This commit adds:
- `scripts/test-zell-compat.mjs`, now in `npm test`. The PR's "960 compatibility comparisons" claim has no script in the PR or in the Holocity package (`compatibility.json` holds only the result), so it could not be re-run. This script replaces it.
- One pure test: the stand-in's tier and stats at every ladder tier.
- Four emulator tests:
  - the `HOLOCITY_ZELL_STORY` flag read by the callable;
  - only the first win turns Zell, and forged request fields cannot;
  - concurrent wins on two different Zell battles;
  - a malformed story on settle fails closed and is never reset.
- `functions/README.md`: how to set the flag.

| Gate | Result | Known-bad control |
|---|---|---|
| Build (`check:shared` + `tsc`) | 3 shared files in sync; 0 TypeScript errors | Type error in `zellStory.ts`: `tsc` exits 2 with 5 `error TS`. `rivalTierStats.ts` drift: `check:shared` exits 1 (DRIFT DETECTED) |
| Pure suite (`npm test`) | 136/136 with the baseline set. Without it: 135 pass, 1 skipped (the cross-build compat test). Zell pure tests: 8/8 | Named-win guard removed (the `verify.py` control): 2 fail. Stand-in fixed at tier 0: 1 fail. Ally may re-turn: 1 fail. Malformed story resets to fresh: 1 fail |
| Byte-identical compat (`test-zell-compat.mjs`, baseline = 881e352 build) | 12,295 ordinary request cases in 3,640 chains. 24,590 reply comparisons (`JSON.stringify`, key order included) and 7,280 stored-state comparisons, flag off and on: 0 differ. All 12 roster rivals appear in each of the 136 profile × issue-shape lineups (v1 absent/explicit, v2, v3, each with and without `healthSchema`) | One-value change: 107/107 flagged. Key-order change: 107/107 flagged, and all 107 pairs are deep-equal, so a deep-equal check would miss them. Story projection added to ordinary requests: 107/107 flagged. Mutation adding `story` to every reply: 23,596 mismatches. Mutation adding it to v3 only: 6,018 mismatches; the 107-test emulator suite still passes 107/107 on that build |
| Rules (`test-zell-story-rules.mjs`) | 24/24 denials: owner, foreign and anonymous × doc and subcollection × get/set/update/delete on `storyProgress/{uid}` | Weakened rule (`if true`) lets the owner write a forged ally flag (built-in control fires) |
| Story emulator (`test-zell-story-emulator.mjs`) | 15/15 (11 from the PR + 4 new), in 10 of 10 runs of the final file | Flag read as truthy instead of `=== '1'`: 1 fail. Store flag check removed: 2 fail. Stand-in at tier 0: 1 fail. Ally may re-turn: 2 fail (second win / concurrent second win changes `victoryBattleId`). Malformed story resets: 2 fail. Deletion skips `storyProgress`: 1 fail |
| Full `test:emulator` list (13 files) | 107/107 in 3 of 4 final-file runs. The fourth was 106/107: main's `parallel wins on different battles…` hit `3 INVALID_ARGUMENT: Transaction is invalid or closed` (pre-existing emulator contention flake, not Zell code) | Mutation adding `story` to every reply: 3 fail, including main's `rival-battle-1 … exact deployed shape` |
| Supplementary | `test-rival-health-emulator` 3/3; transaction model 11/11. `test-desktop-items-emulator` 8/10: the 2 `fetch failed` failures are pre-existing (it hard-codes emulator port 18080) and that file is not in `test:emulator` | — |

The baseline lib was diffed against a fresh scratch `tsc` build of `git archive 881e352` and is byte-identical, source maps included.

Flakes: the PR's `parallel duplicate wins…` test hit the emulator contention error once in 43 runs. The new concurrent-wins test hit it in 2 of 18 runs. The emulator reports this abort on a transactional read as INVALID_ARGUMENT, which the SDK does not retry; production returns ABORTED, which it does. That one test now resends its settle on that exact error, as the Unity client's settle retry would. After the change it passed 21 of 21 runs, and its re-ally control still fires.

Commands, run from the worktree root. `<cfg>` is a copy of `firebase.json` with no `functions` key, Firestore port 8791, `singleProjectMode: false`, and absolute rules and indexes paths.

```sh
npm --prefix functions run build
npm --prefix functions test
ZELL_COMPAT_BASELINE_LIB=<abs path of a compiled 881e352 functions/lib> npm --prefix functions test
rules-tests/node_modules/.bin/firebase emulators:exec --config <cfg> --project demo-holobots-zell --only firestore \
  'export GCLOUD_PROJECT=demo-holobots-zell ZELL_RULES_PACKAGE=$PWD/rules-tests; cd functions &&
   node scripts/test-zell-story-rules.mjs && node --test scripts/test-zell-story-emulator.mjs &&
   node --test <the 13 files of the test:emulator script>'
```
