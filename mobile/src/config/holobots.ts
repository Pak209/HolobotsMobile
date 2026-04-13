import type { UserHolobot } from "@/types/profile";

export type HolobotRosterEntry = {
  experience: number;
  imageUrl: string;
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

const HOLOBOTS_CDN_BASE = "https://holobots.fun";

const HOLBOT_IMAGE_MAP = {
  ACE: `${HOLOBOTS_CDN_BASE}/lovable-uploads/7223a5e5-abcb-4911-8436-bddbbd851ae2.png`,
  KUMA: `${HOLOBOTS_CDN_BASE}/lovable-uploads/78f2c37a-43a3-4cce-a767-bc3f614e7a80.png`,
  SHADOW: `${HOLOBOTS_CDN_BASE}/lovable-uploads/ef60f626-b571-46ba-9d37-6045b020669a.png`,
  ERA: `${HOLOBOTS_CDN_BASE}/lovable-uploads/c2cd6b0a-0e49-4ede-9507-e55d05aa608d.png`,
  HARE: `${HOLOBOTS_CDN_BASE}/lovable-uploads/4ad952b3-4337-4120-9542-ed14ca1051d5.png`,
  TORA: `${HOLOBOTS_CDN_BASE}/lovable-uploads/e79a5ab6-4577-4e0e-a2b9-32cafd91a212.png`,
  WAKE: `${HOLOBOTS_CDN_BASE}/lovable-uploads/e8128616-6ab5-4995-91b8-2989d18a0508.png`,
  GAMA: `${HOLOBOTS_CDN_BASE}/lovable-uploads/4af336bd-2825-4faf-9b2c-58cc86354b14.png`,
  KEN: `${HOLOBOTS_CDN_BASE}/lovable-uploads/58e4110e-07f8-44ab-983e-b6caa5098cc3.png`,
  KURAI: `${HOLOBOTS_CDN_BASE}/lovable-uploads/a2ce9d10-b01e-4b86-b52b-74f196b39a6c.png`,
  TSUIN: `${HOLOBOTS_CDN_BASE}/lovable-uploads/e6982da0-9c53-4d62-a2b8-7ede52d89ca7.png`,
  WOLF: `${HOLOBOTS_CDN_BASE}/lovable-uploads/46001c5e-b6c6-4c4d-8006-5926b85c13d9.png`,
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

export function getHolobotImageUrl(name: string) {
  return HOLBOT_IMAGE_MAP[name.trim().toUpperCase() as keyof typeof HOLBOT_IMAGE_MAP] ?? "";
}

export function createFallbackRoster(): HolobotRosterEntry[] {
  return DEFAULT_ROSTER_ORDER.map((name) => ({
    experience: 0,
    imageUrl: getHolobotImageUrl(name),
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
    imageUrl: getHolobotImageUrl(holobot.name),
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
    imageUrl: getHolobotImageUrl(name),
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
