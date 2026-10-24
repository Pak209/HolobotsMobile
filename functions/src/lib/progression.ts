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

/**
 * The mobile Holobot rank table (getHolobotRank's boundaries) as data: every promotion boundary.
 * DECISIONS #58 (3): a Repair Kit at every promotion, Rookie -> Starter included (lib/rankHealingReward.ts).
 */
export const HOLOBOT_RANK_TIERS = [
  { rank: "Rookie", startLevel: 1 },
  { rank: "Starter", startLevel: 2 },
  { rank: "Champion", startLevel: 11 },
  { rank: "Rare", startLevel: 21 },
  { rank: "Elite", startLevel: 31 },
  { rank: "Legendary", startLevel: 41 },
] as const;

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

/**
 * DECISIONS #72.78 item 7 + #72.81 (lane rules5-progression-gate-1): the #72.78 progression changes (base SPEED 4-6,
 * SPECIAL points-buyable +1, HP +3 per new point) ship TOGETHER with duel-rules-5, behind its host flag
 * (HOLOCITY_FIGHT_ATTRS, fightReplayContract FIGHT_ATTRS_FLAG). Flag off (default) = the pre-#72.78 outputs byte for
 * byte; read at call time so a deploy without the flag changes nothing. Mirror: mobile/src/lib/progression.ts reads
 * EXPO_PUBLIC_HOLOCITY_FIGHT_ATTRS.
 */
export const PROGRESSION_RULES5_FLAG = "HOLOCITY_FIGHT_ATTRS" as const;
export function progressionRules5Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[PROGRESSION_RULES5_FLAG] === "1";
}

/** The live base-stat table with the rules-5 flag OFF: the pre-#72.78 rows (base SPEED 3-7). */
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

/**
 * DECISIONS #72.78 (2): the rules-5 table — base SPEED narrowed from 3-7 to 4-6 (3->4, 4->4, 5->5, 6->6, 7->6); every
 * other column equals HOLOBOT_BASE_STATS. Live only with the rules-5 flag on (getHolobotBaseStatsTable). #72.81: the
 * #72.80 balanced rows (fightBalance.ts) are promoted here when rules-5 ships — a separate change.
 */
export const HOLOBOT_BASE_STATS_RULES5 = {
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
} as const satisfies Record<keyof typeof HOLOBOT_BASE_STATS, unknown>;

/** The base-stat table progression reads now: HOLOBOT_BASE_STATS_RULES5 with the rules-5 flag on, else HOLOBOT_BASE_STATS. */
export function getHolobotBaseStatsTable(
  env: Record<string, string | undefined> = process.env,
): Record<keyof typeof HOLOBOT_BASE_STATS, { attack: number; defense: number; hp: number; intelligence: number; speed: number }> {
  return progressionRules5Enabled(env) ? HOLOBOT_BASE_STATS_RULES5 : HOLOBOT_BASE_STATS;
}

/**
 * The pre-#72.78 SPEED column (= HOLOBOT_BASE_STATS speed), frozen for provenance and for any consumer that must
 * reproduce a pre-#72.78 output whatever the flag. Read by getLegacyBattleSpeed (quest / training power score, a frozen
 * economy surface). The legacy duel resolver and battlefield-movement-1 take speed as an input (movement normalises by
 * the bot's own LV 1 stat) and read the flag-selected table. Never edit.
 */
export const LEGACY_BASE_SPEED_PRE_72_78 = {
  ACE: 7, KUMA: 3, SHADOW: 4, ERA: 6, HARE: 4, TORA: 6, WAKE: 4, GAMA: 3, KEN: 6, KURAI: 3, TSUIN: 5, WOLF: 5,
} as const;

/** The pre-#72.78 battle-scale speed: getHolobotBattleStats(...).speed computed on LEGACY_BASE_SPEED_PRE_72_78. */
export function getLegacyBattleSpeed(name: string, level = 1, boostedAttributes?: unknown): number {
  const normalizedName = String(name || "").trim().toUpperCase() as keyof typeof LEGACY_BASE_SPEED_PRE_72_78;
  const base = LEGACY_BASE_SPEED_PRE_72_78[normalizedName] ?? LEGACY_BASE_SPEED_PRE_72_78.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;
  return Math.floor(base * 10 * levelBonus) + boostValue(boostedAttributes, "speed");
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
  const table = getHolobotBaseStatsTable();
  const base = table[normalizedName] ?? table.ACE;
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

/** The mobile DISPLAY scale: no x10 on attack / defense / speed / special; HP as in battle. */
export type HolobotDisplayStats = {
  attack: number;
  defense: number;
  hp: number;
  special: number;
  speed: number;
};

/**
 * Mirror of mobile/src/lib/progression.ts getHolobotDisplayStats (DECISIONS #53 amendment 2):
 * floor(base x levelBonus) + flat boost. The HoloCity STATS page shows these numbers
 * (desktop-account-3 displayStats); battles use getHolobotBattleStats.
 */
export function getHolobotDisplayStats(name: string, level = 1, boostedAttributes?: unknown): HolobotDisplayStats {
  const normalizedName = String(name || "").trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const table = getHolobotBaseStatsTable();
  const base = table[normalizedName] ?? table.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  return {
    attack: Math.floor(base.attack * levelBonus) + boostValue(boostedAttributes, "attack"),
    defense: Math.floor(base.defense * levelBonus) + boostValue(boostedAttributes, "defense"),
    hp: Math.floor(base.hp * levelBonus) + boostValue(boostedAttributes, "health"),
    special: Math.floor(base.intelligence * levelBonus) + boostValue(boostedAttributes, "special"),
    speed: Math.floor(base.speed * levelBonus) + boostValue(boostedAttributes, "speed"),
  };
}

// ---- Attribute boosts (DECISIONS #53-2; mirror of mobile applyAttributeBoost) ----

/**
 * DECISIONS #53-2: points buy attack / defense / speed (+1 each) or HP (+10); SPECIAL is tied to SYNC and refused.
 * DECISIONS #72.78 (4)+(5), live only with the rules-5 flag on (progressionRules5Enabled): SPECIAL becomes
 * points-buyable (+1, stored as boostedAttributes.special, which battle stats already read as intelligence) and a NEW
 * HP point grants +3. boostedAttributes.health stores HP units (the running sum), not a point count, so HP already
 * allocated at +10/point keeps its value by construction when the flag flips — nothing converts it back to points.
 */
export const BOOSTABLE_ATTRIBUTES = ["attack", "defense", "speed", "health"] as const;
export const BOOSTABLE_ATTRIBUTES_RULES5 = ["attack", "defense", "speed", "health", "special"] as const;
export type BoostableAttribute = (typeof BOOSTABLE_ATTRIBUTES_RULES5)[number];
export const ATTRIBUTE_BOOST_AMOUNTS: Readonly<Record<(typeof BOOSTABLE_ATTRIBUTES)[number], number>> = {
  attack: 1,
  defense: 1,
  health: 10,
  speed: 1,
};
export const ATTRIBUTE_BOOST_AMOUNTS_RULES5: Readonly<Record<BoostableAttribute, number>> = {
  attack: 1,
  defense: 1,
  health: 3,
  special: 1,
  speed: 1,
};
/** The boostable set live now (flag-selected). */
export function getBoostableAttributes(env: Record<string, string | undefined> = process.env): readonly BoostableAttribute[] {
  return progressionRules5Enabled(env) ? BOOSTABLE_ATTRIBUTES_RULES5 : BOOSTABLE_ATTRIBUTES;
}
/** The per-point grant table live now (flag-selected). */
export function getAttributeBoostAmounts(env: Record<string, string | undefined> = process.env): Readonly<Partial<Record<BoostableAttribute, number>>> {
  return progressionRules5Enabled(env) ? ATTRIBUTE_BOOST_AMOUNTS_RULES5 : ATTRIBUTE_BOOST_AMOUNTS;
}
export type AttributeBoostRefusal = "attribute_not_boostable" | "no_attribute_points";
export type AttributeBoostResult =
  | { applied: true; holobot: ServerHolobot }
  | { applied: false; holobot: ServerHolobot; reason: AttributeBoostRefusal };

export function isBoostableAttribute(value: unknown): value is BoostableAttribute {
  return typeof value === "string" && (getBoostableAttributes() as readonly string[]).includes(value);
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
  boosts[attribute] = (Number(boosts[attribute]) || 0) + (getAttributeBoostAmounts()[attribute] ?? 0);

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
