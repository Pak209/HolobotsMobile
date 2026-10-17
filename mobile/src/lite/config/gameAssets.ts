import { itemIcons, getItemIcon } from "@/lite/config/itemIcons";
import { Image } from "react-native";

export const gameAssets = {
  arenaPass: itemIcons["item.arena_pass"],
  blueprint: itemIcons["item_blueprint_fragment"],
  corePart: itemIcons["part.energyCore"],
  expBoost: itemIcons["item_training_booster"],
  energyRefill: itemIcons["item_energy_refill"],
  gachaTicket: itemIcons["item_holo_pack"],
  legPart: require("../../../assets/game/LegPart.png"),
  rankSkip: itemIcons["item.rank_skip"],
  armPartPlasmaCannon: itemIcons["part.plasmaCannon"],
  armsPartBoxer: itemIcons["part.boxerGloves"],
  armsPartInfernoClaws: itemIcons["part.infernoClaws"],
  headPartCombatMask: itemIcons["part.combatMask"],
  headPartVoidMask: itemIcons["part.voidMask"],
  torsoPart: itemIcons["part.alloyChassis"],
} as const;

function normalizePartName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*$/i, "").trim().toLowerCase();
}

const partNameImageMap: Record<string, number> = {
  "advanced scanner": gameAssets.headPartCombatMask,
  "alloy chassis": gameAssets.torsoPart,
  "boxer gloves": gameAssets.armsPartBoxer,
  "body armor": gameAssets.torsoPart,
  "chest plate": gameAssets.torsoPart,
  "combat mask": gameAssets.headPartCombatMask,
  "combat visor": gameAssets.headPartCombatMask,
  "core part": gameAssets.corePart,
  "energy core": gameAssets.corePart,
  "inferno claws": gameAssets.armsPartInfernoClaws,
  "plasma cannon": gameAssets.armPartPlasmaCannon,
  "plasma cannons": gameAssets.armPartPlasmaCannon,
  "power core": gameAssets.corePart,
  "quantum core": gameAssets.corePart,
  "reinforced chassis": gameAssets.torsoPart,
  "steel torso": gameAssets.torsoPart,
  "torso part": gameAssets.torsoPart,
  "torsoplate": gameAssets.torsoPart,
  "titanium torso": gameAssets.torsoPart,
  "void mask": gameAssets.headPartVoidMask,
};

const slotFallbackImageMap: Record<string, number> = {
  arms: gameAssets.armPartPlasmaCannon,
  body: gameAssets.torsoPart,
  chest: gameAssets.torsoPart,
  core: gameAssets.corePart,
  head: gameAssets.headPartCombatMask,
  legs: gameAssets.legPart,
  torso: gameAssets.torsoPart,
};

export function getPartImageSource(partName?: string | null, slot?: string | null) {
  if (partName) {
    const exactIcon = getItemIcon(partName);
    if (exactIcon) return exactIcon;
    const mapped = partNameImageMap[normalizePartName(partName)];
    if (mapped) {
      return mapped;
    }
  }

  if (slot) {
    return slotFallbackImageMap[slot.toLowerCase()] ?? null;
  }

  return null;
}

export function resolveBundledAssetUri(source?: number | string | null) {
  if (!source) {
    return null;
  }

  if (typeof source === "string") {
    return source;
  }

  return Image.resolveAssetSource(source)?.uri ?? null;
}

export function getMarketplaceItemImageSource(itemName: string) {
  const exactIcon = getItemIcon(itemName);
  if (exactIcon) return exactIcon;
  const normalized = itemName.trim().toLowerCase();

  if (normalized.includes("arena pass")) return gameAssets.arenaPass;
  if (normalized.includes("gacha")) return gameAssets.gachaTicket;
  if (normalized.includes("energy")) return gameAssets.energyRefill;
  if (normalized.includes("exp")) return gameAssets.expBoost;
  if (normalized.includes("rank")) return gameAssets.rankSkip;
  if (normalized.includes("blueprint")) return gameAssets.blueprint;

  return gameAssets.blueprint;
}
