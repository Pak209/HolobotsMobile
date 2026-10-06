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

// ---- Battle stats (mirror of mobile/src/lib/progression.ts getHolobotBattleStats) ----

export const HOLOBOT_BASE_STATS = {
  ACE: { attack: 8, defense: 6, hp: 150, intelligence: 5, speed: 7 },
  KUMA: { attack: 7, defense: 5, hp: 200, intelligence: 4, speed: 3 },
  SHADOW: { attack: 5, defense: 7, hp: 170, intelligence: 3, speed: 4 },
  ERA: { attack: 5, defense: 4, hp: 165, intelligence: 4, speed: 6 },
  HARE: { attack: 4, defense: 5, hp: 160, intelligence: 3, speed: 4 },
  TORA: { attack: 5, defense: 4, hp: 180, intelligence: 4, speed: 6 },
  WAKE: { attack: 6, defense: 3, hp: 170, intelligence: 4, speed: 4 },
  GAMA: { attack: 6, defense: 5, hp: 180, intelligence: 4, speed: 3 },
  KEN: { attack: 7, defense: 3, hp: 150, intelligence: 5, speed: 6 },
  KURAI: { attack: 4, defense: 6, hp: 190, intelligence: 3, speed: 3 },
  TSUIN: { attack: 6, defense: 4, hp: 160, intelligence: 4, speed: 5 },
  WOLF: { attack: 5, defense: 5, hp: 175, intelligence: 4, speed: 5 },
} as const;

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

export type BoostedAttributes = {
  attack?: number;
  defense?: number;
  health?: number;
  special?: number;
  speed?: number;
};

export type HolobotBattleStats = {
  archetype: string;
  attack: number;
  defense: number;
  intelligence: number;
  maxHP: number;
  speed: number;
};

function boostValue(boosted: unknown, key: keyof BoostedAttributes): number {
  if (!boosted || typeof boosted !== "object") return 0;
  return Number((boosted as Record<string, unknown>)[key] || 0) || 0;
}

/** Level-scaled base stats + flat attribute boosts (no sync modifiers, no parts). */
export function getHolobotBattleStats(name: string, level = 1, boostedAttributes?: unknown): HolobotBattleStats {
  const normalizedName = String(name || "").trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const base = HOLOBOT_BASE_STATS[normalizedName] ?? HOLOBOT_BASE_STATS.ACE;
  const archetype = HOLOBOT_ARCHETYPES[normalizedName] ?? HOLOBOT_ARCHETYPES.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  return {
    archetype,
    attack: Math.floor(base.attack * 10 * levelBonus) + boostValue(boostedAttributes, "attack"),
    defense: Math.floor(base.defense * 10 * levelBonus) + boostValue(boostedAttributes, "defense"),
    intelligence: Math.floor(base.intelligence * 10 * levelBonus) + boostValue(boostedAttributes, "special"),
    maxHP: Math.floor(base.hp * levelBonus) + boostValue(boostedAttributes, "health"),
    speed: Math.floor(base.speed * 10 * levelBonus) + boostValue(boostedAttributes, "speed"),
  };
}

// ---- Attribute boosts (DECISIONS #53-2; mirror of mobile applyAttributeBoost) ----

/** Points buy attack / defense / speed / HP. SPECIAL is tied to SYNC (focus) and is not boostable. */
export const BOOSTABLE_ATTRIBUTES = ["attack", "defense", "speed", "health"] as const;
export type BoostableAttribute = (typeof BOOSTABLE_ATTRIBUTES)[number];
export const ATTRIBUTE_BOOST_AMOUNTS: Record<BoostableAttribute, number> = {
  attack: 1,
  defense: 1,
  health: 10,
  speed: 1,
};
export type AttributeBoostRefusal = "attribute_not_boostable" | "no_attribute_points";
export type AttributeBoostResult =
  | { applied: true; holobot: ServerHolobot }
  | { applied: false; holobot: ServerHolobot; reason: AttributeBoostRefusal };

export function isBoostableAttribute(value: unknown): value is BoostableAttribute {
  return typeof value === "string" && (BOOSTABLE_ATTRIBUTES as readonly string[]).includes(value);
}

/** Spend one attribute point (the mobile InventoryScreen math). Pure; refusals change nothing. */
export function applyAttributeBoost(rawHolobot: unknown, attribute: unknown): AttributeBoostResult {
  const normalized = normalizeUserHolobot(rawHolobot);
  if (!isBoostableAttribute(attribute)) {
    return { applied: false, holobot: normalized, reason: "attribute_not_boostable" };
  }

  const points = Number(normalized.attributePoints || 0);
  if (!(points > 0)) {
    return { applied: false, holobot: normalized, reason: "no_attribute_points" };
  }

  const rawBoosts = normalized.boostedAttributes;
  const boosts: Record<string, unknown> =
    rawBoosts && typeof rawBoosts === "object" && !Array.isArray(rawBoosts)
      ? { ...(rawBoosts as Record<string, unknown>) }
      : {};
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
