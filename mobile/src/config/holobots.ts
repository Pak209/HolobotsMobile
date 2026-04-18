import { Image, type ImageSourcePropType } from "react-native";

import type { UserHolobot } from "@/types/profile";
import { resolveBundledAssetUri } from "@/config/gameAssets";

export type HolobotRosterEntry = {
  attributePoints?: number;
  boostedAttributes?: UserHolobot["boostedAttributes"];
  experience: number;
  imageSource: ImageSourcePropType;
  key: string;
  level: number;
  name: string;
  nextLevelExp: number;
  owned: boolean;
  rank?: string;
  specialMove?: string;
  stats: {
    attack: number;
    defense: number;
    hp: number;
    special: number;
    speed: number;
  };
};

const HOLBOT_IMAGE_MAP = {
  ACE: require("../../assets/holobots/ace.png"),
  KUMA: require("../../assets/holobots/kuma.png"),
  SHADOW: require("../../assets/holobots/shadow.png"),
  ERA: require("../../assets/holobots/era.png"),
  HARE: require("../../assets/holobots/hare.png"),
  TORA: require("../../assets/holobots/tora.png"),
  WAKE: require("../../assets/holobots/wake.png"),
  GAMA: require("../../assets/holobots/gama.png"),
  KEN: require("../../assets/holobots/ken.png"),
  KURAI: require("../../assets/holobots/kurai.png"),
  TSUIN: require("../../assets/holobots/tsuin.png"),
  WOLF: require("../../assets/holobots/wolf.png"),
} as const;

const DEFAULT_ROSTER_ORDER = [
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

const HOLOBOT_BASE_STATS = {
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

const HOLOBOT_SPECIAL_MOVES = {
  ACE: "1st Strike",
  KUMA: "Sharp Claws",
  SHADOW: "Shadow Strike",
  ERA: "Time Warp",
  HARE: "Counter Claw",
  TORA: "Stalk",
  WAKE: "Torrent",
  GAMA: "Heavy Leap",
  KEN: "Blade Storm",
  KURAI: "Dark Veil",
  TSUIN: "Twin Strike",
  WOLF: "Lunar Howl",
} as const;

const HOLOBOT_ARCHETYPES = {
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

function getNormalizedStatsForChart(
  name: string,
  level = 1,
  boostedAttributes?: UserHolobot["boostedAttributes"],
) {
  const base =
    HOLOBOT_BASE_STATS[name.trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS] ??
    HOLOBOT_BASE_STATS.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  const finalAttack = Math.floor(base.attack * levelBonus) + (boostedAttributes?.attack || 0);
  const finalDefense = Math.floor(base.defense * levelBonus) + (boostedAttributes?.defense || 0);
  const finalSpeed = Math.floor(base.speed * levelBonus) + (boostedAttributes?.speed || 0);
  const finalHp = Math.floor(base.hp * levelBonus) + (boostedAttributes?.health || 0);
  const finalSpecial = Math.floor(base.intelligence * levelBonus);

  return {
    attack: Math.min(100, Math.max(25, finalAttack * 8)),
    defense: Math.min(100, Math.max(25, finalDefense * 8)),
    hp: Math.min(100, Math.max(25, finalHp / 2)),
    special: Math.min(100, Math.max(25, finalSpecial * 12)),
    speed: Math.min(100, Math.max(25, finalSpeed * 10)),
  };
}

function toHolobotKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
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

export function getHolobotBaseProfile(name: string) {
  const normalizedName = name.trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const base = HOLOBOT_BASE_STATS[normalizedName] ?? HOLOBOT_BASE_STATS.ACE;
  const specialMove = HOLOBOT_SPECIAL_MOVES[normalizedName] ?? HOLOBOT_SPECIAL_MOVES.ACE;

  return {
    attack: base.attack,
    defense: base.defense,
    hp: base.hp,
    intelligence: base.intelligence,
    specialMove,
    speed: base.speed,
  };
}

export function normalizeUserHolobot(holobot: UserHolobot): UserHolobot {
  const level = Math.max(1, holobot.level || 1);
  return {
    ...holobot,
    attributePoints: holobot.attributePoints ?? level,
    boostedAttributes: holobot.boostedAttributes || {},
    experience: holobot.experience || 0,
    nextLevelExp: holobot.nextLevelExp || calculateExperience(level + 1),
    rank: holobot.rank || getHolobotRank(level),
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

export function getHolobotImageSource(name: string) {
  const asset =
    HOLBOT_IMAGE_MAP[name.trim().toUpperCase() as keyof typeof HOLBOT_IMAGE_MAP] ??
    HOLBOT_IMAGE_MAP.ACE;

  return Image.resolveAssetSource(asset) ?? asset;
}

export function getHolobotImageHref(name: string) {
  const asset =
    HOLBOT_IMAGE_MAP[name.trim().toUpperCase() as keyof typeof HOLBOT_IMAGE_MAP] ??
    HOLBOT_IMAGE_MAP.ACE;

  return resolveBundledAssetUri(asset);
}

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
  const intelligence = Math.floor(base.intelligence * 10 * levelBonus);

  return {
    archetype,
    attack,
    defense,
    intelligence,
    maxHP,
    speed,
  };
}

export function createFallbackRoster(): HolobotRosterEntry[] {
  return DEFAULT_ROSTER_ORDER.map((name) => ({
    attributePoints: 1,
    boostedAttributes: {},
    experience: 0,
    imageSource: getHolobotImageSource(name),
    key: toHolobotKey(name),
    level: 1,
    name,
    nextLevelExp: 100,
    owned: false,
    rank: getHolobotRank(1),
    specialMove: getHolobotBaseProfile(name).specialMove,
    stats: getNormalizedStatsForChart(name),
  }));
}

export function mergeHolobotRoster(userHolobots?: UserHolobot[]) {
  if (!userHolobots?.length) {
    return createFallbackRoster();
  }

  const normalizedUserHolobots = userHolobots.map((rawHolobot) => {
    const holobot = normalizeUserHolobot(rawHolobot);
    return {
      attributePoints: holobot.attributePoints || 0,
      boostedAttributes: holobot.boostedAttributes || {},
      experience: holobot.experience || 0,
      imageSource: getHolobotImageSource(holobot.name),
      key: toHolobotKey(holobot.name),
      level: holobot.level || 1,
      name: holobot.name.toUpperCase(),
      nextLevelExp: holobot.nextLevelExp || 100,
      owned: true,
      rank: holobot.rank || getHolobotRank(holobot.level || 1),
      specialMove: getHolobotBaseProfile(holobot.name).specialMove,
      stats: getNormalizedStatsForChart(
        holobot.name,
        holobot.level || 1,
        holobot.boostedAttributes,
      ),
    };
  });

  const ownedNames = new Set(normalizedUserHolobots.map((holobot) => holobot.name));
  const missingDefaults = DEFAULT_ROSTER_ORDER.filter((name) => !ownedNames.has(name)).map((name) => ({
    attributePoints: 1,
    boostedAttributes: {},
    experience: 0,
    imageSource: getHolobotImageSource(name),
    key: toHolobotKey(name),
    level: 1,
    name,
    nextLevelExp: 100,
    owned: false,
    rank: getHolobotRank(1),
    specialMove: getHolobotBaseProfile(name).specialMove,
    stats: getNormalizedStatsForChart(name),
  }));

  return [...normalizedUserHolobots, ...missingDefaults];
}

export function getExpProgress(holobot: Pick<HolobotRosterEntry, "experience" | "nextLevelExp">) {
  if (!holobot.nextLevelExp) {
    return 0;
  }

  return Math.max(0, Math.min(1, holobot.experience / holobot.nextLevelExp));
}
