# Mobile account parity: host movement addition

Main `f50d0285057617d8dab3b53badfb5075bf0d7a7c` includes #84 and #111. #84's historical CI was green (638 passed / 1 skipped), but #111 added host-owned `battlefieldMovement` between `battleStats` and `displayStats`. The reply parity test incorrectly required the latter two fields to be the final object keys. Current-main CI 39056625429 and #113 CI 39057087246 reported 637 passed / 1 failed / 1 skipped; these are distinct from #84's historical result.

Only the test changes. It checks actual battleStats and displayStats values, checks movement against the host mapping at the fighter's speed, and verifies forged stored movement is replaced. The v1/v2 unchanged-record checks remain, including the stored movement field. Runtime behavior, schemas, dependency files and economy values are unchanged.

| Evidence | Result |
|---|---|
| Known-bad first, targeted test on main | 4 passed / 1 failed; 0.95 s wall time; exact final-key mismatch reproduced |
| Fixed full mobile suite | 55 files; 638 passed / 0 failed / 1 existing skip, 639 total; 2.95 s wall time |
| Typecheck | exit 0; 3.24 s wall time |
| Diff check | clean |

Each test/typecheck command had a 300-second subprocess bound. Existing React test-renderer deprecation notices remain visible. Dependencies reused the existing pinned #84 node_modules cache; no downloads. No editor, emulator, deploy, production/Pak account, credits or shared dirty-file changes.

Evidence folder: `/Users/pak/HolobotsVault/QA/2026-10-17-mobile-account-parity-fix/`.
Sheet: `GATE_SHEET.png`, 1440×900, cells in reading order:
1. Current-main known-bad assertion (4 passed/1 failed).
2. Explicit field/value and host-ownership checks replacing object order.
3. New full-suite/typecheck results (638 passed/1 skip; green).
4. Historical #84 versus current-main regression and this test-only fix.
Raw logs: `known-bad.log`, `full-mobile.log`, `typecheck.log`; `results.json` records timing/exit values. The earlier status-only sheet in `2026-10-17-mobile-tests-2-status/` documents merge status, not current-main test health; its historical CI must not be treated as a new run.
