import { incrementArenaBattlesToday } from "@/lib/dailyMissions";
import { applyHolobotExperience } from "@/lib/progression";
import type { UserProfile } from "@/types/profile";

/**
 * Pure arena economy: tier table, entry fees, and battle settlement math.
 * Mirrored in `functions/src/lib/arenaEconomy.ts`;
 * `arenaServerParity.test.ts` enforces the match (including against
 * ArenaCombatEngine.calculateActualRewards, whose formula the settlement
 * replicates from performance counts instead of the action history).
 */

export type ArenaTierId = "rookie" | "challenger" | "elite" | "legend";

export type ArenaTier = {
  difficulty: "easy" | "medium" | "hard" | "expert";
  entryFeeHolos: number;
  id: ArenaTierId;
  label: string;
  opponentLevel: number;
  opponentPool: readonly [string, string, string];
  rewardLabel: string;
};

export const ARENA_TIERS: ArenaTier[] = [
  {
    id: "rookie",
    label: "Rookie Circuit",
    difficulty: "easy",
    entryFeeHolos: 50,
    opponentLevel: 12,
    opponentPool: ["HARE", "WAKE", "GAMA"],
    rewardLabel: "Low-risk warmup fights",
  },
  {
    id: "challenger",
    label: "Challenger Ring",
    difficulty: "medium",
    entryFeeHolos: 100,
    opponentLevel: 24,
    opponentPool: ["KUMA", "SHADOW", "TSUIN"],
    rewardLabel: "Balanced rewards and pressure",
  },
  {
    id: "elite",
    label: "Elite Gauntlet",
    difficulty: "hard",
    entryFeeHolos: 150,
    opponentLevel: 36,
    opponentPool: ["TORA", "KEN", "KURAI"],
    rewardLabel: "Harder AI and better payouts",
  },
  {
    id: "legend",
    label: "Legend Arena",
    difficulty: "expert",
    entryFeeHolos: 225,
    opponentLevel: 45,
    opponentPool: ["ACE", "WOLF", "ERA"],
    rewardLabel: "High-risk showcase battle",
  },
];

export function getArenaTier(tierId: string): ArenaTier | null {
  return ARENA_TIERS.find((tier) => tier.id === tierId) ?? null;
}

export function getArenaBlueprintAmount(tier: Pick<ArenaTier, "id">): number {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  return [5, 10, 15, 20][Math.max(0, tierIndex)] ?? 5;
}

export type ArenaBaseRewards = {
  exp: number;
  holos: number;
  syncPoints: number;
};

export function getArenaBaseRewards(tier: Pick<ArenaTier, "id" | "entryFeeHolos">): ArenaBaseRewards {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  const multiplier = 1 + Math.max(0, tierIndex) * 0.45;

  return {
    exp: Math.floor(95 * multiplier),
    holos: tier.entryFeeHolos * 2,
    syncPoints: Math.floor(35 * multiplier),
  };
}

/** Plausibility bound for per-battle performance counters. */
export const MAX_PERFORMANCE_EVENTS = 25;

export type ArenaSettlementInput = {
  combosCompleted: number;
  didWin: boolean;
  opponentName: string;
  perfectDefenses: number;
  tierId: ArenaTierId;
};

export type ArenaSettlement = {
  blueprints: { amount: number; holobotKey: string } | null;
  exp: number;
  holos: number;
  syncPoints: number;
};

/**
 * Battle payout from performance counts. Identical math to
 * ArenaCombatEngine.calculateActualRewards (loss: 30% exp / 20% SP / no
 * holos; win: 1 + 0.05/perfect defense + 0.1/combo), with counts clamped
 * and the blueprint target validated against the tier's opponent pool.
 */
export function computeArenaSettlement(input: ArenaSettlementInput): ArenaSettlement | null {
  const tier = getArenaTier(input.tierId);
  if (!tier) {
    return null;
  }

  const base = getArenaBaseRewards(tier);

  if (!input.didWin) {
    return {
      blueprints: null,
      exp: Math.floor(base.exp * 0.3),
      holos: 0,
      syncPoints: Math.floor(base.syncPoints * 0.2),
    };
  }

  const perfectDefenses = Math.min(
    MAX_PERFORMANCE_EVENTS,
    Math.max(0, Math.floor(input.perfectDefenses || 0)),
  );
  const combos = Math.min(MAX_PERFORMANCE_EVENTS, Math.max(0, Math.floor(input.combosCompleted || 0)));
  const performanceBonus = 1 + perfectDefenses * 0.05 + combos * 0.1;
  const normalizedOpponent = input.opponentName?.trim().toUpperCase() ?? "";
  const opponentInPool = tier.opponentPool.includes(normalizedOpponent);

  return {
    blueprints: opponentInPool
      ? { amount: getArenaBlueprintAmount(tier), holobotKey: normalizedOpponent.toLowerCase() }
      : null,
    exp: Math.floor(base.exp * performanceBonus),
    holos: base.holos,
    syncPoints: Math.floor(base.syncPoints * performanceBonus),
  };
}

export type ArenaEntryMethod = "pass" | "tokens";

/**
 * Raw-document updates for charging an arena entry, or null when the player
 * cannot afford it. NOTE: writes the real `arenaPassses` document field —
 * the legacy screen wrote a stray `arena_passes` field, so passes were
 * never actually consumed (bug fixed by this module).
 */
export function buildArenaEntryUpdates(
  profile: Pick<UserProfile, "arena_passes" | "holosTokens">,
  tierId: string,
  paymentMethod: ArenaEntryMethod,
): Record<string, unknown> | null {
  const tier = getArenaTier(tierId);
  if (!tier) {
    return null;
  }

  if (paymentMethod === "pass") {
    const passes = Number(profile.arena_passes || 0);
    if (passes <= 0) {
      return null;
    }
    return { arenaPassses: passes - 1 };
  }

  const holos = Number(profile.holosTokens || 0);
  if (holos < tier.entryFeeHolos) {
    return null;
  }
  return { holosTokens: holos - tier.entryFeeHolos };
}

type SettlementProfile = Pick<
  UserProfile,
  "blueprints" | "holobots" | "holosTokens" | "rewardSystem" | "stats" | "syncPoints"
>;

/**
 * Raw-document updates for persisting a settled battle, mirroring the
 * legacy persistBattleOutcome write exactly (including its quirks: EXP is
 * matched to the holobot by exact name equality, and lifetime/season sync
 * points and leaderboardScore are NOT updated by the arena path — the next
 * fitness sync reconciles them; flagged as a follow-up).
 */
export function buildArenaSettlementUpdates(
  profile: SettlementProfile,
  holobotName: string,
  input: ArenaSettlementInput,
  now = new Date(),
): { settlement: ArenaSettlement; updates: Record<string, unknown> } | null {
  const settlement = computeArenaSettlement(input);
  if (!settlement) {
    return null;
  }

  const updatedHolobots = (profile.holobots || []).map((holobot) => {
    if (holobot.name !== holobotName) {
      return holobot;
    }
    return applyHolobotExperience(holobot, settlement.exp);
  });

  const updatedBlueprints = { ...(profile.blueprints || {}) };
  if (settlement.blueprints) {
    updatedBlueprints[settlement.blueprints.holobotKey] =
      (updatedBlueprints[settlement.blueprints.holobotKey] || 0) + settlement.blueprints.amount;
  }

  return {
    settlement,
    updates: {
      blueprints: updatedBlueprints,
      holobots: updatedHolobots,
      holosTokens: Number(profile.holosTokens || 0) + settlement.holos,
      losses: Number(profile.stats?.losses || 0) + (input.didWin ? 0 : 1),
      rewardSystem: incrementArenaBattlesToday(profile.rewardSystem, now),
      syncPoints: Number(profile.syncPoints || 0) + settlement.syncPoints,
      wins: Number(profile.stats?.wins || 0) + (input.didWin ? 1 : 0),
    },
  };
}
