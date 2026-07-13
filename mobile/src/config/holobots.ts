import { Image, type ImageSourcePropType } from "react-native";

import type { UserHolobot } from "@/types/profile";
import { resolveBundledAssetUri } from "@/config/gameAssets";
import {
  applyHolobotExperience,
  calculateExperience,
  getHolobotBattleStats,
  getHolobotRank,
  HOLOBOT_ARCHETYPES,
  HOLOBOT_BASE_STATS,
  HOLOBOT_NAMES,
  normalizeUserHolobot,
} from "@/lib/progression";

export {
  applyHolobotExperience,
  calculateExperience,
  getHolobotBattleStats,
  getHolobotRank,
  normalizeUserHolobot,
};

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

export type HolobotImageVariant = "headshot" | "full";

const HOLOBOT_HEADSHOT_IMAGE_MAP = {
  ACE: require("../../assets/holobots/headshots/ace.png"),
  KUMA: require("../../assets/holobots/headshots/kuma.png"),
  SHADOW: require("../../assets/holobots/headshots/shadow.png"),
  ERA: require("../../assets/holobots/headshots/era.png"),
  HARE: require("../../assets/holobots/headshots/hare.png"),
  TORA: require("../../assets/holobots/headshots/tora.png"),
  WAKE: require("../../assets/holobots/headshots/wake.png"),
  GAMA: require("../../assets/holobots/headshots/gama.png"),
  KEN: require("../../assets/holobots/headshots/ken.png"),
  KURAI: require("../../assets/holobots/headshots/kurai.png"),
  TSUIN: require("../../assets/holobots/headshots/tsuin.png"),
  WOLF: require("../../assets/holobots/headshots/wolf.png"),
} as const;

const HOLOBOT_FULL_IMAGE_MAP = {
  ACE: require("../../assets/holobots/full/ace.png"),
  KUMA: require("../../assets/holobots/full/kuma.png"),
  SHADOW: require("../../assets/holobots/full/shadow.png"),
  ERA: require("../../assets/holobots/full/era.png"),
  HARE: require("../../assets/holobots/full/hare.png"),
  TORA: require("../../assets/holobots/full/tora.png"),
  WAKE: require("../../assets/holobots/full/wake.png"),
  GAMA: require("../../assets/holobots/full/gama.png"),
  KEN: require("../../assets/holobots/full/ken.png"),
  KURAI: require("../../assets/holobots/full/kurai.png"),
  TSUIN: require("../../assets/holobots/full/tsuin.png"),
  WOLF: require("../../assets/holobots/full/wolf.png"),
} as const;

const DEFAULT_ROSTER_ORDER = HOLOBOT_NAMES;

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
  const finalSpecial = Math.floor(base.intelligence * levelBonus) + (boostedAttributes?.special || 0);

  // 0-100 display scale for the attribute chart. The old multipliers (x8,
  // x10, x12) pegged every leveled bot at the cap, so the pentagon rendered
  // solid red. Raw combat finals already land in a ~5-120 band (HP ~100-450),
  // so the finals ARE the chart values, with HP quartered onto the same
  // axis. Floor of 15 keeps a fresh bot's shape visible. NOTE: equipped
  // parts carry no stat values in the data model yet, so they cannot
  // contribute here until part stats become a real combat feature.
  return {
    attack: Math.min(100, Math.max(15, finalAttack)),
    defense: Math.min(100, Math.max(15, finalDefense)),
    hp: Math.min(100, Math.max(15, Math.round(finalHp / 4))),
    special: Math.min(100, Math.max(15, finalSpecial)),
    speed: Math.min(100, Math.max(15, finalSpeed)),
  };
}

function toHolobotKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function createGenesisStarterHolobot(name: "ACE" | "KUMA" | "SHADOW"): UserHolobot {
  return normalizeUserHolobot({
    attributePoints: 1,
    boostedAttributes: {},
    experience: 0,
    level: 1,
    name,
    nextLevelExp: calculateExperience(2),
    rank: getHolobotRank(1),
  });
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

function getHolobotImageAsset(name: string, variant: HolobotImageVariant = "headshot") {
  const imageMap = variant === "full" ? HOLOBOT_FULL_IMAGE_MAP : HOLOBOT_HEADSHOT_IMAGE_MAP;
  return imageMap[name.trim().toUpperCase() as keyof typeof imageMap] ?? imageMap.ACE;
}

export function getHolobotImageSource(name: string, variant: HolobotImageVariant = "headshot") {
  const asset = getHolobotImageAsset(name, variant);
  return Image.resolveAssetSource(asset) ?? asset;
}

export function getHolobotHeadshotImageSource(name: string) {
  return getHolobotImageSource(name, "headshot");
}

export function getHolobotFullImageSource(name: string) {
  return getHolobotImageSource(name, "full");
}

export function getHolobotImageHref(name: string, variant: HolobotImageVariant = "headshot") {
  return resolveBundledAssetUri(getHolobotImageAsset(name, variant));
}

export function getHolobotHeadshotImageHref(name: string) {
  return getHolobotImageHref(name, "headshot");
}

export function getHolobotFullImageHref(name: string) {
  return getHolobotImageHref(name, "full");
}

export function createFallbackRoster(variant: HolobotImageVariant = "headshot"): HolobotRosterEntry[] {
  return DEFAULT_ROSTER_ORDER.map((name) => ({
    attributePoints: 1,
    boostedAttributes: {},
    experience: 0,
    imageSource: getHolobotImageSource(name, variant),
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

export function mergeHolobotRoster(userHolobots?: UserHolobot[], variant: HolobotImageVariant = "headshot") {
  if (!userHolobots?.length) {
    return createFallbackRoster(variant);
  }

  const normalizedUserHolobots = userHolobots.map((rawHolobot) => {
    const holobot = normalizeUserHolobot(rawHolobot);
    return {
      attributePoints: holobot.attributePoints || 0,
      boostedAttributes: holobot.boostedAttributes || {},
      experience: holobot.experience || 0,
      imageSource: getHolobotImageSource(holobot.name, variant),
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
    imageSource: getHolobotImageSource(name, variant),
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

export function getExpProgress(holobot: Pick<HolobotRosterEntry, "experience" | "nextLevelExp">) {
  if (!holobot.nextLevelExp) {
    return 0;
  }

  return Math.max(0, Math.min(1, holobot.experience / holobot.nextLevelExp));
}
