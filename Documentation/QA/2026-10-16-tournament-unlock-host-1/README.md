# W68 verification

Known bad: current-main compiled desktop reply for an ACE level-2 account had `tournamentUnlocks === undefined`; expected the Starter eligibility row.

Final source verification:
- `npm --prefix functions run build`: pass, including all 3 check:shared mirrors.
- `npm --prefix functions test`: 259 passed, 1 existing skipped, 0 failed.
- Local Firestore demo emulator: 12 callable tests passed (10 unlock tests + 2 existing desktop account tests).
- Rules emulator: 3 tests passed covering both protected fields across owner/other/anonymous create, add, replace and delete; unchanged protected fields remain usable.
- `git diff --check`: pass.

Attempt 1: 11/12 callable tests passed; replacement-bot fixture retained its old travel squad, correctly triggering existing unavailable. Corrected the throwaway fixture's squad. Attempt 2: all 12 callable and 3 rules tests passed. Final review added strict null/duplicate ledger rejection; the final run reverified all 12 callable and 3 rules tests. Initial full units caught the expected additive-field assertion mismatch; updated the compatibility assertion to strip only the new field, then all units passed. No production data, deploy, editor or real account used.

Reproduction from repo root (local Java and installed dependencies required):

```sh
npm --prefix functions run build
npm --prefix functions test
GCLOUD_PROJECT=demo-w68 rules-tests/node_modules/.bin/firebase emulators:exec --project demo-w68 --only firestore 'node --test functions/scripts/test-tournament-unlocks-emulator.mjs functions/scripts/test-desktop-account-emulator.mjs && cd rules-tests && node_modules/.bin/vitest run tests/tournament-unlocks.test.ts'
```

Contract and policy details: `functions/docs/tournament-unlocks-1.md`. Local logs `/private/tmp/w68-emulator-rebased.log` and `/private/tmp/w68-units-rebased.log`; ephemeral test evidence, no captures needed for this host-only change.
