# Readiness R2 host candidate

Source: HolobotsUnity `Documentation/HANDOFFS/2026-10-23-expedition-autobattle-readiness-design.md`, addendum, DECISIONS #72.81–#72.83. This branch includes the open R1 PR #202 branch merged into current main; R2 is not stacked on that PR.

## Flags and host fields

- `HOLOCITY_READINESS_START=1` is required to issue starting SYNC. Default off. Only `rivalBattleHost` input-log CPU issues carry it; legacy and resolver issue bytes are unchanged. The player side reads protected `syncReadiness` and `syncMomentum`; `startSync=min(50, floor(readiness)+5*min(streak,3))`. CPU side reads the rank table Rookie 0, Starter 6, Champion 12, Rare 18, Elite 24, Legendary 30. Issue's optional `readinessStart[]` is presentation-only; the hashed `rules.fighters[].startSync` is authoritative.
- `HOLOCITY_BATTLE_IQ=1` enables hidden `battleIq` writes on first rival settle and its readiness-fade effect. Default off. A fielded bot gains 4 IQ on a win, 2 on a loss to a higher-level opponent, 0 on other losses, capped at 100. A fielded bot's streak increments on a win (cap 3) or resets to 0 on a loss. Retry returns the stored settle without writing again. IQ 0 gives the R1 20% remaining/day fade; IQ 100 gives 10% remaining/day. The future auto-send may use `battleIqCpuRank` (20 IQ points per band) but no send path exists in this change.
- `battleIq` and `syncMomentum` are protected top-level profile fields beside `syncReadiness`; they are not in the client-writeable `holobots` array. A legacy settle with no recorded `fielded` IDs trains nobody because the host has no proof which bot fought.
- Arena CPU `arenaMatchHost` remains on its client-played, non-FightRules path, so it has no `startSync` issue field; this change does not pretend to prefill it. PvP's current room fighter registration also has no FightRules issue and stays at 0. Both need a future authoritative fight-core issue path before readiness can be mirrored there; PvP must remain zero then.

## Promotion gate

The readiness start flag must stay **off**. Current-main basis: `93def8c` (#206 progression rules-5 gate), with `HOLOCITY_FIGHT_ATTRS=1` set by the sweep script for the published rows. The 50 SYNC edge target is +10–15 win-rate points; the cold equal-stat 1,000 paired-seed ACE↔WOLF/tier 0/4/9 sweep gave +2.7, −3.0, +0.3, −2.3, +0.3, +2.9 points (pooled +0.15). `node functions/scripts/sweep-readiness-r2.mjs 1000` reproduces those cells. The same script with `published` runs all 13 LV10 mirror bots on the current #72.80 fight rows and rules-5, with Champion side-0 brain, tier-4 CPU start 12, using the published `astra-battle-scaling-1/seed/<i>` seeds. The exact command is `cd functions && node scripts/sweep-readiness-r2.mjs 1000 published`. This uses `getHolobotBattleStats` with the #72.80 fight-row delta at LV10, not an invented equal-stat row. The completed table is:

| LV10 bot | Wins at 0 / 1000 | Wins at 50 / 1000 | Edge, points |
|---|---:|---:|---:|
| ACE | 477 | 508 | +3.1 |
| WOLF | 512 | 439 | -7.3 |
| GAMA | 493 | 484 | -0.9 |
| HARE | 517 | 473 | -4.4 |
| KEN | 458 | 466 | +0.8 |
| KUMA | 527 | 452 | -7.5 |
| KURAI | 480 | 458 | -2.2 |
| ERA | 473 | 468 | -0.5 |
| SHADOW | 501 | 523 | +2.2 |
| TORA | 465 | 490 | +2.5 |
| TSUIN | 485 | 457 | -2.8 |
| WAKE | 494 | 499 | +0.5 |
| JUSAN | 506 | 492 | -1.4 |

Pooled edge: **−1.38 points** across 13,000 paired seed blocks. The 95% normal CI over the 1,000 paired seed-block means is **−2.59 to −0.16 points** (each block averages 13 per-bot win differences; no independence assumption among bots in a block). A paired published WOLF LV10 seed-0 trace confirms the meter is used: 0 SYNC first SPECIAL telegraph at tick 744, 50 SYNC at tick 51. Both runs still telegraph three specials; their special-hit damage totals are 131 versus 122, and both win. The early special changes timing and counter/defense interactions rather than guaranteeing an extra finishing hit. These are CPU-vs-CPU proxies; an editor feel witness is still required before flag promotion.

No function was deployed and no account was accessed.
