# Arena fighter snapshot host contract

Base: current main 1c78196, including merged #113. Main-based PR; no sibling dependency. No deploy, Unity/editor/app build, credits, physical device or real account access. TypeScript checks use --noEmit; tests transpile TypeScript in memory via an isolated require hook, producing no lib/dist output.

## Wire contract

Both existing schema names remain unchanged because the fields are additive:

- `arena-match-1`: `match.entrant` and `match.opponent` each publish `{holobotId, level, displayName, tier}` alongside existing combat fields. A no-match resume still returns null, not an invented fighter.
- `arena-bracket-1`: each of all eight citizen entrants plus the player publishes those four fields within its existing `fighter` object. Existing `fighter.level`, other combat stats, and entrant keys remain unchanged.

`level` is the issued host combat level (integer 1–99), never pilotRank or tournament threshold. Match level comes from the stored admission; bracket citizens use the same admitted opponent level and the human uses the admitted entrant level, exactly as #113. `tier` is the existing numeric zero-based Arena tier index (rookie0/challenger1/elite2/legend3), the same value fed to DuelFighterStats; it is not Light/Medium/Heavy. `displayName` is canonical uppercase Holobot identity, not a pilot or custom account nickname.

Only reply projections change. Persisted admissions, bracket fighter objects, seeds, receipt hashes, rules/economy, HP, settlement and idempotency stay untouched. Every issue/start/resume/settle/cancel/retry match path and start/resume/advance/cancel/retry bracket path shares the projection. Client-supplied snapshots are refused by existing strict request validation. Malformed issued levels fail closed, with no default.

## Compatibility review

An initial sibling `entrant.fighterSnapshot` proposal was rejected during chair review: Unity TournamentBracketReplies.cs:35 strictly allows entrantId/pilotName/holobotId/isPlayer/fighter. Final code instead adds displayName inside the existing fighter object, whose additional fields are tolerated. Tests preserve the exact five entrant keys and original combat fields.

The uninstalled Arena admission candidate `/private/tmp/unity-arena-admission/Assets/Holobots/Shared/Scripts/Runtime/Rival/ArenaMatchClient.cs:85` reads required entrant/opponent fields without rejecting additions. This is source review of the candidate, not an installed/native witness. No Unity editor was opened.

## Evidence and attempt accounting

Known-bad first: original main/#113 fixture has nine entrants, zero complete four-field presentation snapshots (missing displayName). Frozen original fixture remains unchanged as a control.

Final compatible-layout unit tests: 18 passed / 0 failed. Covers projection on start/resume/cancel/advance, immutability, exact keys, invalid levels, JUSAN identity and schema-field assertions. Full Ajv schema validation runs in the emulator suite with cached rules dependencies. `tsc --noEmit`: green. `check:shared`: all 3 files in sync.

Emulator attempt 1: both new transaction tests passed, but the existing bracket suite could not import cached rules dependencies (NODE_PATH omitted rules-tests/node_modules). This is recorded as a failed attempt. No production fallback/download.

Emulator attempt 2: 19 passed / 0 failed, 16.709 seconds, with schema, malicious input, issue/start/resume/settle/retry/cancel, all nine entrants, frozen levels, all prior bracket refusals and rules coverage. That evidence used the superseded sibling layout and is NOT final-layout acceptance.

The chair explicitly authorized ONE further 300-second bounded final-layout run after reviewing the compatible projection and assertions. It passed **19/19, 0 failed**, in **13.268 seconds** including emulator startup/shutdown (test runner10.167s). All three attempts and the compatibility correction remain recorded. No additional retry. Cached Firestore v1.19.8, demo-arena-fighter-snapshot, loopback8191, scratch config; throwaway pilots only. No npm build or shipping output.

Vault evidence: `/Users/pak/HolobotsVault/QA/2026-10-17-arena-fighter-snapshot-1/`. GATE_SHEET.png is1440×900: cell1 original control, cell2 compatible projection, cell3 final verification. inventory.json identifies each cell/source. Root/chair owns shared inbox and checkpoint.
