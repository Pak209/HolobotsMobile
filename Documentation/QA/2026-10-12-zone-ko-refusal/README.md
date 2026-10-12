# Zone KO refusal — item O, DECISIONS #56 amendment 5

The zone host now refuses a travel-squad Holobot whose authoritative ledger health is zero. Callable error: `failed-precondition`, with `details.rejectionCode = holobot_ko`. This applies to absent/v1/v2 schema versions and both health-flagged and legacy requests. Admission runs before any user/run write or closing a previous run. Missing ledger entries remain fresh; an unselected KO bot does not block admission. Malformed ledgers fail closed, including legacy requests.

The existing emergency patch repairs 25% and permits the next zone issue. City rival issue still recovers zero HP at 40%; its issueVitals implementation is unchanged. Accepted legacy reply shapes and ledger-write behavior remain unchanged. No deploy, production account call or Unity editor operation occurred.

## Evidence and verification

- `baseline-build.log`: baseline build succeeds.
- `known-bad-emulator.log`: baseline host accepted a zero-HP zone run; the refusal assertion intentionally fails (first evidence).
- `build.log` and `check-shared.log`: TypeScript build and shared mirror checks pass.
- `domain-tests.log`: 51/51 domain tests pass.
- `emulator.log`: candidate attempt 1, 25/27 pass; two existing repair-rule fixtures require port 18080 but the isolated emulator used 18885. All new KO tests passed. Failure retained.
- `emulator-02.log`: candidate attempt 2, 27/27 pass on port 18080. No third attempt.

The five new emulator cases cover all version/flag refusal combinations and unchanged documents; repair-to-acceptance (0 to 48 of 192, stock consumed once); unchanged city recovery (76.8 of 192); positive/missing/unselected-KO controls; refused reissue retaining the prior run and malformed-ledger refusal. Existing zone, rival-health and repair-rule integration tests also pass.

Only loopback Firestore with demo project IDs was used. Firebase CLI downloaded its required emulator v1.19.8; the owned emulator processes shut down after each run. Reproduce using the Firebase CLI with a Firestore-only configuration, host 127.0.0.1, port 18080, and project demo-holobots-zone-ko, then run these scripts sequentially: test-zone-ko-refusal-emulator.mjs, test-holozone-emulator.mjs, test-holozone-health-emulator.mjs, test-rival-health-emulator.mjs and test-desktop-items-emulator.mjs.

## Source review

Changes: rivalHealth ledger admission helper; holoZoneRuns error/admission mapping; holoZoneStore always supplies the profile even for legacy admission; holoZoneHost maps the new refusal; focused domain/emulator regression tests and test command; HOLOCITY_PROGRESSION contract documentation. No rules, indexes, client schema version or city recovery change. Review checked admission-before-write, transaction atomicity, flag-bypass resistance, accepted wire compatibility and the city control. Full-ledger validation intentionally means malformed unselected ledger entries also fail closed.

Prepared in an isolated worktree from origin/main; shared HolobotsMobile dirty files were not modified or staged. All unrelated holds, including district export reservations and 8 GB/300-second limits, remain unchanged. PR only; publication/deploy remains held.
