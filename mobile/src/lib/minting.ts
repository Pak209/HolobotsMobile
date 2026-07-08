import { calculateExperience, getHolobotRank, normalizeUserHolobot } from "@/lib/progression";
import type { UserHolobot, UserProfile } from "@/types/profile";

/**
 * Pure blueprint minting / rank-upgrade economy. Mirrored in
 * `functions/src/lib/mintingEconomy.ts`; `mintingServerParity.test.ts`
 * enforces the match. Single source of truth for BLUEPRINT_TIERS (was
 * previously duplicated across InventoryScreen and HolobotStatsModal).
 */

export const BLUEPRINT_TIERS = [
  { attributePoints: 10, key: "common", label: "Common", required: 5, startLevel: 1 },
  { attributePoints: 10, key: "champion", label: "Champion", required: 10, startLevel: 11 },
  { attributePoints: 20, key: "rare", label: "Rare", required: 20, startLevel: 21 },
  { attributePoints: 30, key: "elite", label: "Elite", required: 40, startLevel: 31 },
  { attributePoints: 40, key: "legendary", label: "Legendary", required: 80, startLevel: 41 },
] as const;

export type UpgradeTierLabel = (typeof BLUEPRINT_TIERS)[number]["label"];

export function getTierByLabel(label: string) {
  return BLUEPRINT_TIERS.find((tier) => tier.label === label);
}

export function toHolobotKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

type MintingProfile = Pick<UserProfile, "blueprints" | "holobots">;

export type MintRefusalReason = "already-owned" | "insufficient-blueprints" | "unknown-tier";
export type MintResult =
  | { updates: { blueprints: Record<string, number>; holobots: UserHolobot[] }; tierStartLevel: number }
  | { reason: MintRefusalReason };

export function isMintRefusal(result: MintResult): result is { reason: MintRefusalReason } {
  return (result as { reason?: MintRefusalReason }).reason !== undefined;
}

export function buildMintUpdates(
  profile: MintingProfile,
  holobotName: string,
  tierLabel: string,
): MintResult {
  const tier = getTierByLabel(tierLabel);
  if (!tier) {
    return { reason: "unknown-tier" };
  }

  const key = toHolobotKey(holobotName);
  const currentBlueprints = profile.blueprints?.[key] || 0;
  if (currentBlueprints < tier.required) {
    return { reason: "insufficient-blueprints" };
  }

  const alreadyOwned = (profile.holobots || []).some(
    (holobot) => holobot.name.trim().toUpperCase() === holobotName.trim().toUpperCase(),
  );
  if (alreadyOwned) {
    return { reason: "already-owned" };
  }

  const nextHolobot: UserHolobot = {
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
      blueprints: {
        ...(profile.blueprints || {}),
        [key]: currentBlueprints - tier.required,
      },
      holobots: [...(profile.holobots || []), nextHolobot],
    },
  };
}

export type RankUpgradeRefusalReason =
  | "insufficient-blueprints"
  | "not-owned"
  | "tier-already-reached"
  | "unknown-tier";
export type RankUpgradeResult =
  | { updates: { blueprints: Record<string, number>; holobots: UserHolobot[] }; tierStartLevel: number }
  | { reason: RankUpgradeRefusalReason };

export function isRankUpgradeRefusal(
  result: RankUpgradeResult,
): result is { reason: RankUpgradeRefusalReason } {
  return (result as { reason?: RankUpgradeRefusalReason }).reason !== undefined;
}

export function buildRankUpgradeUpdates(
  profile: MintingProfile,
  holobotName: string,
  tierLabel: string,
): RankUpgradeResult {
  const tier = getTierByLabel(tierLabel);
  if (!tier) {
    return { reason: "unknown-tier" };
  }

  const key = toHolobotKey(holobotName);
  const currentBlueprints = profile.blueprints?.[key] || 0;
  if (currentBlueprints < tier.required) {
    return { reason: "insufficient-blueprints" };
  }

  const target = (profile.holobots || []).find(
    (holobot) => holobot.name.trim().toUpperCase() === holobotName.trim().toUpperCase(),
  );
  if (!target) {
    return { reason: "not-owned" };
  }

  if (tier.startLevel <= (target.level || 1)) {
    return { reason: "tier-already-reached" };
  }

  const normalizedTarget = normalizeUserHolobot(target);
  const updatedHolobots = (profile.holobots || []).map((holobot) => {
    if (holobot.name.toUpperCase() !== normalizedTarget.name.toUpperCase()) {
      return holobot;
    }

    return {
      ...normalizedTarget,
      attributePoints: (normalizedTarget.attributePoints || 0) + tier.attributePoints,
      experience: 0,
      level: tier.startLevel,
      nextLevelExp: calculateExperience(tier.startLevel + 1),
      rank: getHolobotRank(tier.startLevel),
    };
  });

  return {
    tierStartLevel: tier.startLevel,
    updates: {
      blueprints: {
        ...(profile.blueprints || {}),
        [key]: currentBlueprints - tier.required,
      },
      holobots: updatedHolobots,
    },
  };
}
