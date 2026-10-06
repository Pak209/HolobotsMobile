/**
 * DECISIONS #53-1 (Pak, 2026-10-06): ONE battle XP table for every battle
 * kind. Arena battles, HoloCity rival battles and Error Beast encounters all
 * settle through computeBattleSettlement; it is the arena settlement math
 * extracted unchanged (arenaEconomy.ts now calls it).
 *
 *   tierMultiplier = 1 + tier x 0.45
 *   base exp       = floor(95 x tierMultiplier)     base sync = floor(35 x tierMultiplier)
 *   win            = floor(base x (1 + 0.05 x perfectDefenses + 0.1 x combos)), counts clamped 0..25
 *   loss           = floor(base exp x 0.3), floor(base sync x 0.2), no performance bonus
 *   EXP Booster    = exp x 2 while users/{uid}.expBoosterActiveUntil is in the future
 *
 * `tier` is the arena tier index (rookie 0 ... legend 3), the rival ladder
 * tier (0, 1, 2 ... unbounded) or a HoloZone tier. `kind` does not change the
 * numbers (one table); it is validated and kept for records. Holos and
 * blueprints stay arena-only (arenaEconomy.ts); rival and beast settlements
 * grant the EXP only (Holobot progression via applyHolobotExperience).
 *
 * BYTE-IDENTICAL PAIR: mobile/src/lib/battleSettlement.ts and
 * functions/src/lib/battleSettlement.ts. `npm run check:shared` (part of the
 * functions build) and mobile/src/lib/__tests__/battleSettlementParity.test.ts
 * fail on any drift. Copy the intended version over the stale one.
 *
 * Pure module: no imports, no firebase, safe to import from tests.
 */

export type BattleKind = "arena" | "rival" | "beast";

export const BATTLE_KINDS: readonly BattleKind[] = ["arena", "rival", "beast"];

export const BATTLE_BASE_EXP = 95;
export const BATTLE_BASE_SYNC_POINTS = 35;
export const BATTLE_TIER_STEP = 0.45;
export const BATTLE_LOSS_EXP_FRACTION = 0.3;
export const BATTLE_LOSS_SYNC_FRACTION = 0.2;
export const BATTLE_PERFECT_DEFENSE_BONUS = 0.05;
export const BATTLE_COMBO_BONUS = 0.1;
/** Plausibility bound for per-battle performance counters. */
export const MAX_PERFORMANCE_EVENTS = 25;
/** EXP Booster (marketplace item): doubled battle EXP while active. */
export const EXP_BOOSTER_MULTIPLIER = 2;

export type BattleBaseRewards = {
  exp: number;
  syncPoints: number;
};

export type BattleSettlementInput = {
  combosCompleted?: number;
  didWin: boolean;
  kind: BattleKind;
  perfectDefenses?: number;
  tier: number;
};

export type BattleSettlement = {
  exp: number;
  kind: BattleKind;
  performanceBonus: number;
  syncPoints: number;
  tier: number;
};

export function isBattleKind(value: unknown): value is BattleKind {
  return typeof value === "string" && (BATTLE_KINDS as readonly string[]).includes(value);
}

/** Non-negative integer tier; anything else reads as tier 0 (the arena's findIndex(-1) rule). */
export function normalizeBattleTier(tier: number): number {
  return Number.isFinite(tier) ? Math.max(0, Math.floor(tier)) : 0;
}

export function getBattleTierMultiplier(tier: number): number {
  return 1 + normalizeBattleTier(tier) * BATTLE_TIER_STEP;
}

export function getBattleBaseRewards(tier: number): BattleBaseRewards {
  const multiplier = getBattleTierMultiplier(tier);
  return {
    exp: Math.floor(BATTLE_BASE_EXP * multiplier),
    syncPoints: Math.floor(BATTLE_BASE_SYNC_POINTS * multiplier),
  };
}

export function clampPerformanceCount(value: unknown): number {
  return Math.min(MAX_PERFORMANCE_EVENTS, Math.max(0, Math.floor(Number(value) || 0)));
}

export function getBattlePerformanceBonus(perfectDefenses: unknown, combosCompleted: unknown): number {
  return (
    1 +
    clampPerformanceCount(perfectDefenses) * BATTLE_PERFECT_DEFENSE_BONUS +
    clampPerformanceCount(combosCompleted) * BATTLE_COMBO_BONUS
  );
}

/** The one battle XP table. Null for an unknown kind. */
export function computeBattleSettlement(input: BattleSettlementInput): BattleSettlement | null {
  if (!input || !isBattleKind(input.kind)) {
    return null;
  }

  const tier = normalizeBattleTier(input.tier);
  const base = getBattleBaseRewards(tier);

  if (!input.didWin) {
    return {
      exp: Math.floor(base.exp * BATTLE_LOSS_EXP_FRACTION),
      kind: input.kind,
      performanceBonus: 1,
      syncPoints: Math.floor(base.syncPoints * BATTLE_LOSS_SYNC_FRACTION),
      tier,
    };
  }

  const performanceBonus = getBattlePerformanceBonus(input.perfectDefenses, input.combosCompleted);

  return {
    exp: Math.floor(base.exp * performanceBonus),
    kind: input.kind,
    performanceBonus,
    syncPoints: Math.floor(base.syncPoints * performanceBonus),
    tier,
  };
}

/** True while the server-set EXP Booster window is open. */
export function isExpBoosterActive(expBoosterActiveUntil: unknown, nowMs: number): boolean {
  return Number(expBoosterActiveUntil || 0) > nowMs;
}

export function applyExpBooster(exp: number, expBoosterActiveUntil: unknown, nowMs: number): number {
  return isExpBoosterActive(expBoosterActiveUntil, nowMs) ? exp * EXP_BOOSTER_MULTIPLIER : exp;
}
