/**
 * Canonical server-side progression math.
 *
 * This module is the server mirror of `mobile/src/lib/progression.ts` and the
 * sync-rank thresholds in `mobile/src/lib/syncProgression.ts`. The two sides
 * must stay behaviorally identical; the mobile test suite
 * (`mobile/src/lib/__tests__/progressionParity.test.ts`) imports this file
 * directly and fails if they drift.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */

export type ServerHolobot = {
  attributePoints?: number;
  career?: ServerHolobotCareer;
  experience: number;
  level: number;
  name: string;
  nextLevelExp: number;
  rank?: string;
  [key: string]: unknown;
};

export type ServerHolobotCareer = {
  activeDays?: number;
  distanceMeters?: number;
  firstWorkoutDate?: string;
  lastWorkoutDate?: string;
  workouts?: number;
};

export function calculateExperience(level: number): number {
  return Math.floor(100 * Math.pow(Math.max(1, level), 2));
}

export function getHolobotRank(level: number): string {
  if (level >= 41) return "Legendary";
  if (level >= 31) return "Elite";
  if (level >= 21) return "Rare";
  if (level >= 11) return "Champion";
  if (level >= 2) return "Starter";
  return "Rookie";
}

export function normalizeUserHolobot(rawHolobot: unknown): ServerHolobot {
  if (!rawHolobot || typeof rawHolobot !== "object") {
    return {
      attributePoints: 1,
      experience: 0,
      level: 1,
      name: "KUMA",
      nextLevelExp: calculateExperience(2),
      rank: getHolobotRank(1),
    };
  }

  const source = rawHolobot as Record<string, unknown>;
  const level = Math.max(1, Number(source.level || 1));

  return {
    ...source,
    attributePoints:
      source.attributePoints === undefined || source.attributePoints === null
        ? level
        : Math.max(0, Number(source.attributePoints || 0)),
    experience: Math.max(0, Number(source.experience || 0)),
    level,
    name: typeof source.name === "string" ? source.name : "KUMA",
    nextLevelExp: Number(source.nextLevelExp || 0) || calculateExperience(level + 1),
    rank: typeof source.rank === "string" && source.rank ? source.rank : getHolobotRank(level),
  };
}

export function applyHolobotExperience(rawHolobot: unknown, expGain: number): ServerHolobot {
  const normalized = normalizeUserHolobot(rawHolobot);
  const nextExperience = (normalized.experience || 0) + Math.max(0, Number(expGain || 0));
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

export type WorkoutCareerUpdate = {
  date: string;
  distanceMeters?: number;
};

export function applyWorkoutCareer(rawHolobot: unknown, update: WorkoutCareerUpdate): ServerHolobot {
  const source =
    rawHolobot && typeof rawHolobot === "object"
      ? (rawHolobot as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const career: ServerHolobotCareer =
    source.career && typeof source.career === "object" ? (source.career as ServerHolobotCareer) : {};
  const date = typeof update?.date === "string" ? update.date : "";
  const isNewActiveDay = Boolean(date) && career.lastWorkoutDate !== date;

  return {
    ...(source as ServerHolobot),
    career: {
      activeDays: Math.max(0, Math.floor(Number(career.activeDays || 0))) + (isNewActiveDay ? 1 : 0),
      distanceMeters:
        Math.max(0, Math.round(Number(career.distanceMeters || 0))) +
        Math.max(0, Math.round(Number(update?.distanceMeters || 0))),
      firstWorkoutDate: career.firstWorkoutDate || date,
      lastWorkoutDate: date || career.lastWorkoutDate,
      workouts: Math.max(0, Math.floor(Number(career.workouts || 0))) + 1,
    },
  };
}

export const SYNC_RANK_THRESHOLDS: Array<{ min: number; rank: string }> = [
  { min: 50000, rank: "Legend" },
  { min: 25000, rank: "Champion" },
  { min: 12000, rank: "Strider" },
  { min: 5000, rank: "Pilot" },
  { min: 1000, rank: "Walker" },
  { min: 0, rank: "Rookie" },
];

export function getSyncRank(lifetimeSyncPoints: number): string {
  const safeLifetime = Math.max(0, Math.floor(Number(lifetimeSyncPoints) || 0));
  const entry = SYNC_RANK_THRESHOLDS.find((threshold) => safeLifetime >= threshold.min);
  return entry ? entry.rank : "Rookie";
}

export function computeLeaderboardScore(input: {
  holobots?: unknown[];
  prestigeCount?: number;
  seasonSyncPoints?: number;
  wins?: number;
}): number {
  const holobots = Array.isArray(input?.holobots) ? input.holobots : [];
  const highestLevel = Math.max(
    1,
    ...holobots.map((holobot) =>
      Number((holobot && typeof holobot === "object" ? (holobot as { level?: number }).level : 1) || 1),
    ),
  );
  const wins = Number(input?.wins || 0);
  const seasonSyncPoints = Number(input?.seasonSyncPoints || 0);
  const prestigeCount = Number(input?.prestigeCount || 0);

  return wins * 120 + highestLevel * 25 + seasonSyncPoints + prestigeCount * 500;
}
