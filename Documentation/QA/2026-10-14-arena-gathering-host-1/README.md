# arena-gathering-host-1 — validation / handoff

2026-10-14 PDT. Isolated worktree from HolobotsMobile main `5d57afa`. HolobotsUnity main pulled before reading the Astra lane brief, arena arc design brief and DECISIONS #59. One worker; within the 3-hour box. No Unity editor operations, shared dirty-file staging, production account access or deployment.

## Delivered

- Host-owned `users/{uid}.storyFlags`, lazy defaults and desktop account replies (all 3 existing versions).
- `arenaGatheringHost`, `arena-gathering-1`: 8 stable per-account pilots from 15 CV1 instances, 12 lowercase Holobots, 6 existing ring colours. Repeated Holobots have different rings. All 15 IDs independently matched against Unity HoloCity_Main.
- Citizen selection on `rivalBattleHost`, using `rival-battle-3` plus `storySchema: arena-gathering-1`. Existing 300,000 ms cooldown, 100/25 Holos, XP and daily rewards retained.
- Tagged admission on `arena-match-1`, then `tournamentResultHost`, `arena-tournament-1`, requiring owned, validated settled win receipts. Thresholds 2/11/21, sequence and replay checks; count 0–3; only third win flips Arena. HoloZones stays false with explicit integration assertions.
- Rules protect the entire storyFlags map. `CONTRACT.md` contains wire shapes, refusal mapping, numeric meanings, interpretation and limitations; JSON examples support the Unity lane.

## Measurements

| Check | Result |
| --- | --- |
| `npm run build` in functions | PASS; first and final builds |
| `npm run check:shared` in functions | PASS; 3 shared files identical |
| `npm test` in functions | 145 tests: 144 passed, 0 failed, 1 existing skip; 1.36 s |
| Desktop reply unit check | 4/4 passed |
| Combined emulator attempt 1 | 71 tests: 70 passed, 1 stale legacy reply-key assertion failed; test runtime 75.20 s |
| Combined emulator attempt 2 | 71 tests: 71 passed, 0 failed/skipped; test runtime 83.88 s, launcher 88.13 s |
| New lane suite, included above | 13/13 passed on both attempts |
| Bounds | Each emulator invocation limited to 300 s; JVM heap capped at 2 GB |
| Isolation | `demo-holobots-arena-gathering`, Firestore loopback 127.0.0.1:18085; generated throwaway UIDs only |
| Cleanup | Emulator shutdown succeeded; port 18085 no listener after completion |

The first failed assertion expected desktop replies to contain no `storyFlags`. It was corrected for this explicit additive contract; legacy fields and semantics remain asserted. The final run includes one existing R4 bounded emulator transport retry on an Arena/Zone race, with the same request/time/account and verified zero-write refusal. This is recorded in the log; no extra suite attempt was taken.

New tests cover forged result fields before positive cases, lazy defaults, all roster members and deterministic replay, concurrent gathering calls, bad request/auth/account state, non-roster/before-gathering rivals, win/loss rewards and cooldown, exact threshold boundaries and out-of-order refusals, third-win flip, concurrent result replay, foreign/ordinary/unfinished/lost/malformed receipts, changed admission replay identities, and client rules attacks. Existing R4 known-bad legacy exploits and Arena/rival/desktop regression suites are included in the 71-test run. Expected permission-denied messages are negative rules-test evidence. Archived logs have trailing whitespace normalized; raw originals remain in /private/tmp.

Re-run the new suite against an already running **loopback demo** emulator with `npm --prefix functions run test:arena-gathering`; it refuses missing/non-loopback/non-demo configuration. Combined files: `test-arena-gathering-emulator.mjs`, `test-desktop-account-emulator.mjs`, `test-arena-match-emulator.mjs`, `test-rival-battle-emulator.mjs`. Install normal functions and rules-test dependencies first. Local dependency symlinks and temporary emulator configuration are not committed.

## Review / holds

Self-review checked transaction read-before-write order, request identity binding, account ownership, host receipt validation, monotonic count and atomic duplicate handling, unchanged economy code, exact citizen/palette sources, and server-only rules. No new top-level persistence collections; existing account deletion already removes users and Arena receipts. Test-generated historical fixtures were restored; current account examples are in this packet instead.

HELD: none in this lane. Merge/deploy remain Pak-only and were not performed. Interpretation needing producer awareness: 2/11/21 are Holobot rank-level boundaries, so eligibility uses the participating Holobot's admission level (no numeric Pilot Rank exists). Existing client-observed practice combat and owner-writable Holobot progression remain limitations, explicitly documented in CONTRACT.md. New tournament bracket presentation, live PvP ladder, HoloZones unlock, economic changes and every unrelated hold remain outside scope.
