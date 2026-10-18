/**
 * Server-side blueprint minting / rank upgrades. Mirror of
 * `mobile/src/lib/minting.ts`; `mintingServerParity.test.ts` enforces the
 * match. blueprints/holobots use the same field names on both sides.
 * Pure module: no firebase imports, safe to import from tests.
 */

import { calculateExperience, getHolobotRank, normalizeUserHolobot, type ServerHolobot } from "./progression";

export const BLUEPRINT_TIERS = [
  { attributePoints: 10, key: "common", label: "Common", required: 5, startLevel: 1 },
  { attributePoints: 10, key: "champion", label: "Champion", required: 10, startLevel: 11 },
  { attributePoints: 20, key: "rare", label: "Rare", required: 20, startLevel: 21 },
  { attributePoints: 30, key: "elite", label: "Elite", required: 40, startLevel: 31 },
  { attributePoints: 40, key: "legendary", label: "Legendary", required: 80, startLevel: 41 },
] as const;

export function getTierByLabel(label: string) {
  return BLUEPRINT_TIERS.find((tier) => tier.label === label);
}

export function toHolobotKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function upperName(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export type MintRefusalReason = "already-owned" | "insufficient-blueprints" | "unknown-tier";
export type RankUpgradeRefusalReason =
  | "insufficient-blueprints"
  | "not-owned"
  | "tier-already-reached"
  | "unknown-tier";

type BuilderSuccess = {
  tierStartLevel: number;
  updates: { blueprints: Record<string, number>; holobots: unknown[] };
};

export function isRefusal<R extends string>(
  result: BuilderSuccess | { reason: R },
): result is { reason: R } {
  return (result as { reason?: R }).reason !== undefined;
}

export function buildMintUpdates(
  userData: Record<string, unknown>,
  holobotName: string,
  tierLabel: string,
): BuilderSuccess | { reason: MintRefusalReason } {
  const tier = getTierByLabel(tierLabel);
  if (!tier) {
    return { reason: "unknown-tier" };
  }

  const key = toHolobotKey(holobotName);
  const blueprints = (userData.blueprints as Record<string, number>) || {};
  const currentBlueprints = Number(blueprints[key] || 0);
  if (currentBlueprints < tier.required) {
    return { reason: "insufficient-blueprints" };
  }

  const holobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const alreadyOwned = holobots.some(
    (holobot) => upperName((holobot as { name?: unknown })?.name) === upperName(holobotName),
  );
  if (alreadyOwned) {
    return { reason: "already-owned" };
  }

  const nextHolobot: ServerHolobot = {
    attributePoints: tier.attributePoints,
    boostedAttributes: {},
    experience: 0,
    level: tier.startLevel,
    name: holobotName,
    nextLevelExp: calculateExperience(tier.startLevel + 1),
    rank: getHolobotRank(tier.startLevel),
  };

  return {
    tierStartLevel: tier.startLevel,
    updates: {
      blueprints: { ...blueprints, [key]: currentBlueprints - tier.required },
      holobots: [...holobots, nextHolobot],
    },
  };
}

export function buildRankUpgradeUpdates(
  userData: Record<string, unknown>,
  holobotName: string,
  tierLabel: string,
): BuilderSuccess | { reason: RankUpgradeRefusalReason } {
  const tier = getTierByLabel(tierLabel);
  if (!tier) {
    return { reason: "unknown-tier" };
  }

  const key = toHolobotKey(holobotName);
  const blueprints = (userData.blueprints as Record<string, number>) || {};
  const currentBlueprints = Number(blueprints[key] || 0);
  if (currentBlueprints < tier.required) {
    return { reason: "insufficient-blueprints" };
  }

  const holobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const target = holobots.find(
    (holobot) => upperName((holobot as { name?: unknown })?.name) === upperName(holobotName),
  ) as Record<string, unknown> | undefined;
  if (!target) {
    return { reason: "not-owned" };
  }

  if (tier.startLevel <= Number(target.level || 1)) {
    return { reason: "tier-already-reached" };
  }

  const normalizedTarget = normalizeUserHolobot(target);
  const updatedHolobots = holobots.map((holobot) => {
    if (upperName((holobot as { name?: unknown })?.name) !== upperName(normalizedTarget.name)) {
      return holobot;
    }

    return {
      ...normalizedTarget,
      attributePoints: Number(normalizedTarget.attributePoints || 0) + tier.attributePoints,
      // Mobile normalizeUserHolobot guarantees this field; mirror it.
      boostedAttributes:
        (normalizedTarget.boostedAttributes as Record<string, unknown> | undefined) || {},
      experience: 0,
      level: tier.startLevel,
      nextLevelExp: calculateExperience(tier.startLevel + 1),
      rank: getHolobotRank(tier.startLevel),
    };
  });

  return {
    tierStartLevel: tier.startLevel,
    updates: {
      blueprints: { ...blueprints, [key]: currentBlueprints - tier.required },
      holobots: updatedHolobots,
    },
  };
}

export type LegendaryAscensionResult =
  | { outcome: "minted" | "ascended"; updates: Record<string, unknown> }
  | { outcome: "converted"; updates: Record<string, unknown>; wildcards: number }
  | { outcome: "refused"; reason: "no_item" };

/** Converted-duplicate payout when the chosen bot is already Legendary. */
export const LEGENDARY_DUPLICATE_WILDCARDS = 80;

/**
 * The Legendary Blueprint (0.1% gacha easter egg): consumes one
 * `legendaryBlueprints` item and takes the CHOSEN bot straight to
 * Legendary through the same semantics as the existing direct paths —
 * unowned mints at the Legendary tier (Lv 41, +40 AP, exactly like an
 * 80-blueprint direct mint), owned-below-Legendary jumps like a single
 * Legendary rank-up, and an already-Legendary pick converts to wildcards
 * (mirroring the Genesis duplicate rule).
 */
export function buildLegendaryAscensionRaw(
  userData: Record<string, unknown>,
  holobotName: string,
): LegendaryAscensionResult {
  const balance = Number(userData.legendaryBlueprints || 0);
  if (balance < 1) {
    return { outcome: "refused", reason: "no_item" };
  }

  const tier = getTierByLabel("Legendary")!;
  const holobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const target = holobots.find(
    (holobot) => upperName((holobot as { name?: unknown })?.name) === upperName(holobotName),
  ) as Record<string, unknown> | undefined;

  if (!target) {
    const nextHolobot: ServerHolobot = {
      attributePoints: tier.attributePoints,
      boostedAttributes: {},
      experience: 0,
      level: tier.startLevel,
      name: holobotName,
      nextLevelExp: calculateExperience(tier.startLevel + 1),
      rank: getHolobotRank(tier.startLevel),
    };
    return {
      outcome: "minted",
      updates: {
        holobots: [...holobots, nextHolobot],
        legendaryBlueprints: balance - 1,
      },
    };
  }

  if (tier.startLevel <= Number(target.level || 1)) {
    return {
      outcome: "converted",
      wildcards: LEGENDARY_DUPLICATE_WILDCARDS,
      updates: {
        legendaryBlueprints: balance - 1,
        wildcardBlueprints: Number(userData.wildcardBlueprints || 0) + LEGENDARY_DUPLICATE_WILDCARDS,
      },
    };
  }

  const normalizedTarget = normalizeUserHolobot(target);
  const updatedHolobots = holobots.map((holobot) => {
    if (upperName((holobot as { name?: unknown })?.name) !== upperName(normalizedTarget.name)) {
      return holobot;
    }
    return {
      ...normalizedTarget,
      attributePoints: Number(normalizedTarget.attributePoints || 0) + tier.attributePoints,
      boostedAttributes:
        (normalizedTarget.boostedAttributes as Record<string, unknown> | undefined) || {},
      experience: 0,
      level: tier.startLevel,
      nextLevelExp: calculateExperience(tier.startLevel + 1),
      rank: getHolobotRank(tier.startLevel),
    };
  });

  return {
    outcome: "ascended",
    updates: {
      holobots: updatedHolobots,
      legendaryBlueprints: balance - 1,
    },
  };
}

export type RankSkipResult =
  | { refusal: "no_item" | "not_owned" | "already_legendary" }
  | { refusal: null; nextTierLabel: string; updates: Record<string, unknown> };

/**
 * Rank Skip (marketplace item, 5000 Holos): consumes one rankSkips and
 * jumps the chosen bot to the NEXT tier with the exact rank-up semantics —
 * minus the blueprint cost. That is the item's whole value proposition:
 * one tier of the blueprint grind, bought.
 */
export function buildRankSkipRaw(
  userData: Record<string, unknown>,
  holobotName: string,
): RankSkipResult {
  const balance = Number(userData.rankSkips || 0);
  if (balance < 1) {
    return { refusal: "no_item" };
  }

  const holobots: unknown[] = Array.isArray(userData.holobots) ? userData.holobots : [];
  const target = holobots.find(
    (holobot) => upperName((holobot as { name?: unknown })?.name) === upperName(holobotName),
  ) as Record<string, unknown> | undefined;
  if (!target) {
    return { refusal: "not_owned" };
  }

  // The next tier is the first whose start level exceeds the bot's current
  // level — identical gating to buildRankUpgradeUpdates.
  const level = Number(target.level || 1);
  const nextTier = BLUEPRINT_TIERS.find((tier) => tier.startLevel > level);
  if (!nextTier) {
    return { refusal: "already_legendary" };
  }

  const normalizedTarget = normalizeUserHolobot(target);
  const updatedHolobots = holobots.map((holobot) => {
    if (upperName((holobot as { name?: unknown })?.name) !== upperName(normalizedTarget.name)) {
      return holobot;
    }
    return {
      ...normalizedTarget,
      attributePoints: Number(normalizedTarget.attributePoints || 0) + nextTier.attributePoints,
      boostedAttributes:
        (normalizedTarget.boostedAttributes as Record<string, unknown> | undefined) || {},
      experience: 0,
      level: nextTier.startLevel,
      nextLevelExp: calculateExperience(nextTier.startLevel + 1),
      rank: getHolobotRank(nextTier.startLevel),
    };
  });

  return {
    refusal: null,
    nextTierLabel: nextTier.label,
    updates: {
      holobots: updatedHolobots,
      rankSkips: balance - 1,
    },
  };
}

/** EXP Booster: 24 hours of doubled arena EXP from activation. */
export const EXP_BOOSTER_DURATION_MS = 24 * 60 * 60 * 1000;

export type ExpBoosterResult =
  | { refusal: "no_item" | "already_active" }
  | { refusal: null; activeUntil: number; updates: Record<string, unknown> };

export function buildExpBoosterActivationRaw(
  userData: Record<string, unknown>,
  now: number = Date.now(),
): ExpBoosterResult {
  const balance = Number(userData.expBoosters || 0);
  if (balance < 1) {
    return { refusal: "no_item" };
  }
  if (Number(userData.expBoosterActiveUntil || 0) > now) {
    return { refusal: "already_active" };
  }

  const activeUntil = now + EXP_BOOSTER_DURATION_MS;
  return {
    refusal: null,
    activeUntil,
    updates: {
      expBoosters: balance - 1,
      expBoosterActiveUntil: activeUntil,
    },
  };
}

/** Raw-field energy refill consumption (mirror of TrainingScreen's write). */
export function buildEnergyRefillUpdates(
  userData: Record<string, unknown>,
): Record<string, unknown> | null {
  const refills = Number(userData.energyRefills || 0);
  if (refills <= 0) {
    return null;
  }

  return {
    dailyEnergy: Number(userData.maxDailyEnergy || 100) || 100,
    energyRefills: refills - 1,
  };
}
