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
  | "Rank Skip"
  | "Wildcard Blueprints";

export const MARKETPLACE_ITEM_NAMES: MarketplaceItemName[] = [
  "Arena Pass",
  "Gacha Ticket",
  "Energy Refill",
  "EXP Booster",
  "Rank Skip",
  "Wildcard Blueprints",
];

/** The weekly wildcard pack: 5 assignable blueprints, one purchase a week. */
export const WILDCARD_PACK_AMOUNT = 5;
export const WILDCARD_PACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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

export type MarketplacePartRarity = "common" | "rare" | "epic";

export type MarketplacePartOffer = {
  id: string;
  name: string;
  price: number;
  rarity: MarketplacePartRarity;
  slot: string;
};

export const MARKETPLACE_PART_PRICES: Record<MarketplacePartRarity, number> = {
  common: 300,
  epic: 1500,
  rare: 750,
};

// Every entry has bundled art in gameAssets.partNameImageMap. Prices scale by
// rarity only, so the price table stays the single knob.
export const MARKETPLACE_PART_CATALOG: MarketplacePartOffer[] = [
  { id: "part.combatMask", name: "Combat Mask", price: MARKETPLACE_PART_PRICES.common, rarity: "common", slot: "head" },
  { id: "part.voidMask", name: "Void Mask", price: MARKETPLACE_PART_PRICES.epic, rarity: "epic", slot: "head" },
  { id: "part.reinforcedChassis", name: "Reinforced Chassis", price: MARKETPLACE_PART_PRICES.common, rarity: "common", slot: "torso" },
  { id: "part.alloyChassis", name: "Alloy Chassis", price: MARKETPLACE_PART_PRICES.rare, rarity: "rare", slot: "torso" },
  { id: "part.boxerGloves", name: "Boxer Gloves", price: MARKETPLACE_PART_PRICES.common, rarity: "common", slot: "arms" },
  { id: "part.plasmaCannon", name: "Plasma Cannon", price: MARKETPLACE_PART_PRICES.rare, rarity: "rare", slot: "arms" },
  { id: "part.infernoClaws", name: "Inferno Claws", price: MARKETPLACE_PART_PRICES.epic, rarity: "epic", slot: "arms" },
  { id: "part.energyCore", name: "Energy Core", price: MARKETPLACE_PART_PRICES.common, rarity: "common", slot: "core" },
  { id: "part.quantumCore", name: "Quantum Core", price: MARKETPLACE_PART_PRICES.epic, rarity: "epic", slot: "core" },
];

export function getMarketplacePartOffer(partId: string): MarketplacePartOffer | null {
  return MARKETPLACE_PART_CATALOG.find((offer) => offer.id === partId) ?? null;
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

/**
 * GOD PACK (Elite boosters only): the Pokemon-rip jackpot moment. A small
 * roll turns the whole pack into triples — 3 parts, 3 move unlocks, and the
 * item award ×3.
 */
export const GOD_PACK_CHANCE = 0.01;
export const GOD_PACK_ROLLS = 3;

export const BOOSTER_ITEM_AWARD_MAP: Record<MarketplaceBoosterId, MarketplaceItemName> = {
  champion: "Gacha Ticket",
  common: "Arena Pass",
  elite: "EXP Booster",
  rare: "Energy Refill",
};

type PurchaseProfile = Pick<
  UserProfile,
  | "lastWildcardPackAt"
  | "wildcardBlueprints"
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
  now: Date = new Date(),
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
    case "Wildcard Blueprints": {
      // Weekly throttle: this is the scarce targeting valve of the
      // blueprint economy (genesis-squad-monetization-plan.md §7).
      const lastAt = Number(profile.lastWildcardPackAt || 0);
      if (now.getTime() - lastAt < WILDCARD_PACK_COOLDOWN_MS) {
        return null;
      }
      updates.wildcardBlueprints = Number(profile.wildcardBlueprints || 0) + WILDCARD_PACK_AMOUNT;
      updates.lastWildcardPackAt = now.getTime();
      break;
    }
    default:
      return null;
  }

  return { price, updates };
}

export type PartPurchaseResult = {
  part: { name: string; rarity: MarketplacePartRarity; slot: string };
  price: number;
  updates: Record<string, unknown>;
};

/**
 * Builds the profile updates for a marketplace part purchase, or null when
 * the part is unknown or the player cannot afford it. The granted part uses
 * the same `{ name, rarity, slot }` shape gacha grants write, so it equips
 * through the existing inventory flow.
 */
export function buildPartPurchaseUpdates(
  profile: Pick<UserProfile, "holosTokens" | "parts">,
  partId: string,
): PartPurchaseResult | null {
  const offer = getMarketplacePartOffer(partId);
  if (!offer) {
    return null;
  }

  const holos = Number(profile.holosTokens || 0);
  if (holos < offer.price) {
    return null;
  }

  const part = { name: offer.name, rarity: offer.rarity, slot: offer.slot };

  return {
    part,
    price: offer.price,
    updates: {
      holosTokens: holos - offer.price,
      parts: [...(profile.parts || []), part],
    },
  };
}

export type BoosterGrantSummary = {
  battleCardId: string;
  battleCardIds: string[];
  godPack: boolean;
  itemName: MarketplaceItemName;
  itemQuantity: number;
  part: { name: string; slot: string };
  parts: Array<{ name: string; slot: string }>;
};

export type BoosterPurchaseResult = {
  granted: BoosterGrantSummary;
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

  // The god roll is consumed FIRST (elite only) so the client/server RNG
  // streams stay aligned for the grants that follow.
  const isGodPack = packId === "elite" && random() < GOD_PACK_CHANCE;
  const rolls = isGodPack ? GOD_PACK_ROLLS : 1;

  const grantedParts = Array.from({ length: rolls }, () => randomFrom(BOOSTER_PART_POOL, random));
  const grantedItem = BOOSTER_ITEM_AWARD_MAP[packId];
  const battleCardIds: string[] = [];
  let nextBattleCards: Record<string, number> = profile.battle_cards ?? {};
  for (let index = 0; index < rolls; index += 1) {
    const grantedBattleCard = getRandomBattleCardGrant(packId, random);
    battleCardIds.push(Object.keys(grantedBattleCard)[0]);
    nextBattleCards = mergeBattleCardCounts(nextBattleCards, grantedBattleCard);
  }
  const packHistory = Array.isArray(profile.pack_history) ? profile.pack_history : [];

  const updates: Record<string, unknown> = {
    arena_deck_template_ids:
      profile.arena_deck_template_ids && profile.arena_deck_template_ids.length > 0
        ? profile.arena_deck_template_ids
        : Object.keys(nextBattleCards),
    battle_cards: nextBattleCards,
    holosTokens: holos - price,
    pack_history: [
      {
        godPack: isGodPack,
        id: `marketplace_${packId}_${now.getTime()}`,
        items: [
          ...grantedParts.map((part) => ({ name: part.name, quantity: 1, slot: part.slot, type: "part" })),
          { name: grantedItem, quantity: rolls, type: "item" },
          ...battleCardIds.map((cardId) => ({ name: cardId, quantity: 1, type: "battle_card" })),
        ],
        openedAt: now.toISOString(),
        packId,
      },
      ...packHistory,
    ].slice(0, 50),
    parts: [
      ...(profile.parts || []),
      ...grantedParts.map((part) => ({ name: part.name, slot: part.slot })),
    ],
    rewardSystem: incrementBoosterPacksToday(profile.rewardSystem, now),
  };

  if (grantedItem === "Arena Pass") updates.arena_passes = Number(profile.arena_passes || 0) + rolls;
  if (grantedItem === "Gacha Ticket") updates.gachaTickets = Number(profile.gachaTickets || 0) + rolls;
  if (grantedItem === "Energy Refill") updates.energy_refills = Number(profile.energy_refills || 0) + rolls;
  if (grantedItem === "EXP Booster") updates.exp_boosters = Number(profile.exp_boosters || 0) + rolls;

  return {
    granted: {
      battleCardId: battleCardIds[0],
      battleCardIds,
      godPack: isGodPack,
      itemName: grantedItem,
      itemQuantity: rolls,
      part: { name: grantedParts[0].name, slot: grantedParts[0].slot },
      parts: grantedParts.map((part) => ({ name: part.name, slot: part.slot })),
    },
    price,
    updates,
  };
}
