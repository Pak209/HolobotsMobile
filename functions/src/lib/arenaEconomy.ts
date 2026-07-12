/**
 * Server-side arena economy. Mirror of `mobile/src/lib/arenaEconomy.ts`;
 * `mobile/src/lib/__tests__/arenaServerParity.test.ts` imports this file
 * and fails if the two sides drift. Same raw-vs-mapped convention as
 * lib/economy.ts: this module reads/writes raw Firestore document fields
 * (arenaPassses, wins, losses at the top level).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */

import { applyHolobotExperience } from "./progression";

export type ArenaTierId = "rookie" | "challenger" | "elite" | "legend";

export type ArenaEconomyTier = {
  entryFeeHolos: number;
  id: ArenaTierId;
  opponentLevel: number;
  opponentPool: readonly [string, string, string];
};

export const ARENA_TIERS: ArenaEconomyTier[] = [
  { entryFeeHolos: 50, id: "rookie", opponentLevel: 12, opponentPool: ["HARE", "WAKE", "GAMA"] },
  { entryFeeHolos: 100, id: "challenger", opponentLevel: 24, opponentPool: ["KUMA", "SHADOW", "TSUIN"] },
  { entryFeeHolos: 150, id: "elite", opponentLevel: 36, opponentPool: ["TORA", "KEN", "KURAI"] },
  { entryFeeHolos: 225, id: "legend", opponentLevel: 45, opponentPool: ["ACE", "WOLF", "ERA"] },
];

export function getArenaTier(tierId: string): ArenaEconomyTier | null {
  return ARENA_TIERS.find((tier) => tier.id === tierId) ?? null;
}

export function getArenaBlueprintAmount(tier: Pick<ArenaEconomyTier, "id">): number {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  return [5, 10, 15, 20][Math.max(0, tierIndex)] ?? 5;
}

export type ArenaBaseRewards = {
  exp: number;
  holos: number;
  syncPoints: number;
};

export function getArenaBaseRewards(
  tier: Pick<ArenaEconomyTier, "id" | "entryFeeHolos">,
): ArenaBaseRewards {
  const tierIndex = ARENA_TIERS.findIndex((candidate) => candidate.id === tier.id);
  const multiplier = 1 + Math.max(0, tierIndex) * 0.45;

  return {
    exp: Math.floor(95 * multiplier),
    holos: tier.entryFeeHolos * 2,
    syncPoints: Math.floor(35 * multiplier),
  };
}

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
  // Rookie's third slot rotates GAMA/KUMA/SHADOW weekly on the client
  // (Genesis rotation); settlements accept the union so week boundaries
  // never invalidate an honest battle.
  const acceptedPool =
    tier.id === "rookie"
      ? [...tier.opponentPool, "KUMA", "SHADOW"]
      : [...tier.opponentPool];
  const opponentInPool = acceptedPool.includes(normalizedOpponent);

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

/** Raw-field entry charge, or null when the player cannot afford it. */
export function buildArenaEntryUpdatesRaw(
  userData: Record<string, unknown>,
  tierId: string,
  paymentMethod: ArenaEntryMethod,
): Record<string, unknown> | null {
  const tier = getArenaTier(tierId);
  if (!tier) {
    return null;
  }

  if (paymentMethod === "pass") {
    const passes = Number(userData.arenaPassses || 0);
    if (passes <= 0) {
      return null;
    }
    return { arenaPassses: passes - 1 };
  }

  const holos = Number(userData.holosTokens || 0);
  if (holos < tier.entryFeeHolos) {
    return null;
  }
  return { holosTokens: holos - tier.entryFeeHolos };
}

export function getTodayMissionKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Mirror of dailyMissions.incrementArenaBattlesToday. */
export function incrementArenaBattlesToday(value: unknown, date = new Date()): Record<string, unknown> {
  const todayKey = getTodayMissionKey(date);
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hasFreshCounters = raw.lastDailyMissionReset === todayKey;

  return {
    arenaBattlesToday: (hasFreshCounters ? Number(raw.arenaBattlesToday || 0) : 0) + 1,
    boosterPacksToday: hasFreshCounters ? Number(raw.boosterPacksToday || 0) : 0,
    lastDailyMissionReset: todayKey,
    missionClaims: raw.missionClaims && typeof raw.missionClaims === "object" ? raw.missionClaims : {},
  };
}

/**
 * Raw-field settlement write, mirroring the legacy persistBattleOutcome
 * exactly (EXP matched by exact holobot-name equality; lifetime/season sync
 * points and leaderboardScore deliberately untouched — the arena path never
 * updated them; the next fitness sync reconciles).
 */
export function buildArenaSettlementUpdatesRaw(
  userData: Record<string, unknown>,
  holobotName: string,
  input: ArenaSettlementInput,
  now = new Date(),
): { settlement: ArenaSettlement; updates: Record<string, unknown> } | null {
  const settlement = computeArenaSettlement(input);
  if (!settlement) {
    return null;
  }

  const currentHolobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const updatedHolobots = currentHolobots.map((holobot) => {
    const name =
      holobot && typeof holobot === "object" ? (holobot as { name?: unknown }).name : undefined;
    if (name !== holobotName) {
      return holobot;
    }
    return applyHolobotExperience(holobot, settlement.exp);
  });

  const updatedBlueprints = { ...((userData.blueprints as Record<string, number>) || {}) };
  if (settlement.blueprints) {
    updatedBlueprints[settlement.blueprints.holobotKey] =
      (updatedBlueprints[settlement.blueprints.holobotKey] || 0) + settlement.blueprints.amount;
  }

  return {
    settlement,
    updates: {
      blueprints: updatedBlueprints,
      holobots: updatedHolobots,
      holosTokens: Number(userData.holosTokens || 0) + settlement.holos,
      losses: Number(userData.losses || 0) + (input.didWin ? 0 : 1),
      rewardSystem: incrementArenaBattlesToday(userData.rewardSystem, now),
      syncPoints: Number(userData.syncPoints || 0) + settlement.syncPoints,
      wins: Number(userData.wins || 0) + (input.didWin ? 1 : 0),
    },
  };
}
