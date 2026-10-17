# bracket-level-contract-1

Main already publishes `bracket.entrants[].fighter.level`; the missing work is an explicit consumer contract and regression coverage. No host runtime logic changed. Unity mirror remains a separate lane.

Known-bad first: omitted/fractional/out-of-range levels are rejected by existing host persisted-bracket validation; caller level injection remains `invalid_request`. Positive fixture: nine entrants, human level 21, eight citizen levels 12. All levels remain immutable on resume/advance after account level changes to 45. Adapter input default is 1; published replies require level 1–99. Existing opponent tier levels are 12/24/36/45 and admission thresholds 2/11/21; no economy or refusal change.

Evidence sheet (1500 × 900), every cell inventoried:
`/Users/pak/HolobotsVault/QA/2026-10-17-bracket-level-contract-1/GATE_SHEET.png`
Adjacent `sheet-inventory.json` identifies each text/evidence cell; this is a contract diagnostic, not a gameplay screenshot.

Verification: build and check:shared passed. Full units: 286 passed, 0 failed, 1 existing skip (287 total). Targeted bracket units: 14/14. AJV validates the positive fixture against the projection schema and rejects the missing-level mutation.

Emulator attempt 1 stopped before cases loaded because the isolated worktree lacked rules-tests dependencies. Those were copied into scratch (no shared checkout symlinks), imports checked, then one bounded retry used. Attempt 2 passed **17/17** emulator tests (0 failures/skips), including admission levels, spoof refusal, immutable resume/advance, and owner/foreign rules denials. No further retry was used.

No editor, scene writes, deploy, credits or real account use. Existing holds remain unchanged. All Firestore pilots are `bracket_throwaway_*` on a loopback `demo-*` emulator. No image evidence committed to git.
