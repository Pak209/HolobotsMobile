import { getUnlockedSyncAbilities } from "@/lib/syncProgression";
import type { HolobotCareer, UserHolobot } from "@/types/profile";

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

export const HOLOBOT_BASE_STATS = {
  ACE: { attack: 8, defense: 6, hp: 150, intelligence: 5, speed: 6 },
  KUMA: { attack: 7, defense: 5, hp: 200, intelligence: 4, speed: 4 },
  SHADOW: { attack: 5, defense: 7, hp: 170, intelligence: 3, speed: 4 },
  ERA: { attack: 5, defense: 4, hp: 165, intelligence: 4, speed: 6 },
  HARE: { attack: 4, defense: 5, hp: 160, intelligence: 3, speed: 4 },
  TORA: { attack: 5, defense: 4, hp: 180, intelligence: 4, speed: 6 },
  WAKE: { attack: 6, defense: 3, hp: 170, intelligence: 4, speed: 4 },
  GAMA: { attack: 6, defense: 5, hp: 180, intelligence: 4, speed: 4 },
  KEN: { attack: 7, defense: 3, hp: 150, intelligence: 5, speed: 6 },
  KURAI: { attack: 4, defense: 6, hp: 190, intelligence: 3, speed: 4 },
  TSUIN: { attack: 6, defense: 4, hp: 160, intelligence: 4, speed: 5 },
  WOLF: { attack: 5, defense: 5, hp: 175, intelligence: 4, speed: 5 },
} as const;

/**
 * DECISIONS #72.78 (2): base SPEED narrowed from 3-7 to 4-6 (3->4, 4->4, 5->5, 6->6, 7->6) in
 * HOLOBOT_BASE_STATS above. This is the pre-#72.78 column, frozen for provenance and for any
 * consumer that must reproduce a pre-#72.78 output. Read by getLegacyBattleSpeed (quest / training
 * power score, a frozen economy surface). The legacy duel resolver and battlefield-movement-1 take
 * speed as an input (movement normalises by the bot's own LV 1 stat) and read the live column.
 * Never edit.
 */
export const LEGACY_BASE_SPEED_PRE_72_78 = {
  ACE: 7, KUMA: 3, SHADOW: 4, ERA: 6, HARE: 4, TORA: 6, WAKE: 4, GAMA: 3, KEN: 6, KURAI: 3, TSUIN: 5, WOLF: 5,
} as const;

/** The pre-#72.78 battle-scale speed: getHolobotBattleStats(...).speed computed on LEGACY_BASE_SPEED_PRE_72_78. */
export function getLegacyBattleSpeed(
  name: string,
  level = 1,
  boostedAttributes?: UserHolobot["boostedAttributes"],
) {
  const normalizedName = name.trim().toUpperCase() as keyof typeof LEGACY_BASE_SPEED_PRE_72_78;
  const base = LEGACY_BASE_SPEED_PRE_72_78[normalizedName] ?? LEGACY_BASE_SPEED_PRE_72_78.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;
  return Math.floor(base * 10 * levelBonus) + (boostedAttributes?.speed || 0);
}

export const HOLOBOT_ARCHETYPES = {
  ACE: "balanced",
  KUMA: "grappler",
  SHADOW: "technical",
  ERA: "balanced",
  HARE: "striker",
  TORA: "striker",
  WAKE: "balanced",
  GAMA: "grappler",
  KEN: "technical",
  KURAI: "grappler",
  TSUIN: "balanced",
  WOLF: "striker",
} as const;

export function getHolobotBattleStats(
  name: string,
  level = 1,
  boostedAttributes?: UserHolobot["boostedAttributes"],
) {
  const normalizedName = name.trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const base = HOLOBOT_BASE_STATS[normalizedName] ?? HOLOBOT_BASE_STATS.ACE;
  const archetype = HOLOBOT_ARCHETYPES[normalizedName] ?? HOLOBOT_ARCHETYPES.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  const maxHP = Math.floor(base.hp * levelBonus) + (boostedAttributes?.health || 0);
  const attack = Math.floor(base.attack * 10 * levelBonus) + (boostedAttributes?.attack || 0);
  const defense = Math.floor(base.defense * 10 * levelBonus) + (boostedAttributes?.defense || 0);
  const speed = Math.floor(base.speed * 10 * levelBonus) + (boostedAttributes?.speed || 0);
  const intelligence = Math.floor(base.intelligence * 10 * levelBonus) + (boostedAttributes?.special || 0);

  return {
    archetype,
    attack,
    defense,
    intelligence,
    maxHP,
    speed,
  };
}

/**
 * The mobile DISPLAY scale (TrainingScreen, HoloCity STATS page via desktop-account-3):
 * floor(base x levelBonus) + flat boost — no x10 on attack / defense / speed / special; HP is
 * the battle formula. Moved here from config/holobots.ts (DECISIONS #53 amendment 2) so the
 * app and the server (functions/src/lib/progression.ts, parity-tested) share one formula.
 */
export function getHolobotDisplayStats(
  name: string,
  level = 1,
  boostedAttributes?: UserHolobot["boostedAttributes"],
) {
  const normalizedName = name.trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const base = HOLOBOT_BASE_STATS[normalizedName] ?? HOLOBOT_BASE_STATS.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  return {
    attack: Math.floor(base.attack * levelBonus) + (boostedAttributes?.attack || 0),
    defense: Math.floor(base.defense * levelBonus) + (boostedAttributes?.defense || 0),
    hp: Math.floor(base.hp * levelBonus) + (boostedAttributes?.health || 0),
    special: Math.floor(base.intelligence * levelBonus) + (boostedAttributes?.special || 0),
    speed: Math.floor(base.speed * levelBonus) + (boostedAttributes?.speed || 0),
  };
}

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

/**
 * DECISIONS #53-2 (Pak, 2026-10-06), amended by #72.78 (4)+(5): attribute points
 * buy attack / defense / speed / SPECIAL (+1 each) or HP (+3; was +10). SPECIAL is
 * stored as boostedAttributes.special (battle stats read it as intelligence).
 * boostedAttributes.health stores HP units (the sum), not a point count, so HP
 * allocated at +10/point before #72.78 keeps its value; new points add 3.
 * Applied server-side by the `boostHolobotAttribute` callable; the server
 * mirror is functions/src/lib/progression.ts (attributeBoostParity.test.ts).
 */
export const BOOSTABLE_ATTRIBUTES = ["attack", "defense", "speed", "health", "special"] as const;
export type BoostableAttribute = (typeof BOOSTABLE_ATTRIBUTES)[number];
export const ATTRIBUTE_BOOST_AMOUNTS: Record<BoostableAttribute, number> = {
  attack: 1,
  defense: 1,
  health: 3,
  special: 1,
  speed: 1,
};
export type AttributeBoostRefusal = "attribute_not_boostable" | "no_attribute_points";
export type AttributeBoostResult =
  | { applied: true; holobot: UserHolobot }
  | { applied: false; holobot: UserHolobot; reason: AttributeBoostRefusal };

export function isBoostableAttribute(value: unknown): value is BoostableAttribute {
  return typeof value === "string" && (BOOSTABLE_ATTRIBUTES as readonly string[]).includes(value);
}

/** The InventoryScreen boost math (spend 1 point). Unknown attributes are refused. Pure. */
export function applyAttributeBoost(holobot: UserHolobot, attribute: string): AttributeBoostResult {
  const normalized = normalizeUserHolobot(holobot);
  if (!isBoostableAttribute(attribute)) {
    return { applied: false, holobot: normalized, reason: "attribute_not_boostable" };
  }

  const points = Number(normalized.attributePoints || 0);
  if (!(points > 0)) {
    return { applied: false, holobot: normalized, reason: "no_attribute_points" };
  }

  const boosts = { ...(normalized.boostedAttributes || {}) };
  boosts[attribute] = (Number(boosts[attribute]) || 0) + ATTRIBUTE_BOOST_AMOUNTS[attribute];

  return {
    applied: true,
    holobot: {
      ...normalized,
      attributePoints: Math.max(0, points - 1),
      boostedAttributes: boosts,
    },
  };
}

export type WorkoutCareerUpdate = {
  /** Local date key (yyyy-mm-dd) of the completed workout. */
  date: string;
  distanceMeters?: number;
};

/**
 * Records one completed workout on a Holobot's lifetime career: workouts
 * together, distance together, and distinct active days.
 */
export function applyWorkoutCareer<T extends UserHolobot>(holobot: T, update: WorkoutCareerUpdate): T {
  const career: HolobotCareer = holobot.career || {};
  const isNewActiveDay = Boolean(update.date) && career.lastWorkoutDate !== update.date;

  return {
    ...holobot,
    career: {
      activeDays: Math.max(0, Math.floor(career.activeDays || 0)) + (isNewActiveDay ? 1 : 0),
      distanceMeters:
        Math.max(0, Math.round(career.distanceMeters || 0)) +
        Math.max(0, Math.round(update.distanceMeters || 0)),
      firstWorkoutDate: career.firstWorkoutDate || update.date,
      lastWorkoutDate: update.date || career.lastWorkoutDate,
      workouts: Math.max(0, Math.floor(career.workouts || 0)) + 1,
    },
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
