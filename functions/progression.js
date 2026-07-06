/**
 * Canonical progression math for Cloud Functions.
 *
 * This file is the server mirror of `mobile/src/lib/progression.ts` and
 * `mobile/src/lib/syncProgression.ts` (sync-rank thresholds). The two sides
 * must stay identical; `mobile/src/lib/__tests__/progressionParity.test.ts`
 * imports this file directly and fails if they drift.
 *
 * Pure module: no firebase-admin imports, safe to require from tests.
 */

function calculateExperience(level) {
  return Math.floor(100 * Math.pow(Math.max(1, level), 2));
}

function getHolobotRank(level) {
  if (level >= 41) return "Legendary";
  if (level >= 31) return "Elite";
  if (level >= 21) return "Rare";
  if (level >= 11) return "Champion";
  if (level >= 2) return "Starter";
  return "Rookie";
}

function normalizeUserHolobot(rawHolobot) {
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

  const level = Math.max(1, Number(rawHolobot.level || 1));

  return {
    ...rawHolobot,
    attributePoints:
      rawHolobot.attributePoints === undefined || rawHolobot.attributePoints === null
        ? level
        : Math.max(0, Number(rawHolobot.attributePoints || 0)),
    experience: Math.max(0, Number(rawHolobot.experience || 0)),
    level,
    name: typeof rawHolobot.name === "string" ? rawHolobot.name : "KUMA",
    nextLevelExp: Number(rawHolobot.nextLevelExp || 0) || calculateExperience(level + 1),
    rank: rawHolobot.rank || getHolobotRank(level),
  };
}

function applyHolobotExperience(rawHolobot, expGain) {
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

function applyWorkoutCareer(holobot, update) {
  const source = holobot && typeof holobot === "object" ? holobot : {};
  const career = source.career && typeof source.career === "object" ? source.career : {};
  const date = typeof (update && update.date) === "string" ? update.date : "";
  const isNewActiveDay = Boolean(date) && career.lastWorkoutDate !== date;

  return {
    ...source,
    career: {
      activeDays: Math.max(0, Math.floor(Number(career.activeDays || 0))) + (isNewActiveDay ? 1 : 0),
      distanceMeters:
        Math.max(0, Math.round(Number(career.distanceMeters || 0))) +
        Math.max(0, Math.round(Number((update && update.distanceMeters) || 0))),
      firstWorkoutDate: career.firstWorkoutDate || date,
      lastWorkoutDate: date || career.lastWorkoutDate,
      workouts: Math.max(0, Math.floor(Number(career.workouts || 0))) + 1,
    },
  };
}

const SYNC_RANK_THRESHOLDS = [
  { min: 50000, rank: "Legend" },
  { min: 25000, rank: "Champion" },
  { min: 12000, rank: "Strider" },
  { min: 5000, rank: "Pilot" },
  { min: 1000, rank: "Walker" },
  { min: 0, rank: "Rookie" },
];

function getSyncRank(lifetimeSyncPoints) {
  const safeLifetime = Math.max(0, Math.floor(Number(lifetimeSyncPoints) || 0));
  const entry = SYNC_RANK_THRESHOLDS.find((threshold) => safeLifetime >= threshold.min);
  return entry ? entry.rank : "Rookie";
}

function computeLeaderboardScore(input) {
  const holobots = Array.isArray(input && input.holobots) ? input.holobots : [];
  const highestLevel = Math.max(1, ...holobots.map((holobot) => Number((holobot && holobot.level) || 1)));
  const wins = Number((input && input.wins) || 0);
  const seasonSyncPoints = Number((input && input.seasonSyncPoints) || 0);
  const prestigeCount = Number((input && input.prestigeCount) || 0);

  return wins * 120 + highestLevel * 25 + seasonSyncPoints + prestigeCount * 500;
}

module.exports = {
  applyHolobotExperience,
  applyWorkoutCareer,
  calculateExperience,
  computeLeaderboardScore,
  getHolobotRank,
  getSyncRank,
  normalizeUserHolobot,
  SYNC_RANK_THRESHOLDS,
};
