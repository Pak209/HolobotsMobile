import {
  applyExpBooster,
  computeBattleSettlement,
  getBattleBaseRewards,
  MAX_PERFORMANCE_EVENTS,
} from "@/lib/battleSettlement";
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

/**
 * Genesis rotation: Rookie's third slot cycles GAMA -> KUMA -> SHADOW by UTC
 * week, so new players can target-farm the Genesis Squad bots without a
 * tier climb (genesis-squad-monetization-plan.md §7). Other tiers are
 * static. The server accepts the UNION for rookie settlements since a
 * battle can straddle a week boundary.
 */
export const ROOKIE_ROTATION = ["GAMA", "KUMA", "SHADOW"] as const;

export function getTierOpponentPool(
  tier: Pick<ArenaTier, "id" | "opponentPool">,
  date: Date = new Date(),
): [string, string, string] {
  if (tier.id !== "rookie") {
    return [...tier.opponentPool] as [string, string, string];
  }
  const week = Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
  const featured = ROOKIE_ROTATION[week % ROOKIE_ROTATION.length];
  return [tier.opponentPool[0], tier.opponentPool[1], featured];
}

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
  // DECISIONS #53-1: the one battle XP table (lib/battleSettlement.ts) by tier index.
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  const shared = getBattleBaseRewards(Math.max(0, tierIndex));

  return {
    exp: shared.exp,
    holos: tier.entryFeeHolos * 2,
    syncPoints: shared.syncPoints,
  };
}

/** Plausibility bound for per-battle performance counters (lib/battleSettlement.ts). */
export { MAX_PERFORMANCE_EVENTS };

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
  // EXP / sync points come from the one battle table (DECISIONS #53-1); holos and
  // blueprints are the arena's own payout.
  const shared = computeBattleSettlement({
    combosCompleted: input.combosCompleted,
    didWin: input.didWin,
    kind: "arena",
    perfectDefenses: input.perfectDefenses,
    tier: Math.max(0, ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id)),
  })!;

  if (!input.didWin) {
    return {
      blueprints: null,
      exp: shared.exp,
      holos: 0,
      syncPoints: shared.syncPoints,
    };
  }

  const normalizedOpponent = input.opponentName?.trim().toUpperCase() ?? "";
  // Rookie's third slot rotates GAMA/KUMA/SHADOW weekly (Genesis rotation);
  // settlements accept the union so week boundaries never invalidate an
  // honest battle. Mirrors functions/src/lib/arenaEconomy.ts.
  const acceptedPool =
    tier.id === "rookie" ? [...tier.opponentPool, "KUMA", "SHADOW"] : [...tier.opponentPool];
  const opponentInPool = acceptedPool.includes(normalizedOpponent);

  return {
    blueprints: opponentInPool
      ? { amount: getArenaBlueprintAmount(tier), holobotKey: normalizedOpponent.toLowerCase() }
      : null,
    exp: shared.exp,
    holos: base.holos,
    syncPoints: shared.syncPoints,
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
  "blueprints" | "expBoosterActiveUntil" | "holobots" | "holosTokens" | "rewardSystem" | "stats" | "syncPoints"
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

  // EXP Booster: doubled arena EXP while the server-set window is active.
  const awardedExp = applyExpBooster(settlement.exp, profile.expBoosterActiveUntil, now.getTime());

  const updatedHolobots = (profile.holobots || []).map((holobot) => {
    if (holobot.name !== holobotName) {
      return holobot;
    }
    return applyHolobotExperience(holobot, awardedExp);
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
