import { getUnlockedSyncAbilities } from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";

/**
 * Canonical progression math shared (by parity contract) with
 * `functions/progression.js`. Any change here must be mirrored there;
 * `src/lib/__tests__/progressionParity.test.ts` enforces the match.
 */

export const HOLOBOT_NAMES = [
  "ACE",
  "KUMA",
  "SHADOW",
  "ERA",
  "HARE",
  "TORA",
  "WAKE",
  "GAMA",
  "KEN",
  "KURAI",
  "TSUIN",
  "WOLF",
] as const;

export function calculateExperience(level: number) {
  return Math.floor(100 * Math.pow(Math.max(1, level), 2));
}

export function getHolobotRank(level: number) {
  if (level >= 41) return "Legendary";
  if (level >= 31) return "Elite";
  if (level >= 21) return "Rare";
  if (level >= 11) return "Champion";
  if (level >= 2) return "Starter";
  return "Rookie";
}

export function normalizeUserHolobot(holobot: UserHolobot): UserHolobot {
  const level = Math.max(1, holobot.level || 1);
  const syncStats = {
    bond: Math.max(0, Math.floor(holobot.syncStats?.bond || 0)),
    focus: Math.max(0, Math.floor(holobot.syncStats?.focus || 0)),
    guard: Math.max(0, Math.floor(holobot.syncStats?.guard || 0)),
    power: Math.max(0, Math.floor(holobot.syncStats?.power || 0)),
    tempo: Math.max(0, Math.floor(holobot.syncStats?.tempo || 0)),
  };
  const syncLevel = syncStats.power + syncStats.guard + syncStats.tempo + syncStats.focus + syncStats.bond;

  return {
    ...holobot,
    attributePoints: holobot.attributePoints ?? level,
    boostedAttributes: holobot.boostedAttributes || {},
    experience: holobot.experience || 0,
    lifetimeSPInvested: holobot.lifetimeSPInvested ?? 0,
    nextLevelExp: holobot.nextLevelExp || calculateExperience(level + 1),
    rank: holobot.rank || getHolobotRank(level),
    syncAbilityUnlocks:
      holobot.syncAbilityUnlocks ?? getUnlockedSyncAbilities({ name: holobot.name, syncStats }),
    syncLevel: holobot.syncLevel ?? syncLevel,
    syncStats,
  };
}

export function applyHolobotExperience(holobot: UserHolobot, expGain: number): UserHolobot {
  const normalized = normalizeUserHolobot(holobot);
  const nextExperience = (normalized.experience || 0) + Math.max(0, expGain);
  let nextLevel = Math.max(1, normalized.level || 1);
  let nextLevelExp = normalized.nextLevelExp || calculateExperience(nextLevel + 1);
  let attributePoints = normalized.attributePoints || 0;

  while (nextExperience >= nextLevelExp) {
    nextLevel += 1;
    attributePoints += 1;
    nextLevelExp = calculateExperience(nextLevel + 1);
  }

  return {
    ...normalized,
    attributePoints,
    experience: nextExperience,
    level: nextLevel,
    nextLevelExp,
    rank: getHolobotRank(nextLevel),
  };
}

type LeaderboardScoreInput = {
  holobots?: UserHolobot[];
  prestigeCount?: number;
  seasonSyncPoints?: number;
  wins?: number;
};

export function computeLeaderboardScore(input: LeaderboardScoreInput) {
  const highestLevel = Math.max(1, ...(input.holobots || []).map((holobot) => holobot.level || 1));
  const wins = input.wins || 0;
  const seasonSyncPoints = input.seasonSyncPoints || 0;
  const prestigeCount = input.prestigeCount || 0;

  return wins * 120 + highestLevel * 25 + seasonSyncPoints + prestigeCount * 500;
}
