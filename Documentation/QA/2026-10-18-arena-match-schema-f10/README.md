# arena-match-1 fighter schema (critic F10): CONTRACT note

Base: main `a90d061`. Schema and tests only. `functions/src` and `firestore.rules` are untouched. No deploy, emulator, device or real account.

## Problem (functioning critic 2026-10-17, row F10)

`Schemas/arena-match-1.json` required only `{holobotId, level, displayName, tier}` per fighter. The clients refuse a reply without more than that:

| Reader | Fighter fields it refuses a reply without |
|---|---|
| lite `arenaMatchFlow.ts` `snapshot()` / `readArenaReply()` (main `mobile/src/lite/lib`, lite `mobile/src/lib`) | `maxHealth`, `attack`, `defense`, `speed`, `intelligence` (each ≥ 1); `commandRules` (`version` 1 and 7 numeric keys); non-empty `moves`; entrant `currentHealth` > 0 |
| lite `arenaHostBattle.ts` | `moves` containing `gap_closer` and `break_heavy`; `commandRules.strikeSync` / `comboSync` |
| Unity `ArenaMatchClient.cs` `ParseCore` | `name`, `rank`, `maxHealth` ≥ 1; entrant `currentHealth` |

These fields arrived only because `arenaMatchStore.ts` `reply()` spreads `...m.entrant` / `...m.opponent`. A host reply trimmed to the old schema would throw `arena_snapshot_unavailable` on every lite client.

## Change

The schema name stays `arena-match-1`. The change is additive for consumers, because the host already sends every new required field.

- `definitions.fighterSnapshot` holds the #118 four fields, unchanged. `pvp-room-fighters-1` stays pinned to it.
- `definitions.fighter` is `fighterSnapshot` plus these required fields: `name`, `rank`, `maxHealth`, `attack`, `defense`, `speed`, `intelligence`, `commandRules`, `moves`.
- `definitions.commandRules` requires all 27 keys of `desktopPracticeCommands()`. `version` is const 1 and `maxStamina` is ≥ 1.
- `definitions.move` requires `{moveId, staminaCost, damageScale, breakPower, chargeable}`.
- `match.entrant` is a `fighter` that must also carry `currentHealth` > 0. `match.opponent` is a `fighter`, and the host sends no `currentHealth` for it.
- The host also sends `maxStamina`, `staminaRegen`, `deployment`, `experience`, `nextLevelExp`, `attributePoints` and `boostedAttributes`. No client reader requires them, so the schema still leaves them unspecified.

Pins: `arena-match-1` sha256 is now `54f43d39f486950fe2757430d80d1e26a2fbf266a712c5eb25276686faaa40ba`, updated together with its label in `test-arena-match-3v3-contract.mjs` (#134), as #145 did. Before this change it was `6b728fda…aa33`.

## Evidence

- **Fixtures re-validated (Ajv 8, old and new schema):** 35 arena-match-1 replies, 31 of them with a match, 0 invalid.
  - functions `arena-match/admitted-lifecycle.json`: 8 replies.
  - functions `arena-bracket/match-fighter-snapshots-issue.json`: 1 reply.
  - main mirrors `mobile/src/lite/qa/fixtures/arena-admitted-lifecycle.json` and `arena-match-fighter-snapshots.json`: 8 + 1 replies, byte copies of the functions fixtures.
  - lite branch `0756650` mirrors `mobile/src/qa/fixtures/…`: 8 + 1 replies. The bytes are unchanged since `d14e1d3`, and its lifecycle file is the pre-#145 bytes.
  - #146 head mirror: 8 replies.
  - The other `arena-bracket/*` fixtures hold only arena-bracket-1 replies. That schema is unchanged and still covered by its own tests.
- **Known-bad:** each reply with a match was trimmed to the old four-field fighters. The old schema accepted 31/31 and the new schema refuses 31/31. Both lite readers (main and lite branch) accept 9/9 real replies and throw `arena_snapshot_unavailable` on 8/8 trimmed ones.
- **Tests:** `test-arena-fighter-snapshot.mjs` has 3 new tests, and all of them are in `npm test`:
  - Every recorded reply validates.
  - Known-bad: the trimmed reply fails. Dropping any one required fighter field, any of the 27 `commandRules` keys or any move key fails. So do a missing or 0 entrant `currentHealth`, `intelligence` 0, `commandRules.version` 2, empty `moves`, `moves` without `break_heavy`, and a non-boolean `chargeable`.
  - Host parity: `commandRules.required` equals the keys of `desktopPracticeCommands()`, and `move.required` equals the keys of `RIVAL_BASELINE.moves`. The fighter that `reply()` builds (`playerCombatant` + `name` + `arenaFighterSnapshot`) validates for all 12 bots at levels 1 and 99, tiers 0 and 3.
- `test-pvp-room-fighters.mjs` now compares the PvP fighter with `definitions.fighterSnapshot` instead of the old inline entrant.
- **Gates:** `npm run build` green. `npm run check:shared`: 3 files in sync. `npm test`: 341 tests, 340 pass, 0 fail, 1 skipped (the existing Zell baseline skip, gated on `ZELL_COMPAT_BASELINE_LIB`). `test-arena-admitted-contract.mjs` (outside `npm test`): 4/4. Ajv came from `rules-tests/node_modules` through `NODE_PATH`, with no install.

## Not covered

- Match `rules` is under-specified in the same way. Unity requires `rules.entryFeeHolos`, but the schema requires only `rules.version`. It is out of F10's fighter scope and left as a follow-up.
- `currentHealth` ≤ `maxHealth` and `displayName === holobotId.toUpperCase()` compare two fields, which draft-07 cannot express. The readers still check them.
