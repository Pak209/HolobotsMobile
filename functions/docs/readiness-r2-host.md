# Readiness R2 host candidate

Source: HolobotsUnity `Documentation/HANDOFFS/2026-10-23-expedition-autobattle-readiness-design.md`, addendum, DECISIONS #72.81–#72.83. This branch includes the open R1 PR #202 branch merged into current main; R2 is not stacked on that PR.

## Flags and host fields

- `HOLOCITY_READINESS_START=1` is required to issue starting SYNC. Default off. Only `rivalBattleHost` input-log CPU issues carry it; legacy and resolver issue bytes are unchanged. The player side reads protected `syncReadiness` and `syncMomentum`; `startSync=min(50, floor(readiness)+5*min(streak,3))`. CPU side reads the rank table Rookie 0, Starter 6, Champion 12, Rare 18, Elite 24, Legendary 30. Issue's optional `readinessStart[]` is presentation-only; the hashed `rules.fighters[].startSync` is authoritative.
- `HOLOCITY_BATTLE_IQ=1` enables hidden `battleIq` writes on first rival settle and its readiness-fade effect. Default off. A fielded bot gains 4 IQ on a win, 2 on a loss to a higher-level opponent, 0 on other losses, capped at 100. A fielded bot's streak increments on a win (cap 3) or resets to 0 on a loss. Retry returns the stored settle without writing again. IQ 0 gives the R1 20% remaining/day fade; IQ 100 gives 10% remaining/day. The future auto-send may use `battleIqCpuRank` (20 IQ points per band) but no send path exists in this change.
- `battleIq` and `syncMomentum` are protected top-level profile fields beside `syncReadiness`; they are not in the client-writeable `holobots` array. A legacy settle with no recorded `fielded` IDs trains nobody because the host has no proof which bot fought.
- Arena CPU `arenaMatchHost` remains on its client-played, non-FightRules path, so it has no `startSync` issue field; this change does not pretend to prefill it. PvP's current room fighter registration also has no FightRules issue and stays at 0. Both need a future authoritative fight-core issue path before readiness can be mirrored there; PvP must remain zero then.

## Promotion gate

The readiness start flag must stay **off until the producer's native feel witness and Pak's release decision**. The following was the pre-#72.85 balance failure on the published #72.80 rows. The original command, `cd functions && node scripts/sweep-readiness-r2.mjs 1000 published`, uses Champion side-0 brain, tier-4 CPU start 12 and the `astra-battle-scaling-1/seed/<i>` stream. It remains the known-bad control:

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

Pooled pre-tune edge: **−1.38 points** across 13,000 paired seed blocks (95% paired-block interval −2.59 to −0.16). A WOLF trace moves first SPECIAL from tick 744 to 51 but yields no extra special and less special damage, 122 versus 131. This diagnosed the low half-SYNC damage and the guarded full finisher.

**#72.85 cold correction:** the rules-5 attrs block now has `specialOpenPm=5000` for an unguarded SPECIAL hit and `finisherTempoCutTicks=6` for a full finisher. Both are hashed and mirrored byte-for-byte in Unity; duel-rules-3/-4 stay unchanged. `node scripts/sweep-sync-value.mjs 1000 2,10,21` is the revised 13-bot paired sweep. The side-0 50-vs-0 edges at levels 2/10/21 are **+11.22 / +11.26 / +11.38 points**; median durations are **46.03 / 46.03 / 45.90 seconds** at start 50 and 50.43 / 50.43 / 50.33 at start 0. A separate LV10 side-1 sensitivity is **+10.65 points**, medians 50.43 / 45.75 seconds. Full-finisher land is 92–95%, SPECIAL guard contacts 33–37%, and no start-0/50 arm telegraphed a full finisher in the first second. A +10 SPECIAL probe remains measurable. See the Unity `Documentation/QA/2026-10-23-sync-value-balance-1/README.md` and this PR's sweep table. These are CPU-vs-CPU proxies; the native feel witness is still required before flag promotion.

No function was deployed and no account was accessed.
