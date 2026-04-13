export const gameAssets = {
  arenaPass: require("../../assets/game/ArenaPass.png"),
  blueprint: require("../../assets/game/Blueprint.png"),
  corePart: require("../../assets/game/CorePart.png"),
  expBoost: require("../../assets/game/EXPBoost.png"),
  energyRefill: require("../../assets/game/Energyrefill.png"),
  gachaTicket: require("../../assets/game/GachaTicket.png"),
  legPart: require("../../assets/game/LegPart.png"),
  rankSkip: require("../../assets/game/RankSKIP.png"),
  armPartPlasmaCannon: require("../../assets/game/ArmPartPlasmaCannon.png"),
  armsPartBoxer: require("../../assets/game/ArmsPartBoxer.png"),
  armsPartInfernoClaws: require("../../assets/game/ArmsPartInfernoClaws.png"),
  headPartCombatMask: require("../../assets/game/HeadPartCombatMask.png"),
  headPartVoidMask: require("../../assets/game/HeadPartVoidMask.png"),
  torsoPart: require("../../assets/game/TorsoPart.png"),
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

export function getMarketplaceItemImageSource(itemName: string) {
  const normalized = itemName.trim().toLowerCase();

  if (normalized.includes("arena pass")) return gameAssets.arenaPass;
  if (normalized.includes("gacha")) return gameAssets.gachaTicket;
  if (normalized.includes("energy")) return gameAssets.energyRefill;
  if (normalized.includes("exp")) return gameAssets.expBoost;
  if (normalized.includes("rank")) return gameAssets.rankSkip;
  if (normalized.includes("blueprint")) return gameAssets.blueprint;

  return gameAssets.blueprint;
}
