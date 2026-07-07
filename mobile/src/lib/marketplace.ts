import { getRandomBattleCardGrant, mergeBattleCardCounts } from "@/lib/battleCards/catalog";
import { incrementBoosterPacksToday } from "@/lib/dailyMissions";
import type { UserProfile } from "@/types/profile";

/**
 * Pure marketplace economy: price tables, loot pools, and purchase builders.
 * Mirrored (with raw Firestore field names) in
 * `functions/src/lib/economy.ts`; `economyServerParity.test.ts` enforces the
 * match. Keep UI concerns out of this module.
 */

export type MarketplaceItemName =
  | "Arena Pass"
  | "Gacha Ticket"
  | "Energy Refill"
  | "EXP Booster"
  | "Rank Skip";

export const MARKETPLACE_ITEM_NAMES: MarketplaceItemName[] = [
  "Arena Pass",
  "Gacha Ticket",
  "Energy Refill",
  "EXP Booster",
  "Rank Skip",
];

export function getMarketplacePrice(itemName: string): number {
  const normalized = itemName.trim().toLowerCase();

  if (normalized.includes("energy")) return 200;
  if (normalized.includes("exp")) return 750;
  if (normalized.includes("rank")) return 5000;
  if (normalized.includes("arena")) return 50;
  if (normalized.includes("gacha")) return 100;
  if (normalized.includes("async")) return 125;
  if (normalized.includes("blueprint")) return 300;

  return 100;
}

export type MarketplaceBoosterId = "common" | "champion" | "rare" | "elite";

export const MARKETPLACE_BOOSTER_PRICES: Record<MarketplaceBoosterId, number> = {
  champion: 100,
  common: 50,
  elite: 400,
  rare: 200,
};

export const BOOSTER_PART_POOL = [
  { name: "Combat Mask", slot: "head" },
  { name: "Void Mask", slot: "head" },
  { name: "Torso Part", slot: "torso" },
  { name: "Plasma Cannon", slot: "arms" },
  { name: "Boxer Gloves", slot: "arms" },
  { name: "Core Part", slot: "core" },
] as const;

export const BOOSTER_ITEM_AWARD_MAP: Record<MarketplaceBoosterId, MarketplaceItemName> = {
  champion: "Gacha Ticket",
  common: "Arena Pass",
  elite: "EXP Booster",
  rare: "Energy Refill",
};

type PurchaseProfile = Pick<
  UserProfile,
  | "arena_passes"
  | "arena_deck_template_ids"
  | "battle_cards"
  | "energy_refills"
  | "exp_boosters"
  | "gachaTickets"
  | "holosTokens"
  | "pack_history"
  | "parts"
  | "rank_skips"
  | "rewardSystem"
>;

export type ItemPurchaseResult = {
  price: number;
  updates: Record<string, unknown>;
};

/**
 * Builds the profile updates for a single-item purchase, or null when the
 * player cannot afford it. Update keys use the client-mapped profile names;
 * the server mirror writes the equivalent raw Firestore names.
 */
export function buildItemPurchaseUpdates(
  profile: PurchaseProfile,
  itemName: string,
): ItemPurchaseResult | null {
  const price = getMarketplacePrice(itemName);
  const holos = Number(profile.holosTokens || 0);

  if (holos < price) {
    return null;
  }

  const updates: Record<string, unknown> = {
    holosTokens: holos - price,
  };

  switch (itemName) {
    case "Arena Pass":
      updates.arena_passes = Number(profile.arena_passes || 0) + 1;
      break;
    case "Gacha Ticket":
      updates.gachaTickets = Number(profile.gachaTickets || 0) + 1;
      break;
    case "Energy Refill":
      updates.energy_refills = Number(profile.energy_refills || 0) + 1;
      break;
    case "EXP Booster":
      updates.exp_boosters = Number(profile.exp_boosters || 0) + 1;
      break;
    case "Rank Skip":
      updates.rank_skips = Number(profile.rank_skips || 0) + 1;
      break;
    default:
      return null;
  }

  return { price, updates };
}

export type BoosterPurchaseResult = {
  granted: {
    battleCardId: string;
    itemName: MarketplaceItemName;
    part: { name: string; slot: string };
  };
  price: number;
  updates: Record<string, unknown>;
};

export type BoosterPurchaseOptions = {
  now?: Date;
  random?: () => number;
};

function randomFrom<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/**
 * Builds the profile updates for a booster-pack purchase, or null when the
 * player cannot afford it. RNG and clock are injectable so the server mirror
 * can be parity-tested deterministically.
 */
export function buildBoosterPurchaseUpdates(
  profile: PurchaseProfile,
  packId: MarketplaceBoosterId,
  options: BoosterPurchaseOptions = {},
): BoosterPurchaseResult | null {
  const random = options.random ?? Math.random;
  const now = options.now ?? new Date();
  const price = MARKETPLACE_BOOSTER_PRICES[packId];
  const holos = Number(profile.holosTokens || 0);

  if (price === undefined || holos < price) {
    return null;
  }

  const grantedPart = randomFrom(BOOSTER_PART_POOL, random);
  const grantedItem = BOOSTER_ITEM_AWARD_MAP[packId];
  const grantedBattleCard = getRandomBattleCardGrant(packId, random);
  const [grantedBattleCardId] = Object.keys(grantedBattleCard);
  const packHistory = Array.isArray(profile.pack_history) ? profile.pack_history : [];
  const nextBattleCards = mergeBattleCardCounts(profile.battle_cards, grantedBattleCard);

  const updates: Record<string, unknown> = {
    arena_deck_template_ids:
      profile.arena_deck_template_ids && profile.arena_deck_template_ids.length > 0
        ? profile.arena_deck_template_ids
        : Object.keys(nextBattleCards),
    battle_cards: nextBattleCards,
    holosTokens: holos - price,
    pack_history: [
      {
        id: `marketplace_${packId}_${now.getTime()}`,
        items: [
          { name: grantedPart.name, quantity: 1, slot: grantedPart.slot, type: "part" },
          { name: grantedItem, quantity: 1, type: "item" },
          { name: grantedBattleCardId, quantity: 1, type: "battle_card" },
        ],
        openedAt: now.toISOString(),
        packId,
      },
      ...packHistory,
    ].slice(0, 50),
    parts: [...(profile.parts || []), { name: grantedPart.name, slot: grantedPart.slot }],
    rewardSystem: incrementBoosterPacksToday(profile.rewardSystem, now),
  };

  if (grantedItem === "Arena Pass") updates.arena_passes = Number(profile.arena_passes || 0) + 1;
  if (grantedItem === "Gacha Ticket") updates.gachaTickets = Number(profile.gachaTickets || 0) + 1;
  if (grantedItem === "Energy Refill") updates.energy_refills = Number(profile.energy_refills || 0) + 1;
  if (grantedItem === "EXP Booster") updates.exp_boosters = Number(profile.exp_boosters || 0) + 1;

  return {
    granted: {
      battleCardId: grantedBattleCardId,
      itemName: grantedItem,
      part: { name: grantedPart.name, slot: grantedPart.slot },
    },
    price,
    updates,
  };
}
