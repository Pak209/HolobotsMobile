import { Image, type ImageSourcePropType } from "react-native";

import type { UserHolobot } from "@/types/profile";
import { resolveBundledAssetUri } from "@/config/gameAssets";

export type HolobotRosterEntry = {
  experience: number;
  imageSource: ImageSourcePropType;
  key: string;
  level: number;
  name: string;
  nextLevelExp: number;
  owned: boolean;
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
    experience: 0,
    imageSource: getHolobotImageSource(name),
    key: toHolobotKey(name),
    level: 1,
    name,
    nextLevelExp: 100,
    owned: false,
    stats: getNormalizedStatsForChart(name),
  }));
}

export function mergeHolobotRoster(userHolobots?: UserHolobot[]) {
  if (!userHolobots?.length) {
    return createFallbackRoster();
  }

  const normalizedUserHolobots = userHolobots.map((holobot) => ({
    experience: holobot.experience || 0,
    imageSource: getHolobotImageSource(holobot.name),
    key: toHolobotKey(holobot.name),
    level: holobot.level || 1,
    name: holobot.name.toUpperCase(),
    nextLevelExp: holobot.nextLevelExp || 100,
    owned: true,
    stats: getNormalizedStatsForChart(
      holobot.name,
      holobot.level || 1,
      holobot.boostedAttributes,
    ),
  }));

  const ownedNames = new Set(normalizedUserHolobots.map((holobot) => holobot.name));
  const missingDefaults = DEFAULT_ROSTER_ORDER.filter((name) => !ownedNames.has(name)).map((name) => ({
    experience: 0,
    imageSource: getHolobotImageSource(name),
    key: toHolobotKey(name),
    level: 1,
    name,
    nextLevelExp: 100,
    owned: false,
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
