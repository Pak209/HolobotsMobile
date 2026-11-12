/**
 * court-live-1 (Pak 2026-11-11: every battle in Holobots Lite is a live duel): the Guild Court's single Cacheback fight as an
 * input-log duel, issued with rival/fightReplayIssue.buildFightReplayIssue and replay-checked at settle with
 * sim/fight/replay.verifyFightReplay, exactly like the rival and Arena live duels. settleHoloZoneRun stays the only payer: the
 * verified result becomes the same run report the plan-and-send court sends (kills 1 for a cleared court, else 0; never a boss;
 * the one fielded Holobot; HP from the replay on the ledger's scale), so EXP, Holos, the fragment and the cooldown follow the
 * existing court rules unchanged.
 *
 * Host env flag HOLOCITY_COURT_FIGHT_REPLAY, default off, ON only for exactly "1" and only together with HOLOCITY_FIGHT_REPLAY=1
 * (the HOLOCITY_ARENA_FIGHT_REPLAY / expedition realtime gate). The rules version follows the shared HOLOCITY_FIGHT_CHASE /
 * HOLOCITY_FIGHT_ATTRS flags and the request's `fightRules: 'duel-rules-6'` ask, as on the rival and Arena hosts.
 *
 * The beast fighter (beast-fighter-1, BEAST_FIGHTER_SPEC.md): the court beast fights as itself, holobotId COURT_BEAST_ID
 * ('cacheback', fighter id 'cpu-cacheback'), whose kit row and CPU profile are its Error Beast archetype's ('beast_bruiser':
 * sim/fight/rules BEAST_ARCHETYPES, sim/fight/profiles allBeastProfiles). It carries the court's own scaled Cacheback numbers
 * (lib/holoZoneBeastStats.scaledBeastStats: level, max HP, attack, defense, speed), the same numbers the plan-and-send court pins;
 * the kit row supplies only reach, movement, steps, jump and hit-stun. Gating: this is the ONLY path that issues a beast. A live
 * court issue exists only for a client that declared duel-inputs-2 (the new phone court client, which ships with the slot);
 * rival, Arena and expedition never pass a beast id. Live duel: issued with `live: true` (unguarded Special 2x; start SYNC as before).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { FIGHT_REPLAY_FLAG, FightReceiptWire, FightReplayIssueWire } from "../shared/fightReplayContract";
import { buildFightReplayIssue, inputLogCombatant } from "../rival/fightReplayIssue";
import { scaledBeastStats } from "./holoZoneBeastStats";
import { COURT_BEAST_ID } from "./holoZoneCourtDuel";
import { ledgerHealthAfterFight, PartBoosts } from "./partStats";
import type { LiveMoveRanks } from "./liveMoveRanks";
import type { PlayerCombatantSnapshot } from "./rivalLadder";

export const COURT_FIGHT_REPLAY_FLAG = "HOLOCITY_COURT_FIGHT_REPLAY";
export function courtFightReplayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[COURT_FIGHT_REPLAY_FLAG] === "1" && env[FIGHT_REPLAY_FLAG] === "1";
}
/** The fighter the court beast is issued as: the beast id itself (beast-fighter-1; was the borrowed "wolf" body). */
export const COURT_LIVE_BODY = COURT_BEAST_ID;
/** Why a live court run closed without a settlement (no pay, HP as issued; forfeit-is-loss: a loss that starts the zone cooldown):
 * the explicit forfeit, a failed replay, a new court issue while it was open ('superseded'), or its expiry unplayed ('expired',
 * recorded on the next court touch; Pak 2026-11-11). */
/** no-loss-before-fight (Pak 2026-11-11): 'left_before_fight' = the player left during the countdown (lib/leftBeforeFight.ts): the run
 * closes with nothing paid and HP as issued, but it is NOT a loss and starts no zone cooldown. */
export type CourtClosedBy = "forfeit" | "replay_mismatch" | "superseded" | "expired" | "left_before_fight";

/**
 * The pinned input-log issue for a court run (battleId = the run id), or null when the lineup cannot be expressed (the caller
 * refuses a live-only client with live_unavailable / lineup_unsupported, or keeps the next mode down for every other client).
 */
export function courtLiveIssue(input: {
  fighter: PlayerCombatantSnapshot & { currentHealth: number }; gear: PartBoosts; zoneId: string; tier: number; runId: string; seed: string;
  chase: boolean; attrs: boolean; tempo: boolean; guardHold?: boolean;
  /** live-move-ranks-1: the fielded Holobot's live-move ranks from the stored profile (lib/liveMoveRanks.liveMoveRanksFor). */
  moves?: LiveMoveRanks;
}): FightReplayIssueWire | null {
  const beast = scaledBeastStats(input.zoneId, input.tier, COURT_BEAST_ID, input.fighter.level, input.gear);
  if (!beast) return null;
  return buildFightReplayIssue({
    battleId: input.runId, seed: input.seed, tier: input.tier, mentor: false,
    player: [inputLogCombatant(input.fighter, input.gear, input.tempo, input.moves)],
    // Tier-curve numbers (no statSource 'progression'): the #72.80 fight-row delta is not applied to the beast.
    opponent: [{ holobotId: COURT_BEAST_ID, level: beast.level, maxHealth: beast.maxHealth, currentHealth: beast.maxHealth, attack: beast.attack, defense: beast.defense, speed: beast.speed }],
    chase: input.chase, attrs: input.attrs, tempo: input.tempo, live: true, guardHold: input.guardHold === true,
  });
}

/**
 * The run report a verified court fight stands for (lib/holoZoneCourtDuel.courtReportFromReceipt's rule; a draw is not a clear).
 * court-full-hp (Pak 2026-11-11): the fight started at FULL HP (issueHoloZoneRun), so its end HP is mapped onto the ledger scale
 * from a full start (the live Arena's settle: ledgerHealthAfterFight against {max, max}) and capped at the run's issue-time ledger
 * row (`issued`, which settleVitals requires the report not to exceed). settleVitals then writes min(ledger now, report): the
 * ledger never rises above what the Holobot carried in. For a run issued before full HP (fight started at the carried HP) the
 * result is the same number the old mapping gave.
 */
export function courtReportFromFightReceipt(receipt: FightReceiptWire, issued: Record<string, { currentHealth: number; maxHealth: number }>) {
  const ledgerHp = (f: FightReceiptWire["playerFinal"][number]) => {
    const row = issued[f.holobotId];
    if (!row) return f.currentHealth;
    return Math.min(row.currentHealth, ledgerHealthAfterFight(f.currentHealth, f.maxHealth, { currentHealth: row.maxHealth, maxHealth: row.maxHealth }));
  };
  return {
    kills: receipt.winner === "player" ? 1 : 0,
    bossDefeated: false,
    fielded: receipt.playerFinal.map((f) => f.holobotId),
    health: receipt.playerFinal.map((f) => ({ holobotId: f.holobotId, currentHealth: ledgerHp(f) })),
  };
}
