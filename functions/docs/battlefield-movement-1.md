# Battlefield movement publication — movement-sim-2

Contract review only, PR on main; Pak merges/deploys. No editor, production account,
credits, settlement changes or sim replay changes.

`battlefield-movement-1` is an additive, versioned **nested** contract:
- `desktop-account-3.battlefieldMovement`: fleet calibration catalog.
- Each known v3 owned Holobot's `.battlefieldMovement`: resolved movement row.
- `rival-battle-3` issue `.battlefieldMovement`: `{schemaVersion,player:[row],opponent:[row]}`.
  It is built **after** Zell/citizen lineup substitution. Gathering still omits
  `playerCombatants`, while this independent publication carries its speed rows.
- v1/v2 replies are unchanged. No schema negotiation or settlement mode changes.
  Unknown future owned names have no movement row; stored movement metadata is
  discarded rather than trusted. Unknown issued fleet identities fail closed.

Each row has `holobotId`, `source` (player/rival), `sourceSpeedStat`,
`referenceSpeedStat`, `referenceSourceHolobotId`, `provisional`,
`baseRunMmPerSecond`, `runMmPerSecond`, `runMetersPerSecond`, `preferredRangeMm`.
JSON Schema: `Schemas/battlefield-movement-1.json` (`$defs.row` for an owned row).
Unity must **copy the final value**, never calculate the mapping locally.

Formula: `clamp(floor(baseRunMmPerSecond * sourceSpeedStat / referenceSpeedStat),
1600, 3200)`. BigInt multiplication/division; nonnegative safe integer source
stat only. Metres/second is final integer mm/s divided by 1000. Speed is movement
only; damage/timing/attack formulas are unchanged.

A globally monotone mapping of raw host speed would contradict the producer's
fleet roles: TORA has speed 60, WOLF 50, yet the movement brief calls TORA slow
and WOLF fast. Per-bot calibration preserves the agreed **provisional** baseline
and still maps subsequent host speed changes monotonically for that bot.

| Bot | Player L1 ref | Rival L1 ref | Base m/s | Preferred mm |
|---|---:|---:|---:|---:|
| ACE | 70 | 50 | 3.2 | 4000 |
| WOLF | 50 | 50 | 3.0 | 1500 |
| HARE | 40 | 50 | 3.2 | 1500 |
| SHADOW | 40 | 50 | 3.0 | 1500 |
| KEN | 60 | 50 | 2.6 | 1500 |
| TSUIN | 50 | 50 | 2.6 | 1500 |
| WAKE | 40 | 50 | 2.4 | 4000 |
| JUSAN | 70 (ACE fallback) | 50 (WOLF) | 2.4 | 1500 |
| KURAI | 30 | 50 | 2.4 | 4000 |
| ERA | 60 | 50 | 2.2 | 4000 |
| GAMA | 30 | 50 | 2.0 | 1500 |
| KUMA | 30 | 50 | 1.6 | 1500 |
| TORA | 60 | 50 | 1.6 | 1500 |

Player reference is existing `getPlayerBattleStats` at level 1, no boosts/sync.
Rival reference is existing `rivalTierBattleStats(0)` (WOLF 50 for all identities).
Actual source is the already computed owned/issued battle stat, including current
level/boost/sync where applicable. JUSAN has no progression base row today, so
player stats inherit ACE; named rival stats inherit WOLF. Both provenance sources
are explicit and `provisional:true`. This PR does not invent JUSAN progression
stats or silently relabel ACE stats as JUSAN's own.

Calibration constants reuse the frozen producer table from #110. This publication
does not modify `duel-sim-2`, its 12 m radius, or its frozen vectors. The chair's
**6 m town radius** is the current presentation pick pending Pak; Arena 15.5 m.
That discrepancy remains explicitly held for the radius ruling/parity lane.

## Evidence

- Known-bad first: raw TORA/WOLF speed ordering reverses intended movement roles.
- First units: 281 passed / 1 failed / 1 skipped; only old exact desktop key list
  rejected the intended additive field. Updated exact lists for desktop and citizen.
- Second units: 282 passed / 0 failed / 1 existing skipped.
- Scratch Firestore emulator: 6 passed / 0 failed (2 movement publication + 4
  existing citizen issue/settle/cooldown/refusal/resolver tests), 3.28 seconds tests.
  Loopback `127.0.0.1:18089`, project `demo-holobots-citizen-rival`, throwaway UIDs.
  No symlink into the Mobile checkout; isolated copied function dependencies.
- Build and check:shared green (3 mirrored modules). Catalog validates with
  Draft 2020-12 JSON Schema. New schema is nested, so v3 envelopes stay v3.
- Review sheet: `/Users/pak/HolobotsVault/QA/2026-10-17-movement-sim-2/GATE_SHEET.png`
  (1500×900). Cell 1 = control, cells 2–14 = ACE/WOLF/HARE/SHADOW/KEN/TSUIN/WAKE/
  JUSAN/KURAI/ERA/GAMA/KUMA/TORA. Full inventory in adjacent `sheet-inventory.json`.
  Chair must inspect all cells before forwarding to Pak.
