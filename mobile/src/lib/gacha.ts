import { HOLOBOT_NAMES } from "@/lib/progression";
import type { UserProfile } from "@/types/profile";

export type GachaPackId = "basic" | "premium" | "elite";
export type GachaRarity = "common" | "rare" | "epic" | "legendary";

export type GachaPack = {
  accent: string;
  guaranteed: number;
  id: GachaPackId;
  name: string;
  price: number;
};

export const GACHA_PACKS: GachaPack[] = [
  { accent: "#00d9ff", guaranteed: 3, id: "basic", name: "Basic Pack", price: 1 },
  { accent: "#9d4edd", guaranteed: 5, id: "premium", name: "Premium Pack", price: 3 },
  { accent: "#ff3366", guaranteed: 10, id: "elite", name: "Elite Pack", price: 5 },
];

export type GachaItemLabel =
  | "Plasma Cannon"
  | "Combat Mask"
  | "Core Part"
  | "Energy Refill"
  | "Arena Pass"
  | "EXP Booster"
  | "Blueprint Fragment"
  | "Void Mask"
  | "Legendary Blueprint";

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

/**
 * The Legendary Blueprint easter egg: a thank-you to whoever actually
 * plays. Rolled FIRST for every drop (0.1% per drop, all packs) so the
 * client/server RNG streams stay aligned for everything after it.
 */
export const LEGENDARY_BLUEPRINT_DROP_CHANCE = 0.001;

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
  /** Concrete grant this reveal card represents. */
  grant:
    | { type: "part"; name: GachaItemLabel; slot: string }
    | { type: "consumable"; key: "arena_passes" | "energy_refills" | "exp_boosters"; amount: number }
    | { type: "blueprints"; holobotKey: string; amount: number }
    | { type: "wildcard_blueprints"; amount: number }
    | { type: "legendary_blueprint" };
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

function randomFrom<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function buildGrant(label: GachaItemLabel, rarity: GachaRarity, random: () => number): GachaGrantedItem["grant"] {
  const partSlot = PART_SLOTS[label];
  if (partSlot) {
    return { type: "part", name: label, slot: partSlot };
  }

  const consumableAmount = CONSUMABLE_AMOUNT_BY_RARITY[rarity];
  if (label === "Energy Refill") return { type: "consumable", key: "energy_refills", amount: consumableAmount };
  if (label === "Arena Pass") return { type: "consumable", key: "arena_passes", amount: consumableAmount };
  if (label === "EXP Booster") return { type: "consumable", key: "exp_boosters", amount: consumableAmount };

  // Legendary blueprint pulls are WILDCARDS — the player assigns them to
  // any Holobot. Lower rarities stay a random bot (the fun lottery).
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

function describeGrant(grant: GachaGrantedItem["grant"], index: number, total: number) {
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
  if (grant.type === "legendary_blueprint") {
    return `ASCEND ANY HOLOBOT TO LEGENDARY · ${dropLabel}`;
  }
  return dropLabel;
}

export function buildPackRewards(packId: GachaPackId, random: () => number = Math.random): GachaGrantedItem[] {
  const pack = GACHA_PACKS.find((candidate) => candidate.id === packId) ?? GACHA_PACKS[0];

  return Array.from({ length: pack.guaranteed }, (_, index) => {
    // Easter-egg roll comes FIRST so both sides' RNG streams stay aligned.
    if (random() < LEGENDARY_BLUEPRINT_DROP_CHANCE) {
      const grant = { type: "legendary_blueprint" as const };
      return {
        grant,
        id: `${packId}-${Date.now()}-${index}`,
        label: "Legendary Blueprint",
        rarity: "legendary" as GachaRarity,
        subtitle: describeGrant(grant, index, pack.guaranteed),
      };
    }

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

export type GachaGrantUpdates = {
  arena_passes?: number;
  blueprints?: Record<string, number>;
  energy_refills?: number;
  exp_boosters?: number;
  legendaryBlueprints?: number;
  parts?: Array<Record<string, unknown>>;
  wildcardBlueprints?: number;
};

/**
 * Folds the revealed items into concrete profile updates so every card the
 * player sees is actually granted. Returns only the fields that changed.
 */
export function buildPackGrantUpdates(
  profile: Pick<UserProfile, "arena_passes" | "blueprints" | "energy_refills" | "exp_boosters" | "legendaryBlueprints" | "parts" | "wildcardBlueprints">,
  items: GachaGrantedItem[],
): GachaGrantUpdates {
  const updates: GachaGrantUpdates = {};
  let nextBlueprints: Record<string, number> | null = null;
  let nextParts: Array<Record<string, unknown>> | null = null;

  for (const item of items) {
    const grant = item.grant;

    if (grant.type === "part") {
      nextParts = nextParts ?? [...(profile.parts || [])];
      nextParts.push({ name: grant.name, rarity: item.rarity, slot: grant.slot });
      continue;
    }

    if (grant.type === "consumable") {
      const current = updates[grant.key] ?? Number(profile[grant.key] || 0);
      updates[grant.key] = current + grant.amount;
      continue;
    }

    if (grant.type === "wildcard_blueprints") {
      updates.wildcardBlueprints = Number(updates.wildcardBlueprints ?? profile.wildcardBlueprints ?? 0) + grant.amount;
      continue;
    }

    if (grant.type === "legendary_blueprint") {
      updates.legendaryBlueprints = Number(updates.legendaryBlueprints ?? profile.legendaryBlueprints ?? 0) + 1;
      continue;
    }

    nextBlueprints = nextBlueprints ?? { ...(profile.blueprints || {}) };
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
