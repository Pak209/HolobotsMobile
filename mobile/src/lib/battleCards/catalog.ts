import type { ActionCard, CardType } from "@/types/arena";

export type BattleTier = 1 | 2 | 3 | 4;

type BattleCardTemplate = Omit<ActionCard, "id"> & {
  battleTier?: BattleTier;
  rarity: "common" | "uncommon" | "rare" | "epic";
};

const typeToAnimation: Record<CardType, string> = {
  combo: "combo_chain",
  defense: "defense_guard",
  finisher: "finisher_burst",
  strike: "strike_hit",
};

function makeCard(params: {
  baseDamage?: number;
  battleTier?: BattleTier;
  description: string;
  id: string;
  name: string;
  rarity: BattleCardTemplate["rarity"];
  staminaCost: number;
  type: CardType;
}): BattleCardTemplate {
  const damage = params.baseDamage ?? 0;

  return {
    animationId: typeToAnimation[params.type],
    baseDamage: damage,
    battleTier: params.battleTier,
    description: params.description,
    effects: damage > 0 ? [{ type: "damage", target: "opponent", value: damage }] : [],
    iconName: params.type,
    name: params.name,
    rarity: params.rarity,
    requirements:
      params.type === "finisher"
        ? [{ type: "special_meter", operator: "gte", value: 100 }]
        : [],
    speedModifier: params.type === "defense" ? 1.25 : 1,
    staminaCost: params.staminaCost,
    templateId: params.id,
    type: params.type,
  };
}

export const BATTLE_CARD_TEMPLATES: Record<string, BattleCardTemplate> = {
  "strike.quickJab": makeCard({
    battleTier: 1,
    baseDamage: 9,
    description: "Tier 1 strike: reliable chip damage.",
    id: "strike.quickJab",
    name: "Quick Jab",
    rarity: "common",
    staminaCost: 1,
    type: "strike",
  }),
  "strike.backhand": makeCard({
    battleTier: 1,
    baseDamage: 8,
    description: "Tier 1 strike: cheap pressure.",
    id: "strike.backhand",
    name: "Backhand",
    rarity: "common",
    staminaCost: 1,
    type: "strike",
  }),
  "strike.snapShot": makeCard({
    battleTier: 1,
    baseDamage: 9,
    description: "Tier 1 strike: fast meter building.",
    id: "strike.snapShot",
    name: "Snap Shot",
    rarity: "common",
    staminaCost: 1,
    type: "strike",
  }),
  "strike.tempoThrust": makeCard({
    battleTier: 2,
    baseDamage: 12,
    description: "Tier 2 strike: solid output.",
    id: "strike.tempoThrust",
    name: "Tempo Thrust",
    rarity: "common",
    staminaCost: 2,
    type: "strike",
  }),
  "strike.cornerPressure": makeCard({
    battleTier: 2,
    baseDamage: 12,
    description: "Tier 2 strike: forces responses.",
    id: "strike.cornerPressure",
    name: "Corner Pressure",
    rarity: "common",
    staminaCost: 2,
    type: "strike",
  }),
  "strike.vortexKick": makeCard({
    battleTier: 2,
    baseDamage: 13,
    description: "Tier 2 strike: rotational hit.",
    id: "strike.vortexKick",
    name: "Vortex Kick",
    rarity: "uncommon",
    staminaCost: 2,
    type: "strike",
  }),
  "strike.aerialSlash": makeCard({
    battleTier: 3,
    baseDamage: 12,
    description: "Tier 3 strike: strong tempo.",
    id: "strike.aerialSlash",
    name: "Aerial Slash",
    rarity: "uncommon",
    staminaCost: 2,
    type: "strike",
  }),
  "strike.syncPulse": makeCard({
    battleTier: 3,
    baseDamage: 11,
    description: "Tier 3 strike: primes Sync momentum.",
    id: "strike.syncPulse",
    name: "Sync Pulse",
    rarity: "rare",
    staminaCost: 2,
    type: "strike",
  }),
  "strike.armorPierce": makeCard({
    battleTier: 3,
    baseDamage: 15,
    description: "Tier 3 strike: punches through guard.",
    id: "strike.armorPierce",
    name: "Armor Pierce",
    rarity: "rare",
    staminaCost: 3,
    type: "strike",
  }),
  "strike.heavySlam": makeCard({
    battleTier: 4,
    baseDamage: 16,
    description: "Tier 4 strike: heavy impact.",
    id: "strike.heavySlam",
    name: "Heavy Slam",
    rarity: "epic",
    staminaCost: 3,
    type: "strike",
  }),
  "strike.powerDrive": makeCard({
    battleTier: 4,
    baseDamage: 17,
    description: "Tier 4 strike: swing momentum.",
    id: "strike.powerDrive",
    name: "Power Drive",
    rarity: "epic",
    staminaCost: 3,
    type: "strike",
  }),
  "strike.criticalLine": makeCard({
    battleTier: 4,
    baseDamage: 16,
    description: "Tier 4 strike: line up the kill turn.",
    id: "strike.criticalLine",
    name: "Critical Line",
    rarity: "epic",
    staminaCost: 3,
    type: "strike",
  }),
  "defense.guardUp": makeCard({
    battleTier: 1,
    description: "Tier 1 guard: small block.",
    id: "defense.guardUp",
    name: "Guard Up",
    rarity: "common",
    staminaCost: 2,
    type: "defense",
  }),
  "defense.coolantFlush": makeCard({
    battleTier: 1,
    description: "Tier 1 guard: recover tempo.",
    id: "defense.coolantFlush",
    name: "Coolant Flush",
    rarity: "common",
    staminaCost: 1,
    type: "defense",
  }),
  "defense.safetyProtocol": makeCard({
    battleTier: 1,
    description: "Tier 1 guard: consistent low-cost protection.",
    id: "defense.safetyProtocol",
    name: "Safety Protocol",
    rarity: "common",
    staminaCost: 1,
    type: "defense",
  }),
  "defense.parryWindow": makeCard({
    battleTier: 2,
    description: "Tier 2 guard: heavier mitigation.",
    id: "defense.parryWindow",
    name: "Parry Window",
    rarity: "uncommon",
    staminaCost: 2,
    type: "defense",
  }),
  "defense.reinforcePlating": makeCard({
    battleTier: 2,
    description: "Tier 2 guard: reinforced plating.",
    id: "defense.reinforcePlating",
    name: "Reinforce Plating",
    rarity: "uncommon",
    staminaCost: 2,
    type: "defense",
  }),
  "defense.firewall": makeCard({
    battleTier: 4,
    description: "Tier 4 guard: counter stance.",
    id: "defense.firewall",
    name: "Firewall",
    rarity: "epic",
    staminaCost: 2,
    type: "defense",
  }),
  "combo.chainBurst": makeCard({
    battleTier: 1,
    baseDamage: 10,
    description: "Tier 1 combo: starter chain.",
    id: "combo.chainBurst",
    name: "Chain Burst",
    rarity: "common",
    staminaCost: 2,
    type: "combo",
  }),
  "combo.doubleTap": makeCard({
    battleTier: 1,
    baseDamage: 10,
    description: "Tier 1 combo: two-hit package.",
    id: "combo.doubleTap",
    name: "Double Tap",
    rarity: "common",
    staminaCost: 2,
    type: "combo",
  }),
  "combo.crossCircuit": makeCard({
    battleTier: 2,
    baseDamage: 11,
    description: "Tier 2 combo: maintains pressure.",
    id: "combo.crossCircuit",
    name: "Cross Circuit",
    rarity: "uncommon",
    staminaCost: 2,
    type: "combo",
  }),
  "combo.pressureLink": makeCard({
    battleTier: 2,
    baseDamage: 10,
    description: "Tier 2 combo: link pressure.",
    id: "combo.pressureLink",
    name: "Pressure Link",
    rarity: "uncommon",
    staminaCost: 2,
    type: "combo",
  }),
  "combo.flowState": makeCard({
    battleTier: 4,
    baseDamage: 8,
    description: "Tier 4 combo: recover tempo when pressured.",
    id: "combo.flowState",
    name: "Flow State",
    rarity: "epic",
    staminaCost: 2,
    type: "combo",
  }),
  "finisher.tacticalOverride": makeCard({
    baseDamage: 33,
    description: "Finisher optimized for control.",
    id: "finisher.tacticalOverride",
    name: "Tactical Override",
    rarity: "epic",
    staminaCost: 4,
    type: "finisher",
  }),
};

export const STARTER_DECK_BALANCED_IDS = [
  "strike.quickJab",
  "strike.snapShot",
  "strike.tempoThrust",
  "strike.cornerPressure",
  "strike.vortexKick",
  "strike.armorPierce",
  "strike.backhand",
  "strike.aerialSlash",
  "defense.guardUp",
  "defense.safetyProtocol",
  "defense.coolantFlush",
  "defense.parryWindow",
  "defense.reinforcePlating",
  "defense.firewall",
  "combo.chainBurst",
  "combo.doubleTap",
  "combo.crossCircuit",
  "combo.pressureLink",
  "combo.flowState",
  "finisher.tacticalOverride",
];

export function getGenesisStarterDeckGrants(): Record<string, number> {
  return Object.fromEntries(STARTER_DECK_BALANCED_IDS.map((id) => [id, 1]));
}

export function mergeBattleCardCounts(
  current: Record<string, number> | undefined,
  added: Record<string, number>,
) {
  const out = { ...(current || {}) };
  Object.entries(added).forEach(([id, quantity]) => {
    out[id] = (out[id] || 0) + quantity;
  });
  return out;
}

export function createActionCardFromTemplate(templateId: string, id: string): ActionCard | null {
  const template = BATTLE_CARD_TEMPLATES[templateId];
  return template ? { ...template, id } : null;
}

export function getRandomBattleCardGrant(packId: string): Record<string, number> {
  const pools: Record<string, string[]> = {
    champion: Object.keys(BATTLE_CARD_TEMPLATES).filter((id) => BATTLE_CARD_TEMPLATES[id].rarity !== "epic"),
    common: Object.keys(BATTLE_CARD_TEMPLATES).filter((id) => BATTLE_CARD_TEMPLATES[id].rarity === "common"),
    elite: Object.keys(BATTLE_CARD_TEMPLATES),
    rare: Object.keys(BATTLE_CARD_TEMPLATES).filter((id) => BATTLE_CARD_TEMPLATES[id].rarity !== "common"),
  };
  const pool = pools[packId] || pools.common;
  const id = pool[Math.floor(Math.random() * pool.length)] || STARTER_DECK_BALANCED_IDS[0];
  return { [id]: 1 };
}
