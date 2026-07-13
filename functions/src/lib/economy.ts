/**
 * Server-side gacha and marketplace economy.
 *
 * Mirror of the mobile app's pure economy modules:
 *   - `mobile/src/lib/gacha.ts`
 *   - `mobile/src/lib/marketplace.ts`
 *   - the battle-card grant pools in `mobile/src/lib/battleCards/catalog.ts`
 *   - `incrementBoosterPacksToday` in `mobile/src/lib/dailyMissions.ts`
 *
 * `mobile/src/lib/__tests__/economyServerParity.test.ts` imports this file
 * and fails if the two sides drift.
 *
 * ONE DELIBERATE DIFFERENCE: the mobile builders emit client-mapped profile
 * keys that `updateUserProfile` translates on write; this module writes raw
 * Firestore document fields directly, so it emits the raw names:
 *
 *   arena_passes → arenaPassses (historical typo — do NOT "fix" it),
 *   energy_refills → energyRefills, exp_boosters → expBoosters,
 *   rank_skips → rankSkips, pack_history → packHistory.
 *
 * Everything else (gachaTickets, holosTokens, blueprints, parts,
 * battle_cards, arena_deck_template_ids, rewardSystem) is the same name on
 * both sides. Pure module: no firebase imports, safe to import from tests.
 */

export const HOLOBOT_NAMES = [
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

function randomFrom<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// ---------------------------------------------------------------------------
// Daily mission counters (mirror of dailyMissions.ts)
// ---------------------------------------------------------------------------

export function getTodayMissionKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function incrementBoosterPacksToday(value: unknown, date = new Date()): Record<string, unknown> {
  const todayKey = getTodayMissionKey(date);
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hasFreshCounters = raw.lastDailyMissionReset === todayKey;

  return {
    arenaBattlesToday: hasFreshCounters ? Number(raw.arenaBattlesToday || 0) : 0,
    boosterPacksToday: (hasFreshCounters ? Number(raw.boosterPacksToday || 0) : 0) + 1,
    lastDailyMissionReset: todayKey,
    missionClaims: raw.missionClaims && typeof raw.missionClaims === "object" ? raw.missionClaims : {},
  };
}

/**
 * Daily mission table — mirror of DAILY_MISSION_TABLE in
 * mobile/src/lib/dailyMissions.ts (parity-tested). Completion validates
 * against SERVER-incremented counters: arenaBattlesToday is bumped by
 * settleArenaBattle and boosterPacksToday by purchaseMarketplaceBooster.
 */
export const DAILY_MISSION_TABLE = [
  { id: "daily_login", target: 1, reward: { gachaTickets: 1, holosTokens: 0 } },
  { id: "arena_v2_battle", target: 3, reward: { gachaTickets: 2, holosTokens: 100 } },
  { id: "open_booster_pack", target: 1, reward: { gachaTickets: 1, holosTokens: 0 } },
] as const;

export type MissionClaimRefusal = "unknown_mission" | "not_completed" | "already_claimed";

export function buildMissionClaimUpdatesRaw(
  userData: Record<string, unknown>,
  missionId: string,
  date = new Date(),
):
  | { refusal: MissionClaimRefusal }
  | { refusal: null; reward: { gachaTickets: number; holosTokens: number }; updates: Record<string, unknown> } {
  const mission = DAILY_MISSION_TABLE.find((candidate) => candidate.id === missionId);
  if (!mission) {
    return { refusal: "unknown_mission" };
  }

  const todayKey = getTodayMissionKey(date);
  const raw = (userData.rewardSystem && typeof userData.rewardSystem === "object"
    ? userData.rewardSystem
    : {}) as Record<string, unknown>;
  const hasFreshCounters = raw.lastDailyMissionReset === todayKey;
  const arenaBattlesToday = hasFreshCounters ? Number(raw.arenaBattlesToday || 0) : 0;
  const boosterPacksToday = hasFreshCounters ? Number(raw.boosterPacksToday || 0) : 0;
  const missionClaims = (raw.missionClaims && typeof raw.missionClaims === "object"
    ? raw.missionClaims
    : {}) as Record<string, unknown>;

  const progress =
    missionId === "daily_login"
      ? 1 // being signed in IS the mission
      : missionId === "arena_v2_battle"
        ? arenaBattlesToday
        : boosterPacksToday;
  if (progress < mission.target) {
    return { refusal: "not_completed" };
  }

  if (missionClaims[missionId] === todayKey) {
    return { refusal: "already_claimed" };
  }

  return {
    refusal: null,
    reward: { ...mission.reward },
    updates: {
      gachaTickets: Number(userData.gachaTickets || 0) + mission.reward.gachaTickets,
      holosTokens: Number(userData.holosTokens || 0) + mission.reward.holosTokens,
      rewardSystem: {
        arenaBattlesToday,
        boosterPacksToday,
        lastDailyMissionReset: todayKey,
        missionClaims: { ...missionClaims, [missionId]: todayKey },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Gacha (mirror of gacha.ts)
// ---------------------------------------------------------------------------

export type GachaPackId = "basic" | "premium" | "elite";
export type GachaRarity = "common" | "rare" | "epic" | "legendary";

export const GACHA_PACKS: Array<{ guaranteed: number; id: GachaPackId; price: number }> = [
  { guaranteed: 3, id: "basic", price: 1 },
  { guaranteed: 5, id: "premium", price: 3 },
  { guaranteed: 10, id: "elite", price: 5 },
];

export type GachaItemLabel =
  | "Plasma Cannon"
  | "Combat Mask"
  | "Core Part"
  | "Energy Refill"
  | "Arena Pass"
  | "EXP Booster"
  | "Blueprint Fragment"
  | "Void Mask";

export const GACHA_ITEM_LABELS: GachaItemLabel[] = [
  "Plasma Cannon",
  "Combat Mask",
  "Core Part",
  "Energy Refill",
  "Arena Pass",
  "EXP Booster",
  "Blueprint Fragment",
  "Void Mask",
];

const PART_SLOTS: Partial<Record<GachaItemLabel, string>> = {
  "Combat Mask": "head",
  "Core Part": "core",
  "Plasma Cannon": "arms",
  "Void Mask": "head",
};

const BLUEPRINTS_BY_RARITY: Record<GachaRarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 5,
};

// A gold reveal should FEEL gold: consumables scale with rarity instead of
// always being a single copy.
const CONSUMABLE_AMOUNT_BY_RARITY: Record<GachaRarity, number> = {
  common: 1,
  rare: 1,
  epic: 2,
  legendary: 3,
};

export type GachaGrantedItem = {
  id: string;
  label: GachaItemLabel;
  rarity: GachaRarity;
  subtitle: string;
  grant:
    | { type: "part"; name: GachaItemLabel; slot: string }
    | { type: "consumable"; key: "arena_passes" | "energy_refills" | "exp_boosters"; amount: number }
    | { type: "blueprints"; holobotKey: string; amount: number }
    | { type: "wildcard_blueprints"; amount: number };
};

export function rollPackRarity(packId: GachaPackId, roll: number): GachaRarity {
  if (packId === "elite") {
    if (roll > 0.72) return "legendary";
    if (roll > 0.42) return "epic";
    return "rare";
  }

  if (packId === "premium") {
    if (roll > 0.84) return "legendary";
    if (roll > 0.54) return "epic";
    if (roll > 0.2) return "rare";
    return "common";
  }

  if (roll > 0.95) return "legendary";
  if (roll > 0.74) return "epic";
  if (roll > 0.4) return "rare";
  return "common";
}

function buildGrant(
  label: GachaItemLabel,
  rarity: GachaRarity,
  random: () => number,
): GachaGrantedItem["grant"] {
  const partSlot = PART_SLOTS[label];
  if (partSlot) {
    return { type: "part", name: label, slot: partSlot };
  }

  const consumableAmount = CONSUMABLE_AMOUNT_BY_RARITY[rarity];
  if (label === "Energy Refill") return { type: "consumable", key: "energy_refills", amount: consumableAmount };
  if (label === "Arena Pass") return { type: "consumable", key: "arena_passes", amount: consumableAmount };
  if (label === "EXP Booster") return { type: "consumable", key: "exp_boosters", amount: consumableAmount };

  if (rarity === "legendary") {
    return { type: "wildcard_blueprints", amount: BLUEPRINTS_BY_RARITY[rarity] };
  }

  const holobotName = randomFrom(HOLOBOT_NAMES, random);
  return {
    type: "blueprints",
    amount: BLUEPRINTS_BY_RARITY[rarity],
    holobotKey: holobotName.toLowerCase(),
  };
}

function describeGrant(grant: GachaGrantedItem["grant"], index: number, total: number): string {
  const dropLabel = `Drop ${index + 1} of ${total}`;
  if (grant.type === "blueprints") {
    return `${grant.holobotKey.toUpperCase()} ×${grant.amount} · ${dropLabel}`;
  }
  if (grant.type === "wildcard_blueprints") {
    return `WILDCARD ×${grant.amount} · any Holobot · ${dropLabel}`;
  }
  if (grant.type === "consumable" && grant.amount > 1) {
    return `×${grant.amount} · ${dropLabel}`;
  }
  return dropLabel;
}

export function buildPackRewards(
  packId: GachaPackId,
  random: () => number = Math.random,
): GachaGrantedItem[] {
  const pack = GACHA_PACKS.find((candidate) => candidate.id === packId) ?? GACHA_PACKS[0];

  return Array.from({ length: pack.guaranteed }, (_, index) => {
    const rarity = rollPackRarity(packId, random());
    const label = randomFrom(GACHA_ITEM_LABELS, random);
    const grant = buildGrant(label, rarity, random);

    return {
      grant,
      id: `${packId}-${Date.now()}-${index}`,
      label,
      rarity,
      subtitle: describeGrant(grant, index, pack.guaranteed),
    };
  });
}

/** Raw-field version of the mobile buildPackGrantUpdates. */
export function buildPackGrantUpdatesRaw(
  userData: Record<string, unknown>,
  items: GachaGrantedItem[],
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  let nextBlueprints: Record<string, number> | null = null;
  let nextParts: Array<Record<string, unknown>> | null = null;

  const CONSUMABLE_RAW_KEYS = {
    arena_passes: "arenaPassses",
    energy_refills: "energyRefills",
    exp_boosters: "expBoosters",
  } as const;

  for (const item of items) {
    const grant = item.grant;

    if (grant.type === "part") {
      nextParts = nextParts ?? [...((userData.parts as Array<Record<string, unknown>>) || [])];
      nextParts.push({ name: grant.name, rarity: item.rarity, slot: grant.slot });
      continue;
    }

    if (grant.type === "consumable") {
      const rawKey = CONSUMABLE_RAW_KEYS[grant.key];
      const current =
        updates[rawKey] !== undefined ? Number(updates[rawKey]) : Number(userData[rawKey] || 0);
      updates[rawKey] = current + grant.amount;
      continue;
    }

    if (grant.type === "wildcard_blueprints") {
      const current =
        updates.wildcardBlueprints !== undefined
          ? Number(updates.wildcardBlueprints)
          : Number(userData.wildcardBlueprints || 0);
      updates.wildcardBlueprints = current + grant.amount;
      continue;
    }

    nextBlueprints = nextBlueprints ?? { ...((userData.blueprints as Record<string, number>) || {}) };
    nextBlueprints[grant.holobotKey] = (nextBlueprints[grant.holobotKey] || 0) + grant.amount;
  }

  if (nextParts) {
    updates.parts = nextParts;
  }
  if (nextBlueprints) {
    updates.blueprints = nextBlueprints;
  }

  return updates;
}

// ---------------------------------------------------------------------------
// Marketplace (mirror of marketplace.ts)
// ---------------------------------------------------------------------------

export type MarketplaceItemName =
  | "Arena Pass"
  | "Gacha Ticket"
  | "Energy Refill"
  | "EXP Booster"
  | "Rank Skip";

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

export type PartPurchaseResultRaw = {
  part: { name: string; rarity: MarketplacePartRarity; slot: string };
  price: number;
  updates: Record<string, unknown>;
};

/**
 * Raw-field version of the mobile buildPartPurchaseUpdates (holosTokens and
 * parts use identical names on both sides).
 */
export function buildPartPurchaseUpdatesRaw(
  userData: Record<string, unknown>,
  partId: string,
): PartPurchaseResultRaw | null {
  const offer = getMarketplacePartOffer(partId);
  if (!offer) {
    return null;
  }

  const holos = Number(userData.holosTokens || 0);
  if (holos < offer.price) {
    return null;
  }

  const part = { name: offer.name, rarity: offer.rarity, slot: offer.slot };

  return {
    part,
    price: offer.price,
    updates: {
      holosTokens: holos - offer.price,
      parts: [...((userData.parts as Array<Record<string, unknown>>) || []), part],
    },
  };
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
 * GOD PACK (Elite boosters only): a small roll turns the whole pack into
 * triples — 3 parts, 3 move unlocks, and the item award ×3.
 */
export const GOD_PACK_CHANCE = 0.01;
export const GOD_PACK_ROLLS = 3;

export const BOOSTER_ITEM_AWARD_MAP: Record<MarketplaceBoosterId, MarketplaceItemName> = {
  champion: "Gacha Ticket",
  common: "Arena Pass",
  elite: "EXP Booster",
  rare: "Energy Refill",
};

/**
 * Mirror of getBattleCardRarityTable() from the mobile catalog. The parity
 * test compares this table against the catalog and fails on drift.
 */
export const BATTLE_CARD_RARITIES: Record<string, "common" | "uncommon" | "rare" | "epic"> = {
  "strike.quickJab": "common",
  "strike.backhand": "common",
  "strike.snapShot": "common",
  "strike.tempoThrust": "common",
  "strike.cornerPressure": "common",
  "strike.vortexKick": "uncommon",
  "strike.aerialSlash": "uncommon",
  "strike.syncPulse": "rare",
  "strike.armorPierce": "rare",
  "strike.heavySlam": "epic",
  "strike.powerDrive": "epic",
  "strike.criticalLine": "epic",
  "defense.guardUp": "common",
  "defense.coolantFlush": "common",
  "defense.safetyProtocol": "common",
  "defense.parryWindow": "uncommon",
  "defense.reinforcePlating": "uncommon",
  "defense.firewall": "epic",
  "combo.chainBurst": "common",
  "combo.doubleTap": "common",
  "combo.crossCircuit": "uncommon",
  "combo.pressureLink": "uncommon",
  "combo.flowState": "epic",
  "finisher.tacticalOverride": "epic",
};

const FALLBACK_CARD_ID = "strike.quickJab";

export function getRandomBattleCardGrant(
  packId: string,
  random: () => number = Math.random,
): Record<string, number> {
  const ids = Object.keys(BATTLE_CARD_RARITIES);
  const pools: Record<string, string[]> = {
    champion: ids.filter((id) => BATTLE_CARD_RARITIES[id] !== "epic"),
    common: ids.filter((id) => BATTLE_CARD_RARITIES[id] === "common"),
    elite: ids,
    rare: ids.filter((id) => BATTLE_CARD_RARITIES[id] !== "common"),
  };
  const pool = pools[packId] || pools.common;
  const id = pool[Math.floor(random() * pool.length)] || FALLBACK_CARD_ID;
  return { [id]: 1 };
}

export function mergeBattleCardCounts(
  current: Record<string, number> | undefined,
  added: Record<string, number>,
): Record<string, number> {
  const out = { ...(current || {}) };
  Object.entries(added).forEach(([id, quantity]) => {
    out[id] = (out[id] || 0) + quantity;
  });
  return out;
}

export type ItemPurchaseResultRaw = {
  price: number;
  updates: Record<string, unknown>;
};

/** Raw-field version of the mobile buildItemPurchaseUpdates. */
export const WILDCARD_PACK_AMOUNT = 5;
export const WILDCARD_PACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function buildItemPurchaseUpdatesRaw(
  userData: Record<string, unknown>,
  itemName: string,
  now: Date = new Date(),
): ItemPurchaseResultRaw | null {
  const price = getMarketplacePrice(itemName);
  const holos = Number(userData.holosTokens || 0);

  if (holos < price) {
    return null;
  }

  const updates: Record<string, unknown> = {
    holosTokens: holos - price,
  };

  switch (itemName) {
    case "Arena Pass":
      updates.arenaPassses = Number(userData.arenaPassses || 0) + 1;
      break;
    case "Gacha Ticket":
      updates.gachaTickets = Number(userData.gachaTickets || 0) + 1;
      break;
    case "Energy Refill":
      updates.energyRefills = Number(userData.energyRefills || 0) + 1;
      break;
    case "EXP Booster":
      updates.expBoosters = Number(userData.expBoosters || 0) + 1;
      break;
    case "Rank Skip":
      updates.rankSkips = Number(userData.rankSkips || 0) + 1;
      break;
    case "Wildcard Blueprints": {
      const lastAt = Number(userData.lastWildcardPackAt || 0);
      if (now.getTime() - lastAt < WILDCARD_PACK_COOLDOWN_MS) {
        return null;
      }
      updates.wildcardBlueprints = Number(userData.wildcardBlueprints || 0) + WILDCARD_PACK_AMOUNT;
      updates.lastWildcardPackAt = now.getTime();
      break;
    }
    default:
      return null;
  }

  return { price, updates };
}

export type BoosterPurchaseResultRaw = {
  granted: {
    battleCardId: string;
    battleCardIds: string[];
    godPack: boolean;
    itemName: MarketplaceItemName;
    itemQuantity: number;
    part: { name: string; slot: string };
    parts: Array<{ name: string; slot: string }>;
  };
  price: number;
  updates: Record<string, unknown>;
};

/** Raw-field version of the mobile buildBoosterPurchaseUpdates. */
export function buildBoosterPurchaseUpdatesRaw(
  userData: Record<string, unknown>,
  packId: MarketplaceBoosterId,
  options: { now?: Date; random?: () => number } = {},
): BoosterPurchaseResultRaw | null {
  const random = options.random ?? Math.random;
  const now = options.now ?? new Date();
  const price = MARKETPLACE_BOOSTER_PRICES[packId];
  const holos = Number(userData.holosTokens || 0);

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
  let nextBattleCards: Record<string, number> =
    (userData.battle_cards as Record<string, number> | undefined) ??
    (userData.battleCards as Record<string, number> | undefined) ??
    {};
  for (let index = 0; index < rolls; index += 1) {
    const grantedBattleCard = getRandomBattleCardGrant(packId, random);
    battleCardIds.push(Object.keys(grantedBattleCard)[0]);
    nextBattleCards = mergeBattleCardCounts(nextBattleCards, grantedBattleCard);
  }
  const packHistory = Array.isArray(userData.packHistory)
    ? (userData.packHistory as Array<Record<string, unknown>>)
    : [];
  const currentDeckIds = Array.isArray(userData.arena_deck_template_ids)
    ? (userData.arena_deck_template_ids as string[])
    : [];

  const updates: Record<string, unknown> = {
    arena_deck_template_ids:
      currentDeckIds.length > 0 ? currentDeckIds : Object.keys(nextBattleCards),
    battle_cards: nextBattleCards,
    holosTokens: holos - price,
    packHistory: [
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
      ...((userData.parts as Array<Record<string, unknown>>) || []),
      ...grantedParts.map((part) => ({ name: part.name, slot: part.slot })),
    ],
    rewardSystem: incrementBoosterPacksToday(userData.rewardSystem, now),
  };

  if (grantedItem === "Arena Pass") updates.arenaPassses = Number(userData.arenaPassses || 0) + rolls;
  if (grantedItem === "Gacha Ticket") updates.gachaTickets = Number(userData.gachaTickets || 0) + rolls;
  if (grantedItem === "Energy Refill") updates.energyRefills = Number(userData.energyRefills || 0) + rolls;
  if (grantedItem === "EXP Booster") updates.expBoosters = Number(userData.expBoosters || 0) + rolls;

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
