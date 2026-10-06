/**
 * DECISIONS #53 amendment 1 (Pak, 2026-10-06 ~14:07): the rival ladder
 * rescale. Rival tier t fields WOLF's own battle stats at level 1 + 4t
 * (tier 0 = a fresh L1 WOLF, tier 9 = L37), so rivals sit on the same curve
 * as the player's Holobots:
 *
 *   level = min(99, 1 + 4 x tier)
 *   stats = getHolobotBattleStats("WOLF", level, {})   (no boosts, no sync, no parts)
 *
 * The HoloCity rival host (functions/src/lib/rivalLadder.ts) serves these to
 * rival-battle-3 requests only; rival-battle-1 / -2 replies keep the #43
 * baseline x statScale so the shipped Unity build is untouched. The tier
 * table's labels, rival counts and the Buddy Unit tiers are unchanged
 * (#43 / #44).
 *
 * BYTE-IDENTICAL PAIR: mobile/src/lib/rivalTierStats.ts and
 * functions/src/lib/rivalTierStats.ts. `npm run check:shared` (part of the
 * functions build) and
 * mobile/src/lib/__tests__/rivalLadderScaleParity.test.ts fail on any drift.
 * Copy the intended version over the stale one. Each side's ./progression
 * getHolobotBattleStats is the parity-tested stat curve
 * (playerCombatantParity.test.ts).
 *
 * Pure module: imports only ./progression, no firebase.
 */
import { getHolobotBattleStats } from "./progression";

/** The Holobot whose stat curve every rival uses (whatever its displayed id). */
export const RIVAL_STAT_HOLOBOT = "WOLF";
/** Tier 0 = level 1. */
export const RIVAL_SCALE_BASE_LEVEL = 1;
export const RIVAL_SCALE_LEVELS_PER_TIER = 4;
/** Same cap as the #43 table's extrapolation (rivalLadder.ts RIVAL_MAX_LEVEL); reached at tier 25. */
export const RIVAL_SCALE_MAX_LEVEL = 99;
/**
 * Stored on every rival battle record issued with this scale (lineupScale), so
 * a stored lineup is unambiguous. Records without the field use the #43
 * baseline x statScale.
 */
export const RIVAL_LINEUP_SCALE_WOLF = "wolf-level-1-plus-4t";

export type RivalTierBattleStats = {
  level: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;
};

/** Non-negative safe-integer tiers only (the ladder's floor(rivalWins / 10)). */
export function rivalScaleLevel(tier: number): number {
  if (!Number.isSafeInteger(tier) || tier < 0) {
    throw new RangeError("tier");
  }
  return Math.min(RIVAL_SCALE_MAX_LEVEL, RIVAL_SCALE_BASE_LEVEL + RIVAL_SCALE_LEVELS_PER_TIER * tier);
}

/** One rival's battle stats at `tier` (every rival in a lineup gets the same numbers). */
export function rivalTierBattleStats(tier: number): RivalTierBattleStats {
  const level = rivalScaleLevel(tier);
  const stats = getHolobotBattleStats(RIVAL_STAT_HOLOBOT, level, {});
  return {
    level,
    maxHealth: stats.maxHP,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    intelligence: stats.intelligence,
  };
}
