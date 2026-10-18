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

/**
 * economy-host-2, using Unity QA/2026-10-13-feel-4: cut swings changed CPU damage/min
 * 2098 -> 1957 (player 1319 -> 538). Target CPU retained output is 45% at tier 0,
 * rising linearly to 80% at tier 9; higher tiers retain the tier-9 adjustment.
 * Divide by the measured CPU retention so we do not apply its existing loss twice.
 * These are modeled targets, not a fresh gameplay-duration measurement.
 * Only rival-battle-3 CPU move damageScale changes; player and legacy snapshots stay intact.
 */
export const RIVAL_CUT_SWING_CPU_RETENTION = 1957 / 2098;
export const RIVAL_DAMAGE_TOP_TIER = 9;
export const RIVAL_DAMAGE_RETAINED_ROOKIE = 0.45;
export const RIVAL_DAMAGE_RETAINED_TOP = 0.8;
export function rivalTierDamageScale(tier: number): number {
  if (!Number.isSafeInteger(tier) || tier < 0) throw new RangeError("tier");
  const progress = Math.min(tier, RIVAL_DAMAGE_TOP_TIER) / RIVAL_DAMAGE_TOP_TIER;
  const target = RIVAL_DAMAGE_RETAINED_ROOKIE + (RIVAL_DAMAGE_RETAINED_TOP - RIVAL_DAMAGE_RETAINED_ROOKIE) * progress;
  return target / RIVAL_CUT_SWING_CPU_RETENTION;
}

/** W72 / #68: named story rival. Balance is explicitly provisional, copied from WOLF. */
export const RIVAL_NAMED_PROFILES = {
  jusan: {
    sizeTier: "Medium",
    balancePlaceholder: { sourceHolobotId: "wolf", pendingTuning: true },
    // WOLF has no sky_launch row: its break_heavy values are the explicit temporary source.
    moves: [
      { moveId: "gap_closer", staminaCost: 22, damageScale: 1.35, breakPower: 14, chargeable: true },
      { moveId: "break_heavy", staminaCost: 38, damageScale: 1.55, breakPower: 42, chargeable: true },
      { moveId: "sky_launch", staminaCost: 38, damageScale: 1.55, breakPower: 42, chargeable: true },
      { moveId: "intercept", staminaCost: 18, damageScale: 0.45, breakPower: 6, chargeable: false },
    ],
    // Presentation names; these do not introduce additional resolver commands or costs.
    specials: [
      { specialId: "rising_edge", displayName: "Rising Edge", damageScale: 1.55 },
      { specialId: "nova_burst", displayName: "Nova Burst", damageScale: 1.55 },
    ],
  },
} as const;
