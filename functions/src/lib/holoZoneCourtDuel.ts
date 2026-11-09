/**
 * Guild Court plan-and-send (Pak, 2026-11-08): the single Cacheback fight in the Lite city, resolved by the host with the
 * one duel resolver (lib/duelResolver.ts). This module only builds the pinned fight and turns its receipt into the run
 * report; settleHoloZoneRun stays the only payer, so EXP, Holos and the fragment follow the existing battle table.
 * Wire contract: functions/src/missionBoard/PLAN_AND_SEND_CONTRACT.md.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { DUEL_MAX_ROUNDS, DUEL_RECEIPT_SCHEMA, DuelFighterStats, DuelReceipt, duelFighterFromCombatant, resolveDuel } from "./duelResolver";
import { scaledBeastStats } from "./holoZoneBeastStats";
import type { PlayerCombatantSnapshot } from "./rivalLadder";

export const COURT_BEAST_ID = "cacheback";

/** Stored on the run (holoZoneRuns/{uid}, server-only). The seed never leaves the host before the receipt. */
export type CourtDuelBlock = {
  mode: "resolver";
  schemaVersion: typeof DUEL_RECEIPT_SCHEMA;
  beastId: string;
  fielderId: string;
  input: { seed: number; player: DuelFighterStats[]; opponent: DuelFighterStats[] };
};

export type CourtDuelWire = { mode: "resolver"; schemaVersion: typeof DUEL_RECEIPT_SCHEMA; maxRounds: number; beastId: string; player: DuelFighterStats[]; opponent: DuelFighterStats[] };

/** Pins both fighters and the seed at issue, the beast scaled to the fighter's level then. Throws RangeError when the zone has no row or the block is unusable. */
export function courtDuelBlock(player: PlayerCombatantSnapshot & { currentHealth: number }, zoneId: string, tier: number, seed: number): CourtDuelBlock {
  const beast = scaledBeastStats(zoneId, tier, COURT_BEAST_ID, player.level);
  if (!beast) throw new RangeError("no_court_beast");
  const input = {
    seed,
    player: [duelFighterFromCombatant({ ...player, tier })],
    // No issued moves: the host's strike / heavy / finisher / defend policy rows, with the host stamina profile.
    opponent: [duelFighterFromCombatant({ holobotId: COURT_BEAST_ID, level: beast.level, tier, maxHealth: beast.maxHealth, attack: beast.attack, defense: beast.defense, speed: beast.speed })],
  };
  resolveDuel({ ...input, playerIntents: ["defend"] }); // Validates the pinned block.
  return { mode: "resolver", schemaVersion: DUEL_RECEIPT_SCHEMA, beastId: COURT_BEAST_ID, fielderId: player.holobotId, input };
}

export function courtDuelWire(block: CourtDuelBlock): CourtDuelWire {
  return { mode: "resolver", schemaVersion: block.schemaVersion, maxRounds: DUEL_MAX_ROUNDS, beastId: block.beastId, player: block.input.player, opponent: block.input.opponent };
}

/**
 * The run report a receipt stands for, matching what Lite's Guild Court sends today (lib/citySaves.ts courtReport):
 * kills 1 for a cleared court and 0 otherwise, never a boss, and the one fielded companion.
 */
export function courtReportFromReceipt(block: CourtDuelBlock, receipt: DuelReceipt) {
  return {
    kills: receipt.winner === "player" ? 1 : 0,
    bossDefeated: false,
    fielded: [block.fielderId],
    health: receipt.playerFinal.map((f) => ({ holobotId: f.holobotId, currentHealth: f.currentHealth })),
  };
}
