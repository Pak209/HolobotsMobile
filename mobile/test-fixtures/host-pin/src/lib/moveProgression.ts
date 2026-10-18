import { BATTLE_CARD_RARITIES } from "./economy";

/**
 * Server mirror of mobile/src/features/arena/moveProgression.ts (Sync Point
 * move ranks + combat-kit saves). The `holobots` and `syncPoints` fields use
 * identical raw names on both sides, so the builders match the mobile ones
 * exactly; economyServerParity-style tests in the mobile repo pin them.
 */

export type MoveRank = 0 | 1 | 2 | 3;

export const MOVE_RANK_SP_COSTS: Record<1 | 2 | 3, number> = { 1: 25, 2: 60, 3: 120 };

export type MoveCategory = "strike" | "defense" | "combo" | "finisher";

export type SpecializationBranch = { id: string; name: string; description: string };

export const CATEGORY_SPECIALIZATIONS: Record<MoveCategory, [SpecializationBranch, SpecializationBranch]> = {
  strike: [
    { id: "strike.pressure", name: "Pressure", description: "Cheaper to throw: stamina cost -1." },
    { id: "strike.power", name: "Power", description: "Hits harder: +20% damage." },
  ],
  defense: [
    { id: "defense.safety", name: "Safety", description: "Easier stance: stamina cost -1." },
    { id: "defense.counter", name: "Counter", description: "Sharper reads: +0.25 speed factor." },
  ],
  combo: [
    { id: "combo.flow", name: "Flow", description: "Smoother chains: stamina cost -1." },
    { id: "combo.finish", name: "Finish", description: "Bigger payoff: +20% damage." },
  ],
  finisher: [
    { id: "finisher.reliable", name: "Reliable", description: "Leaner execution: stamina cost -1." },
    { id: "finisher.explosive", name: "Explosive", description: "All-in payoff: +25% damage." },
  ],
};

export const STOCK_KIT_TEMPLATE_IDS = [
  "strike.quickJab",
  "defense.guardUp",
  "combo.chainBurst",
  "finisher.tacticalOverride",
] as const;

const KIT_SLOT_TYPES: MoveCategory[] = ["strike", "defense", "combo", "finisher"];

/** Catalog template ids encode their category as the prefix before the dot. */
export function getMoveCategory(templateId: string): MoveCategory | null {
  const prefix = templateId.split(".")[0];
  return (KIT_SLOT_TYPES as string[]).includes(prefix) ? (prefix as MoveCategory) : null;
}

function isKnownTemplate(templateId: string): boolean {
  return Boolean(BATTLE_CARD_RARITIES[templateId]) ||
    (STOCK_KIT_TEMPLATE_IDS as readonly string[]).includes(templateId);
}

type RawHolobot = Record<string, unknown> & {
  combatKit?: { revision?: number; slots?: string[] };
  moveProgress?: Record<string, { rank?: number; specializationId?: string }>;
  name?: string;
};

function getHolobots(userData: Record<string, unknown>): RawHolobot[] {
  return Array.isArray(userData.holobots) ? (userData.holobots as RawHolobot[]) : [];
}

function findHolobotIndex(holobots: RawHolobot[], holobotName: string): number {
  const normalized = holobotName.trim().toUpperCase();
  return holobots.findIndex(
    (holobot) => String(holobot.name || "").trim().toUpperCase() === normalized,
  );
}

function isOwnedMove(userData: Record<string, unknown>, templateId: string): boolean {
  if ((STOCK_KIT_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
    return true;
  }
  const owned = (userData.battle_cards as Record<string, number> | undefined) ?? {};
  return Number(owned[templateId] || 0) > 0;
}

export function isValidSpecialization(category: MoveCategory, branchId: string): boolean {
  return CATEGORY_SPECIALIZATIONS[category].some((branch) => branch.id === branchId);
}

export type MoveUpgradeResultRaw = {
  cost: number;
  nextRank: MoveRank;
  updates: { holobots: RawHolobot[]; syncPoints: number };
};

/** Raw-field mirror of the mobile buildMoveUpgradeUpdates. Throws plain Errors. */
export function buildMoveUpgradeUpdatesRaw(
  userData: Record<string, unknown>,
  holobotName: string,
  moveTemplateId: string,
  expectedRank: number,
  branchId?: string,
): MoveUpgradeResultRaw {
  const holobots = getHolobots(userData);
  const holobotIndex = findHolobotIndex(holobots, holobotName);
  if (holobotIndex < 0) {
    throw new Error("You do not own that Holobot.");
  }

  const category = getMoveCategory(moveTemplateId);
  if (!category || !isKnownTemplate(moveTemplateId) || !isOwnedMove(userData, moveTemplateId)) {
    throw new Error("That move is not in this Holobot's pool.");
  }

  const holobot = holobots[holobotIndex];
  const currentProgress = holobot.moveProgress?.[moveTemplateId] ?? { rank: 0 };
  const currentRank = Number(currentProgress.rank || 0);
  if (currentRank !== expectedRank) {
    throw new Error("Move rank changed elsewhere. Reload and try again.");
  }
  if (currentRank >= 3) {
    throw new Error("That move is already at max rank.");
  }

  const nextRank = (currentRank + 1) as MoveRank;
  const cost = MOVE_RANK_SP_COSTS[nextRank as 1 | 2 | 3];
  const balance = Number(userData.syncPoints || 0);
  if (balance < cost) {
    throw new Error(`Not enough Sync Points (need ${cost}).`);
  }

  let specializationId = currentProgress.specializationId;
  if (nextRank === 2) {
    if (!branchId || !isValidSpecialization(category, branchId)) {
      throw new Error("Choose a specialization branch for rank 2.");
    }
    specializationId = branchId;
  } else if (branchId && branchId !== specializationId) {
    throw new Error("Specialization can only be chosen at rank 2.");
  }

  const nextHolobots = [...holobots];
  nextHolobots[holobotIndex] = {
    ...holobot,
    moveProgress: {
      ...(holobot.moveProgress || {}),
      [moveTemplateId]: specializationId ? { rank: nextRank, specializationId } : { rank: nextRank },
    },
    moveSystemVersion: 1,
  };

  return {
    cost,
    nextRank,
    updates: { holobots: nextHolobots, syncPoints: balance - cost },
  };
}

export type KitSaveResultRaw = {
  revision: number;
  updates: { holobots: RawHolobot[] };
};

/** Raw-field mirror of the mobile buildKitSaveUpdates. Throws plain Errors. */
export function buildKitSaveUpdatesRaw(
  userData: Record<string, unknown>,
  holobotName: string,
  slots: string[],
  expectedRevision: number,
): KitSaveResultRaw {
  const holobots = getHolobots(userData);
  const holobotIndex = findHolobotIndex(holobots, holobotName);
  if (holobotIndex < 0) {
    throw new Error("You do not own that Holobot.");
  }

  const holobot = holobots[holobotIndex];
  const currentRevision = Number(holobot.combatKit?.revision ?? 0);
  if (currentRevision !== expectedRevision) {
    throw new Error("Kit changed elsewhere. Reload and try again.");
  }

  if (slots.length !== 4) {
    throw new Error("A combat kit must contain exactly four moves.");
  }
  if (new Set(slots).size !== 4) {
    throw new Error("A combat kit must contain four unique moves.");
  }

  slots.forEach((templateId, index) => {
    if (!isKnownTemplate(templateId) || !isOwnedMove(userData, templateId)) {
      throw new Error("You can only equip moves you own.");
    }
    if (getMoveCategory(templateId) !== KIT_SLOT_TYPES[index]) {
      throw new Error(`Kit slot ${index + 1} must hold a ${KIT_SLOT_TYPES[index]} move.`);
    }
  });

  const revision = currentRevision + 1;
  const nextHolobots = [...holobots];
  nextHolobots[holobotIndex] = {
    ...holobot,
    combatKit: { slots: [...slots], revision },
    moveSystemVersion: 1,
  };

  return { revision, updates: { holobots: nextHolobots } };
}
