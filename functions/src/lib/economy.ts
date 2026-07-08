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

export type GachaGrantedItem = {
  id: string;
  label: GachaItemLabel;
  rarity: GachaRarity;
  subtitle: string;
  grant:
    | { type: "part"; name: GachaItemLabel; slot: string }
    | { type: "consumable"; key: "arena_passes" | "energy_refills" | "exp_boosters" }
    | { type: "blueprints"; holobotKey: string; amount: number };
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

  if (label === "Energy Refill") return { type: "consumable", key: "energy_refills" };
  if (label === "Arena Pass") return { type: "consumable", key: "arena_passes" };
  if (label === "EXP Booster") return { type: "consumable", key: "exp_boosters" };

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
      updates[rawKey] = current + 1;
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
export function buildItemPurchaseUpdatesRaw(
  userData: Record<string, unknown>,
  itemName: string,
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
    default:
      return null;
  }

  return { price, updates };
}

export type BoosterPurchaseResultRaw = {
  granted: {
    battleCardId: string;
    itemName: MarketplaceItemName;
    part: { name: string; slot: string };
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

  const grantedPart = randomFrom(BOOSTER_PART_POOL, random);
  const grantedItem = BOOSTER_ITEM_AWARD_MAP[packId];
  const grantedBattleCard = getRandomBattleCardGrant(packId, random);
  const [grantedBattleCardId] = Object.keys(grantedBattleCard);
  const packHistory = Array.isArray(userData.packHistory)
    ? (userData.packHistory as Array<Record<string, unknown>>)
    : [];
  const currentDeckIds = Array.isArray(userData.arena_deck_template_ids)
    ? (userData.arena_deck_template_ids as string[])
    : [];
  const nextBattleCards = mergeBattleCardCounts(
    (userData.battle_cards as Record<string, number> | undefined) ??
      (userData.battleCards as Record<string, number> | undefined),
    grantedBattleCard,
  );

  const updates: Record<string, unknown> = {
    arena_deck_template_ids:
      currentDeckIds.length > 0 ? currentDeckIds : Object.keys(nextBattleCards),
    battle_cards: nextBattleCards,
    holosTokens: holos - price,
    packHistory: [
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
    parts: [
      ...((userData.parts as Array<Record<string, unknown>>) || []),
      { name: grantedPart.name, slot: grantedPart.slot },
    ],
    rewardSystem: incrementBoosterPacksToday(userData.rewardSystem, now),
  };

  if (grantedItem === "Arena Pass") updates.arenaPassses = Number(userData.arenaPassses || 0) + 1;
  if (grantedItem === "Gacha Ticket") updates.gachaTickets = Number(userData.gachaTickets || 0) + 1;
  if (grantedItem === "Energy Refill") updates.energyRefills = Number(userData.energyRefills || 0) + 1;
  if (grantedItem === "EXP Booster") updates.expBoosters = Number(userData.expBoosters || 0) + 1;

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
